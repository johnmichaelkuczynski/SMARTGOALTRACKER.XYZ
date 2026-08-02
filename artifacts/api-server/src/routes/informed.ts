import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  db,
  informedMessagesTable,
  informedConversationsTable,
  documentsTable,
  projectsTable,
  projectMessagesTable,
  projectDocumentsTable,
} from "@workspace/db";
import type { MessageParam, ImageBlockParam, TextBlockParam, DocumentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { createRequire } from "module";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { azureOcr } from "../lib/azureOcr";

const execFileAsync = promisify(execFile);

/** Extract plain text from a legacy binary .doc file via antiword. */
async function extractDocText(buf: Buffer): Promise<string> {
  const tmpPath = join(tmpdir(), `informed-doc-${randomUUID()}.doc`);
  try {
    await writeFile(tmpPath, buf);
    const { stdout } = await execFileAsync("antiword", [tmpPath]);
    return stdout.trim();
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}
import {
  buildTieredPromptContext,
  extractDeltaFromTurn,
  loadAllTiers,
  auditAgainstMemory,
  updateLiveTier,
  viewAllTiers,
  forceRepairMemory,
} from "../services/tractatusMemory";

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mammoth = _require("mammoth") as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sharp = _require("sharp") as any;

/** Feature flag — defaults ON; set TRACTATUS_MEMORY_ENABLED=false to revert to flat context */
const TRACTATUS_ENABLED = process.env.TRACTATUS_MEMORY_ENABLED !== "false";

/** Convert any image buffer to JPEG (handles HEIC, HEIF, etc.) */
async function toJpegBase64(base64: string): Promise<{ data: string; mediaType: "image/jpeg" }> {
  const buf = Buffer.from(base64, "base64");
  const jpeg = await sharp(buf).rotate().jpeg({ quality: 88 }).toBuffer() as Buffer;
  return { data: jpeg.toString("base64"), mediaType: "image/jpeg" };
}

const CLAUDE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

async function normalizeImage(img: { data: string; mediaType: string }): Promise<{ data: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" }> {
  if (CLAUDE_IMAGE_TYPES.has(img.mediaType)) {
    return img as { data: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };
  }
  return toJpegBase64(img.data);
}

const router: IRouter = Router();
const MODEL = "claude-sonnet-4-6";
const MAX_HISTORY = 40;
const MAX_DOC_CHARS = 8000;
const MAX_PROJECT_MSG_CHARS = 3000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface StatSummary { label: string; done: number; due: number; rate: number }
interface GoalSnapshot {
  title: string; notes?: string | null; timeframe: string;
  importance?: number | null; done: number; due: number; rate: number;
}
interface Reflection { period: string; label: string; text: string }
interface Category { name: string; rate: number; taskCount: number; due: number }
interface ScheduleItem { title: string; date: string; timeframe: string; importance?: number | null; status: string }
interface FrontendContext {
  today?: string;
  overall?: StatSummary;
  byTimeframe?: StatSummary[];
  goals?: GoalSnapshot[];
  categories?: Category[];
  schedule?: ScheduleItem[];
  reflections?: Reflection[];
  profileSummary?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const cap = (s: string, n: number) => s.length > n ? s.slice(0, n) + "…" : s;
const pct = (rate: number, due: number) => due > 0 ? `${Math.round(rate * 100)}%` : "untracked";

function buildTaskContext(ctx: FrontendContext): string {
  const parts: string[] = [];
  parts.push(`TODAY: ${ctx.today ?? new Date().toDateString()}`);
  if (ctx.overall) parts.push(`OVERALL FOLLOW-THROUGH: ${pct(ctx.overall.rate, ctx.overall.due)} (${ctx.overall.done}/${ctx.overall.due} tracked completions)`);
  if (ctx.byTimeframe?.length) parts.push(`BY TIMEFRAME:\n${ctx.byTimeframe.map((s) => `  - ${s.label}: ${pct(s.rate, s.due)} (${s.done}/${s.due})`).join("\n")}`);
  if (ctx.goals?.length) {
    parts.push(`GOALS:\n${ctx.goals.slice(0, 60).map((g) => {
      const imp = g.importance != null ? `, importance ${g.importance}/10` : "";
      const note = g.notes ? ` — "${cap(g.notes, 200)}"` : "";
      return `  - "${g.title}" (${g.timeframe}${imp}) — follow-through ${pct(g.rate, g.due)}${note}`;
    }).join("\n")}`);
  } else {
    parts.push("GOALS: (none set yet)");
  }
  if (ctx.categories?.length) parts.push(`BY CATEGORY:\n${ctx.categories.map((c) => `  - ${c.name}: ${pct(c.rate, c.due)} across ${c.taskCount} goal(s)`).join("\n")}`);
  if (ctx.schedule?.length) parts.push(`SCHEDULE:\n${ctx.schedule.slice(0, 30).map((s) => `  - ${s.date}: "${s.title}" (${s.timeframe}) [${s.status}]`).join("\n")}`);
  if (ctx.reflections?.length) parts.push(`REFLECTIONS:\n${ctx.reflections.slice(0, 15).map((r) => `(${r.period}) ${r.label}:\n${cap(r.text, 600)}`).join("\n\n")}`);
  if (ctx.profileSummary) parts.push(`PSYCHOLOGICAL PROFILE:\n${cap(ctx.profileSummary, 2000)}`);
  return parts.join("\n\n");
}

function titleFromMessage(msg: string): string {
  const clean = msg.replace(/\s+/g, " ").trim();
  return clean.length > 60 ? clean.slice(0, 57) + "…" : clean || "Image";
}

/** Build an Anthropic message param, optionally with an image block */
function buildUserMessage(text: string, imageData?: string | null, imageMediaType?: string | null): MessageParam {
  if (imageData && imageMediaType) {
    const blocks: (ImageBlockParam | TextBlockParam)[] = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: imageMediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: imageData,
        },
      },
    ];
    if (text) blocks.push({ type: "text", text });
    return { role: "user", content: blocks };
  }
  return { role: "user", content: text };
}

// ── Conversations ─────────────────────────────────────────────────────────────

router.get("/informed/conversations", async (req, res): Promise<void> => {
  const userId = req.userId!;
  try {
    const rows = await db.select()
      .from(informedConversationsTable)
      .where(eq(informedConversationsTable.userId, userId))
      .orderBy(desc(informedConversationsTable.updatedAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list conversations");
    res.status(500).json({ error: "Failed to load conversations" });
  }
});

router.post("/informed/conversations", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { parentId } = req.body as { parentId?: string };
  try {
    // Validate parentId belongs to this user
    if (parentId) {
      const parent = await db.select({ id: informedConversationsTable.id })
        .from(informedConversationsTable)
        .where(and(eq(informedConversationsTable.id, parentId), eq(informedConversationsTable.userId, userId)))
        .limit(1);
      if (parent.length === 0) {
        res.status(400).json({ error: "Invalid parentId" });
        return;
      }
    }
    const id = randomUUID();
    const [row] = await db.insert(informedConversationsTable)
      .values({ id, userId, title: "New chat", parentId: parentId ?? null })
      .returning();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create conversation");
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.delete("/informed/conversations/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  try {
    await db.delete(informedMessagesTable).where(
      and(eq(informedMessagesTable.conversationId, id), eq(informedMessagesTable.userId, userId))
    );
    await db.delete(informedConversationsTable).where(
      and(eq(informedConversationsTable.id, id), eq(informedConversationsTable.userId, userId))
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete conversation");
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

// ── Messages for a conversation ───────────────────────────────────────────────

router.get("/informed/conversations/:id/messages", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  try {
    const msgs = await db.select()
      .from(informedMessagesTable)
      .where(
        and(eq(informedMessagesTable.conversationId, id), eq(informedMessagesTable.userId, userId))
      )
      .orderBy(informedMessagesTable.createdAt);
    res.json(msgs);
  } catch (err) {
    req.log.error({ err }, "Failed to load messages");
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// ── Tractatus memory status ───────────────────────────────────────────────────

router.get("/informed/memory/status", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const jobId = `${userId}-life`;
  const jobType = "informed_life";
  try {
    const tiers = await loadAllTiers(jobId, jobType);
    res.json({
      enabled: TRACTATUS_ENABLED,
      jobId,
      tiers: tiers.map((t) => ({
        tier: t.tier,
        nodeCount: t.nodeCount,
        compressionCount: t.compressionCount,
        lastUpdate: t.lastUpdate,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Memory status failed");
    res.status(500).json({ error: "Failed to load memory status" });
  }
});

router.get("/informed/memory/view", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const jobId = `${userId}-life`;
  const jobType = "informed_life";
  try {
    const tiers = await viewAllTiers(jobId, jobType);
    res.json({ tiers });
  } catch (err) {
    req.log.error({ err }, "Informed memory view failed");
    res.status(500).json({ error: "Failed to load memory" });
  }
});

router.post("/informed/memory/repair", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const jobId = `${userId}-life`;
  const jobType = "informed_life";
  try {
    const result = await forceRepairMemory(jobId, jobType);
    res.json({ ok: true, ...result });
  } catch (err) {
    req.log.error({ err }, "Informed memory repair failed");
    res.status(500).json({ error: "Repair failed" });
  }
});

// ── Audit endpoint ────────────────────────────────────────────────────────────

router.post("/informed/audit", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { text } = req.body as { text?: string };
  if (!text?.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  const jobId = `${userId}-life`;
  const jobType = "informed_life";
  try {
    const report = await auditAgainstMemory(text, jobId, jobType);
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Audit failed");
    res.status(500).json({ error: "Audit failed" });
  }
});

// ── Chat (SSE streaming) ──────────────────────────────────────────────────────

router.post("/informed/chat", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { message, conversationId, context, images, documents, preferences } = req.body as {
    message?: string;
    conversationId?: string;
    context?: FrontendContext;
    images?: Array<{ data: string; mediaType: string; name?: string }>;
    documents?: Array<{ name: string; mediaType: string; text?: string; data?: string }>;
    preferences?: { length?: string; format?: string; tone?: string };
  };

  const hasImages = !!(images?.length);
  const hasDocs = !!(documents?.length);
  if (!message?.trim() && !hasImages && !hasDocs) {
    res.status(400).json({ error: "Message, image, or document is required" });
    return;
  }
  if (!conversationId) {
    res.status(400).json({ error: "conversationId is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Tractatus job identifiers
  const jobId = `${userId}-life`;
  const jobType = "informed_life";

  try {
    // Fetch current conversation row (needed for parentId)
    const [convRow] = await db.select()
      .from(informedConversationsTable)
      .where(and(eq(informedConversationsTable.id, conversationId), eq(informedConversationsTable.userId, userId)))
      .limit(1);

    const [history, globalDocs, projects] = await Promise.all([
      db.select().from(informedMessagesTable)
        .where(and(eq(informedMessagesTable.conversationId, conversationId), eq(informedMessagesTable.userId, userId)))
        .orderBy(informedMessagesTable.createdAt),
      db.select({ name: documentsTable.name, text: documentsTable.extractedText })
        .from(documentsTable).where(eq(documentsTable.userId, userId)),
      db.select().from(projectsTable)
        .where(eq(projectsTable.userId, userId))
        .orderBy(desc(projectsTable.updatedAt)),
    ]);

    // Fetch parent conversation history chain (up to 2 levels, last 20 msgs each)
    let priorConversationContext = "";
    if (convRow?.parentId) {
      const parentMsgs = await db.select({ role: informedMessagesTable.role, content: informedMessagesTable.content })
        .from(informedMessagesTable)
        .where(and(eq(informedMessagesTable.conversationId, convRow.parentId), eq(informedMessagesTable.userId, userId)))
        .orderBy(informedMessagesTable.createdAt);
      if (parentMsgs.length > 0) {
        const recent = parentMsgs.slice(-20);
        const lines = recent.map((m) => {
          const speaker = m.role === "user" ? "USER" : "CLAUDE";
          const text = m.content.startsWith("[") && m.content.endsWith("]") ? "(attachment)" : cap(m.content, 600);
          return `${speaker}: ${text}`;
        });
        priorConversationContext = `PRIOR CONVERSATION (this is a follow-up to that session — use it for full continuity):\n\n${lines.join("\n\n")}`;
      }
    }

    const recentProjects = projects.slice(0, 5);
    const projectDetails = await Promise.all(
      recentProjects.map(async (p) => {
        const [msgs, docs] = await Promise.all([
          db.select({ role: projectMessagesTable.role, content: projectMessagesTable.content })
            .from(projectMessagesTable)
            .where(eq(projectMessagesTable.projectId, p.id))
            .orderBy(desc(projectMessagesTable.createdAt)).limit(10),
          db.select({ name: projectDocumentsTable.name, content: projectDocumentsTable.content })
            .from(projectDocumentsTable).where(eq(projectDocumentsTable.projectId, p.id)),
        ]);
        return { project: p, messages: msgs.reverse(), docs };
      }),
    );

    // Normalize all incoming images
    if (hasImages && images) {
      for (let i = 0; i < images.length; i++) {
        try {
          const norm = await normalizeImage(images[i]);
          images[i] = { ...images[i], data: norm.data, mediaType: norm.mediaType };
        } catch (err) {
          req.log.warn({ err }, "Image normalization failed");
        }
      }
    }

    // Run Azure OCR on all images in parallel
    const ocrParts: string[] = [];
    if (hasImages && images) {
      await Promise.all(images.map(async (img, idx) => {
        try {
          const text = await azureOcr(img.data, img.mediaType);
          if (text.trim()) ocrParts.push(images.length > 1 ? `[Image ${idx + 1} OCR:\n${text}]` : `[Text extracted from image via OCR:\n${text}]`);
        } catch (err) {
          req.log.warn({ err }, "Azure OCR failed for image");
        }
      }));
    }

    // Build document content blocks for Claude
    // PDFs: native base64 document blocks (Claude reads them directly).
    // DOCX: extract via mammoth (modern XML-based Word format).
    // DOC:  extract via antiword (legacy binary Word format — mammoth cannot read these).
    // TXT:  plain-text document block.
    const docBlocks: DocumentBlockParam[] = [];
    if (hasDocs && documents) {
      for (const doc of documents) {
        const isPdf  = doc.mediaType === "application/pdf" || doc.name.toLowerCase().endsWith(".pdf");
        const isDocx = !!(doc.mediaType?.includes("wordprocessingml") || doc.name.toLowerCase().endsWith(".docx"));
        const isDoc  = !!(doc.mediaType === "application/msword" || (doc.name.toLowerCase().endsWith(".doc") && !doc.name.toLowerCase().endsWith(".docx")));
        const isText = doc.mediaType === "text/plain" || doc.name.toLowerCase().endsWith(".txt");

        if (isPdf && doc.data) {
          // Send PDF directly — Claude natively reads base64 PDF document blocks
          docBlocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: doc.data },
          } as DocumentBlockParam);
        } else if (isDocx && doc.data) {
          // Modern .docx — mammoth handles XML-based Word format
          try {
            const buf = Buffer.from(doc.data, "base64");
            const result = await mammoth.extractRawText({ buffer: buf });
            const extracted = result.value?.trim() ?? "";
            if (extracted) {
              docBlocks.push({
                type: "document",
                source: { type: "text", media_type: "text/plain", data: cap(extracted, 80_000) },
              } as DocumentBlockParam);
            }
          } catch (err) {
            req.log.warn({ err, name: doc.name }, "DOCX parse failed");
          }
        } else if (isDoc && doc.data) {
          // Legacy binary .doc — mammoth cannot read this; use antiword
          try {
            const buf = Buffer.from(doc.data, "base64");
            const extracted = await extractDocText(buf);
            if (extracted) {
              docBlocks.push({
                type: "document",
                source: { type: "text", media_type: "text/plain", data: cap(extracted, 80_000) },
              } as DocumentBlockParam);
            }
          } catch (err) {
            req.log.warn({ err, name: doc.name }, "DOC (legacy) parse failed via antiword");
          }
        } else if (isText && doc.text?.trim()) {
          docBlocks.push({
            type: "document",
            source: { type: "text", media_type: "text/plain", data: cap(doc.text.trim(), 80_000) },
          } as DocumentBlockParam);
        }
      }
    }

    // Build attachments JSON for storage
    const storedAttachments = [
      ...(images?.map((img) => ({ type: "image", name: img.name ?? "image", mediaType: img.mediaType, data: img.data })) ?? []),
      ...(documents?.map((doc) => ({ type: "document", name: doc.name, mediaType: doc.mediaType })) ?? []),
    ];

    // Save user message
    const isFirstMessage = history.length === 0;
    const userText = message?.trim() ?? "";
    const contentLabel = userText
      || (hasDocs && documents!.length === 1 ? `[${documents![0].name}]` : hasDocs ? `[${documents!.length} documents]` : "")
      || (hasImages && images!.length === 1 ? "[image]" : hasImages ? `[${images!.length} images]` : "");
    await db.insert(informedMessagesTable).values({
      id: randomUUID(),
      userId,
      conversationId,
      role: "user",
      content: contentLabel || "[message]",
      imageData: images?.[0]?.data ?? null,
      imageMediaType: images?.[0]?.mediaType ?? null,
      attachments: JSON.stringify(storedAttachments),
    });

    // Auto-title from first message
    const titleSource = userText
      || (hasDocs ? documents![0].name : "")
      || (hasImages ? "Image" : "New chat");
    if (isFirstMessage) {
      await db.update(informedConversationsTable)
        .set({ title: titleFromMessage(titleSource), updatedAt: new Date() })
        .where(and(eq(informedConversationsTable.id, conversationId), eq(informedConversationsTable.userId, userId)));
    } else {
      await db.update(informedConversationsTable)
        .set({ updatedAt: new Date() })
        .where(and(eq(informedConversationsTable.id, conversationId), eq(informedConversationsTable.userId, userId)));
    }

    // ── Tractatus memory ───────────────────────────────────────────────────────
    let memoryContext = "";
    if (TRACTATUS_ENABLED) {
      try {
        memoryContext = await buildTieredPromptContext(jobId, jobType);
      } catch (err) {
        req.log.error({ err }, "Tractatus memory build failed — falling back to flat context");
        memoryContext = "";
      }
    }

    // ── Build system prompt ────────────────────────────────────────────────────
    const taskContext = context ? buildTaskContext(context) : "No task/goal data available.";

    let projectContext = "";
    if (projectDetails.length > 0) {
      const sections = projectDetails.map(({ project, messages, docs }) => {
        const recent = messages.map((m) => `${m.role === "user" ? "USER" : "ADVISOR"}: ${cap(m.content, 400)}`).join("\n");
        const docText = docs.map((d) => `  Document "${d.name}": ${cap(d.content, 600)}`).join("\n");
        return [
          `PROJECT: "${project.name}"`,
          project.description ? `Description: ${project.description}` : null,
          docs.length ? `Documents:\n${docText}` : null,
          messages.length ? `Recent conversation:\n${cap(recent, MAX_PROJECT_MSG_CHARS)}` : "No conversation yet.",
        ].filter(Boolean).join("\n");
      });
      projectContext = `USER'S PROJECTS:\n\n${sections.join("\n\n---\n\n")}`;
    }

    let docContext = "";
    if (globalDocs.length > 0) {
      let budget = 30_000;
      const lines: string[] = [];
      for (const d of globalDocs.slice(0, 10)) {
        if (budget <= 0) break;
        const body = cap(d.text.trim(), Math.min(MAX_DOC_CHARS, budget));
        budget -= body.length;
        lines.push(`### ${d.name}\n${body || "(no readable text)"}`);
      }
      docContext = `USER'S UPLOADED DOCUMENTS:\n\n${lines.join("\n\n")}`;
    }

    let systemPrompt: string;

    // ── Build preferences instruction ──────────────────────────────────────────
    const lengthInstructions: Record<string, string> = {
      naturally: "",
      extremely_concise: "LENGTH: Respond in as few words as possible. One to two sentences maximum unless the question absolutely requires more. No preamble, no filler.",
      concise: "LENGTH: Be concise. Cut all preamble and filler. Get directly to the point.",
      normal: "LENGTH: Use a moderate length — enough to be clear and complete, but no padding.",
      thorough: "LENGTH: Be thorough. Cover all relevant angles, caveats, and supporting detail.",
      extremely_thorough: "LENGTH: Be exhaustive. Cover every relevant angle with maximum detail, examples, edge cases, and caveats.",
    };
    const formatInstructions: Record<string, string> = {
      natural: "",
      sentences: "FORMAT: Respond in complete sentences only. Do not use bullet points, numbered lists, or headers under any circumstances.",
      bullets: "FORMAT: Structure your entire response using bullet points. Every main point must be a bullet. No paragraphs.",
      numbered: "FORMAT: Structure your entire response as a numbered list. Every main point must be numbered. No paragraphs.",
    };
    const toneInstructions: Record<string, string> = {
      strongly_critical: "TONE: Be maximally skeptical and critical. Actively seek flaws, weaknesses, gaps, contradictions, and counterarguments. Lead with what is wrong or questionable. Do not soften criticism. Do not balance criticism with praise unless the praise is factually necessary.",
      critical: "TONE: Lean skeptical. Flag problems, weaknesses, and risks alongside any merits. Do not soften criticism or lead with encouragement.",
      neutral: "",
      mildly_positive: "TONE: Be somewhat encouraging while remaining accurate. Acknowledge strengths alongside problems, and frame constructively.",
      positive: "TONE: Be supportive and encouraging. Emphasize strengths and possibilities while remaining factually accurate.",
    };

    const prefParts: string[] = [];
    if (preferences?.length && preferences.length !== "natural") {
      const instr = lengthInstructions[preferences.length];
      if (instr) prefParts.push(instr);
    }
    if (preferences?.format && preferences.format !== "natural") {
      const instr = formatInstructions[preferences.format];
      if (instr) prefParts.push(instr);
    }
    if (preferences?.tone && preferences.tone !== "neutral") {
      const instr = toneInstructions[preferences.tone];
      if (instr) prefParts.push(instr);
    }
    const preferencesBlock = prefParts.length > 0
      ? `\nUSER RESPONSE PREFERENCES (apply to every reply):\n${prefParts.join("\n")}\n`
      : "";

    const documentScrutinyRules = `
DOCUMENT AND VALIDITY REVIEW — CRITICAL RULES:
When the user asks whether a document, form, filing, service, agreement, signature, date, or process is valid, correct, legally sufficient, or properly completed — your job is skeptical scrutiny, NOT validation or encouragement.
- Read every element: every checkbox, date, name, signature line, blank field, procedural step, and cross-reference.
- Identify specifically what is wrong, inconsistent, missing, ambiguous, or procedurally deficient — before stating anything positive.
- Never pattern-match a document to a familiar form and declare it valid without checking every element against the actual requirements.
- If a checkbox for the correct procedure is blank while an incorrect one is checked, say so explicitly.
- If dates are inconsistent or clearly wrong (e.g. "2006" on a 2026 document), flag it.
- If a named recipient is missing where one is required, say so.
- Do NOT lead with "Yes, this is valid" when defects exist. Lead with the defects.
- It is far better to flag a false problem than to miss a real one. The user's legal, financial, and practical interests depend on you catching problems, not confirming hopes.
- Always end document reviews with: "Confirm all of this with your attorney / relevant professional before acting on it."`;

    if (TRACTATUS_ENABLED && memoryContext) {
      systemPrompt = `You are the Informed AI for this user. You have access to their goals, projects, documents, and a durable memory of their commitments and track record.

CORE BEHAVIOR:
- Answer questions narrowly and accurately. Do not pad, editorialize, or add unsolicited encouragement.
- Default tone is neutral and factual — not ingratiating, not harsh. State what is true.
- Never invent facts, dates, names, or outcomes. If you do not know something, say so plainly.
- When the user sends a document or image, read every detail carefully before responding.
${preferencesBlock}
TRACTATUS MEMORY (authoritative — takes priority over any conflicting context):
${memoryContext}

Memory rules:
- Never contradict a REJECTS or ASSERTS entry without explicit CONFLICT_FLAG acknowledgment.
- When the user states a new long-term commitment or corrects a previous one, it will be recorded after this turn.
- When you detect a contradiction between what the user now says and what is in memory, flag it explicitly.
${documentScrutinyRules}

CURRENT SESSION CONTEXT:
${taskContext}

${projectContext}

${docContext}${priorConversationContext ? `\n\n${priorConversationContext}` : ""}`;
    } else {
      systemPrompt = `You are an AI assistant with knowledge of this specific user's goals, projects, and track record. You are not a generic assistant — you have their data.

CORE BEHAVIOR:
- Answer questions narrowly and accurately. Do not pad, editorialize, or add unsolicited encouragement.
- Default tone is neutral and factual — not ingratiating, not harsh. State what is true.
- Reason from the user's ACTUAL data (goals, follow-through rates, journal) — not generic principles.
- When they ask about their projects or goals, you already have the context — don't ask them to re-explain.
- When the user sends a document or image, read every detail carefully before responding.
- Never make up facts about their data. If you don't see something in the context, say so plainly.
${preferencesBlock}${documentScrutinyRules}

USER CONTEXT:
${taskContext}

${projectContext}

${docContext}${priorConversationContext ? `\n\n${priorConversationContext}` : ""}`;
    }

    // Build conversation history for Claude
    const convo: MessageParam[] = await Promise.all(history.slice(-MAX_HISTORY).map(async (m) => {
      if (m.role !== "user") return { role: "assistant" as const, content: m.content };

      let storedImgs: Array<{ data: string; mediaType: string }> = [];
      if (m.attachments) {
        try {
          const atts = JSON.parse(m.attachments) as Array<{ type: string; data?: string; mediaType?: string }>;
          storedImgs = atts.filter((a) => a.type === "image" && a.data && a.mediaType).map((a) => ({ data: a.data!, mediaType: a.mediaType! }));
        } catch { /* ignore */ }
      } else if (m.imageData && m.imageMediaType) {
        storedImgs = [{ data: m.imageData, mediaType: m.imageMediaType }];
      }

      const textContent = (m.content.startsWith("[") && m.content.endsWith("]")) ? "" : m.content;
      if (storedImgs.length > 0) {
        const normalizedImgs = await Promise.all(storedImgs.map(async (img) => {
          try { return await normalizeImage(img); } catch { return img as typeof img & { mediaType: "image/jpeg" }; }
        }));
        const blocks: (ImageBlockParam | TextBlockParam)[] = normalizedImgs.map((img) => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: img.data },
        }));
        if (textContent) blocks.push({ type: "text", text: textContent });
        return { role: "user" as const, content: blocks };
      }
      return { role: "user" as const, content: textContent || m.content };
    }));

    // Append current message — images + document blocks + text in one content array
    const fullUserText = [userText, ...ocrParts].filter(Boolean).join("\n\n");
    const hasBlocks = hasImages || docBlocks.length > 0;

    if (hasBlocks) {
      const blocks: (ImageBlockParam | TextBlockParam | DocumentBlockParam)[] = [];
      if (hasImages && images) {
        for (const img of images) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: img.data },
          });
        }
      }
      blocks.push(...docBlocks);
      if (fullUserText) blocks.push({ type: "text", text: fullUserText });
      convo.push({ role: "user", content: blocks });
    } else {
      convo.push({ role: "user", content: fullUserText || userText || "(no text)" });
    }

    let fullResponse = "";
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: convo,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }

    if (fullResponse) {
      await db.insert(informedMessagesTable).values({
        id: randomUUID(), userId, conversationId, role: "assistant", content: fullResponse,
      });
    }

    res.write(`data: ${JSON.stringify({ done: true, isFirstMessage })}\n\n`);
    res.end();

    // ── Post-turn: extract delta and update Tier 1 (fire-and-forget) ──────────
    if (TRACTATUS_ENABLED && fullResponse && userText) {
      setImmediate(async () => {
        try {
          const delta = await extractDeltaFromTurn(userText, fullResponse, jobId, jobType);
          if (delta.length > 0) {
            await updateLiveTier(jobId, jobType, delta);
            req.log.info({ jobId, deltaNodes: delta.length }, "Tractatus: Tier 1 updated");
          }
        } catch (err) {
          req.log.error({ err }, "Tractatus: post-turn delta extraction failed");
        }
      });
    }

  } catch (err) {
    req.log.error({ err }, "Informed chat failed");
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
    res.end();
  }
});

export default router;
