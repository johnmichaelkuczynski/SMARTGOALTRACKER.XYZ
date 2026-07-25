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
import type { MessageParam, ImageBlockParam, TextBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { createRequire } from "module";
import { azureOcr } from "../lib/azureOcr";
import {
  buildTieredPromptContext,
  extractDeltaFromTurn,
  extractUserSkeleton,
  skeletonToTier0,
  loadAllTiers,
  auditAgainstMemory,
} from "../services/tractatusMemory";

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse = _require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
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
  try {
    const id = randomUUID();
    const [row] = await db.insert(informedConversationsTable)
      .values({ id, userId, title: "New chat" })
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
  const { message, conversationId, context, images, documents } = req.body as {
    message?: string;
    conversationId?: string;
    context?: FrontendContext;
    images?: Array<{ data: string; mediaType: string; name?: string }>;
    documents?: Array<{ name: string; mediaType: string; text?: string; data?: string }>;
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

    // Extract text from all documents
    const docParts: string[] = [];
    if (hasDocs && documents) {
      for (const doc of documents) {
        let text = doc.text ?? "";
        if (!text && doc.data) {
          const buf = Buffer.from(doc.data, "base64");
          const isDocx = doc.mediaType?.includes("wordprocessingml") || doc.mediaType?.includes("msword") || doc.name.match(/\.docx?$/i);
          const isPdf = doc.mediaType === "application/pdf" || doc.name.endsWith(".pdf");
          try {
            if (isPdf) {
              const parsed = await pdfParse(buf);
              text = parsed.text ?? "";
            } else if (isDocx) {
              const result = await mammoth.extractRawText({ buffer: buf });
              text = result.value ?? "";
            }
          } catch (err) {
            req.log.warn({ err }, "Document parse failed");
          }
        }
        if (text.trim()) docParts.push(`[Contents of "${doc.name}":\n${cap(text.trim(), 40_000)}]`);
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
        const existingTiers = await loadAllTiers(jobId, jobType);
        const hasTier0 = existingTiers.some((t) => t.tier === 0);

        if (!hasTier0) {
          // First use — extract skeleton from current state and store as Tier 0
          req.log.info({ jobId }, "Tractatus: extracting initial skeleton");
          const recentHistory = history.slice(-10).map((m) => ({ role: m.role, content: m.content }));

          // Pull tasks/rules/journal from global docs as proxy if context is available
          const stateForSkeleton = {
            tasks: context?.goals?.map((g) => ({ title: g.title, notes: g.notes, timeframe: g.timeframe })) ?? [],
            rules: [],
            journal: context?.reflections?.map((r) => ({ content: r.text })) ?? [],
          };

          const skeleton = await extractUserSkeleton(userId, stateForSkeleton, recentHistory);
          await skeletonToTier0(skeleton, jobId, jobType);
          req.log.info({ jobId, nodes: skeleton.outline.length }, "Tractatus: Tier 0 created");
        }

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

    if (TRACTATUS_ENABLED && memoryContext) {
      systemPrompt = `You are the Informed AI for this user. You have access to a durable Tractatus memory of their goals, commitments, successes, failures, entities, and open questions.

TRACTATUS MEMORY (authoritative — takes priority over any conflicting temporary context):
${memoryContext}

Rules:
- Never contradict a REJECTS or ASSERTS entry without explicit CONFLICT_FLAG acknowledgment.
- Prefer the memory over any temporary context that conflicts with it.
- When the user states a new long-term commitment or corrects a previous one, it will be written into the memory after this turn.
- Never invent facts, dates, names, or outcomes. If you do not know, say so.
- When you detect a contradiction between what the user now says and what is in memory, flag it explicitly rather than silently adopting the new claim.

CURRENT SESSION CONTEXT (short-term, may be incomplete):
${taskContext}

${projectContext}

${docContext}`;
    } else {
      systemPrompt = `You are an AI assistant with complete knowledge of this specific user's life, goals, and projects inside their Goal Tracker app. You are not a generic assistant — you know this person.

Here is everything you know about the user right now:

${taskContext}

${projectContext}

${docContext}

How to use this knowledge:
- When the user asks for advice, plans, or decisions, reason from their ACTUAL track record, not generic principles.
- When they ask about their projects, you already know the context — don't ask them to re-explain.
- When they ask "what should I work on today?", look at their goals, follow-through patterns, and projects and give a specific, reasoned answer.
- When the user sends an image, read it carefully and describe or extract all relevant information from it (OCR, analysis, etc.).
- Be direct, honest, and specific. A sharp advisor who actually knows their situation, not a generic chatbot.
- Never make up facts about their data. If you don't see something in the context, say so.`;
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

    // Append current message
    const fullUserText = [userText, ...ocrParts, ...docParts].filter(Boolean).join("\n\n");
    if (hasImages && images) {
      const blocks: (ImageBlockParam | TextBlockParam)[] = images.map((img) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: img.data },
      }));
      if (fullUserText) blocks.push({ type: "text", text: fullUserText });
      convo.push({ role: "user", content: blocks });
    } else {
      convo.push({ role: "user", content: fullUserText || userText });
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
