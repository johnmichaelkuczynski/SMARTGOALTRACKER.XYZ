import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  db,
  legalMessagesTable,
  legalConversationsTable,
  legalDocumentsTable,
  documentsTable,
  projectsTable,
  projectMessagesTable,
  projectDocumentsTable,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { nanoid } from "nanoid";
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
  const tmpPath = join(tmpdir(), `legal-doc-${randomUUID()}.doc`);
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
const objectStorage = new ObjectStorageService();
const MODEL = "claude-sonnet-4-6";
const MAX_HISTORY = 40;
const MAX_DOC_CHARS = 8000;
const MAX_PROJECT_MSG_CHARS = 3000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface FrontendContext {
  today?: string;
  [key: string]: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const cap = (s: string, n: number) => s.length > n ? s.slice(0, n) + "…" : s;

function titleFromMessage(msg: string): string {
  const clean = msg.replace(/\s+/g, " ").trim();
  return clean.length > 60 ? clean.slice(0, 57) + "…" : clean || "Image";
}

// ── Documents library ─────────────────────────────────────────────────────────

router.get("/legal/documents", async (req, res): Promise<void> => {
  const userId = req.userId!;
  try {
    const rows = await db.select({
      id: legalDocumentsTable.id,
      conversationId: legalDocumentsTable.conversationId,
      name: legalDocumentsTable.name,
      contentType: legalDocumentsTable.contentType,
      size: legalDocumentsTable.size,
      charCount: legalDocumentsTable.charCount,
      createdAt: legalDocumentsTable.createdAt,
    })
      .from(legalDocumentsTable)
      .where(eq(legalDocumentsTable.userId, userId))
      .orderBy(desc(legalDocumentsTable.createdAt));
    res.json({ documents: rows });
  } catch (err) {
    req.log.error({ err }, "Failed to list legal documents");
    res.status(500).json({ error: "Failed to load documents" });
  }
});

// ── Conversations ─────────────────────────────────────────────────────────────

router.get("/legal/conversations", async (req, res): Promise<void> => {
  const userId = req.userId!;
  try {
    const rows = await db.select()
      .from(legalConversationsTable)
      .where(eq(legalConversationsTable.userId, userId))
      .orderBy(desc(legalConversationsTable.updatedAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list legal conversations");
    res.status(500).json({ error: "Failed to load conversations" });
  }
});

router.post("/legal/conversations", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { parentId } = req.body as { parentId?: string };
  try {
    if (parentId) {
      const parent = await db.select({ id: legalConversationsTable.id })
        .from(legalConversationsTable)
        .where(and(eq(legalConversationsTable.id, parentId), eq(legalConversationsTable.userId, userId)))
        .limit(1);
      if (parent.length === 0) {
        res.status(400).json({ error: "Invalid parentId" });
        return;
      }
    }
    const id = randomUUID();
    const [row] = await db.insert(legalConversationsTable)
      .values({ id, userId, title: "New chat", parentId: parentId ?? null })
      .returning();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create legal conversation");
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.delete("/legal/conversations/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  try {
    await db.delete(legalMessagesTable).where(
      and(eq(legalMessagesTable.conversationId, id), eq(legalMessagesTable.userId, userId))
    );
    await db.delete(legalConversationsTable).where(
      and(eq(legalConversationsTable.id, id), eq(legalConversationsTable.userId, userId))
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete legal conversation");
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

// ── Messages for a conversation ───────────────────────────────────────────────

router.get("/legal/conversations/:id/messages", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  try {
    const msgs = await db.select()
      .from(legalMessagesTable)
      .where(
        and(eq(legalMessagesTable.conversationId, id), eq(legalMessagesTable.userId, userId))
      )
      .orderBy(legalMessagesTable.createdAt);
    res.json(msgs);
  } catch (err) {
    req.log.error({ err }, "Failed to load legal messages");
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// ── Memory endpoints ──────────────────────────────────────────────────────────

router.get("/legal/memory/status", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const jobId = `${userId}-legal`;
  const jobType = "legal_practice";
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
    req.log.error({ err }, "Legal memory status failed");
    res.status(500).json({ error: "Failed to load memory status" });
  }
});

/** Full memory viewer — returns every tier with every node. */
router.get("/legal/memory/view", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const jobId = `${userId}-legal`;
  const jobType = "legal_practice";
  try {
    const tiers = await viewAllTiers(jobId, jobType);
    res.json({ tiers });
  } catch (err) {
    req.log.error({ err }, "Legal memory view failed");
    res.status(500).json({ error: "Failed to load memory" });
  }
});

/** Force-compress all bloated tiers. */
router.post("/legal/memory/repair", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const jobId = `${userId}-legal`;
  const jobType = "legal_practice";
  try {
    const result = await forceRepairMemory(jobId, jobType);
    res.json({ ok: true, ...result });
  } catch (err) {
    req.log.error({ err }, "Legal memory repair failed");
    res.status(500).json({ error: "Repair failed" });
  }
});

// ── Audit endpoint ────────────────────────────────────────────────────────────

router.post("/legal/audit", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { text } = req.body as { text?: string };
  if (!text?.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  const jobId = `${userId}-legal`;
  const jobType = "legal_practice";
  try {
    const report = await auditAgainstMemory(text, jobId, jobType);
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Legal audit failed");
    res.status(500).json({ error: "Audit failed" });
  }
});

// ── Chat (SSE streaming) ──────────────────────────────────────────────────────

router.post("/legal/chat", async (req, res): Promise<void> => {
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

  // Tractatus job identifiers (separate namespace from Informed)
  const jobId = `${userId}-legal`;
  const jobType = "legal_practice";

  try {
    const [convRow] = await db.select()
      .from(legalConversationsTable)
      .where(and(eq(legalConversationsTable.id, conversationId), eq(legalConversationsTable.userId, userId)))
      .limit(1);

    const [history, globalDocs, projects] = await Promise.all([
      db.select().from(legalMessagesTable)
        .where(and(eq(legalMessagesTable.conversationId, conversationId), eq(legalMessagesTable.userId, userId)))
        .orderBy(legalMessagesTable.createdAt),
      db.select({ name: documentsTable.name, text: documentsTable.extractedText })
        .from(documentsTable).where(eq(documentsTable.userId, userId)),
      db.select().from(projectsTable)
        .where(eq(projectsTable.userId, userId))
        .orderBy(desc(projectsTable.updatedAt)),
    ]);

    // Fetch parent conversation history
    let priorConversationContext = "";
    if (convRow?.parentId) {
      const parentMsgs = await db.select({ role: legalMessagesTable.role, content: legalMessagesTable.content })
        .from(legalMessagesTable)
        .where(and(eq(legalMessagesTable.conversationId, convRow.parentId), eq(legalMessagesTable.userId, userId)))
        .orderBy(legalMessagesTable.createdAt);
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

    // Build document content blocks + persist each document to object storage
    const docBlocks: DocumentBlockParam[] = [];
    const userMsgId = randomUUID();

    if (hasDocs && documents) {
      await Promise.all(documents.map(async (doc) => {
        const isPdf  = doc.mediaType === "application/pdf" || doc.name.toLowerCase().endsWith(".pdf");
        const isDocx = !!(doc.mediaType?.includes("wordprocessingml") || doc.name.toLowerCase().endsWith(".docx"));
        const isDoc  = !!(doc.mediaType === "application/msword" || (doc.name.toLowerCase().endsWith(".doc") && !doc.name.toLowerCase().endsWith(".docx")));
        const isText = doc.mediaType === "text/plain" || doc.name.toLowerCase().endsWith(".txt");

        let extractedText = "";

        if (isPdf && doc.data) {
          docBlocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: doc.data },
          } as DocumentBlockParam);
        } else if (isDocx && doc.data) {
          // Modern .docx — mammoth handles XML-based Word format
          try {
            const buf = Buffer.from(doc.data, "base64");
            const result = await mammoth.extractRawText({ buffer: buf });
            extractedText = result.value?.trim() ?? "";
            if (extractedText) {
              docBlocks.push({
                type: "document",
                source: { type: "text", media_type: "text/plain", data: cap(extractedText, 80_000) },
              } as DocumentBlockParam);
            }
          } catch (err) {
            req.log.warn({ err, name: doc.name }, "DOCX parse failed");
          }
        } else if (isDoc && doc.data) {
          // Legacy binary .doc — mammoth cannot read this; use antiword
          try {
            const buf = Buffer.from(doc.data, "base64");
            extractedText = await extractDocText(buf);
            if (extractedText) {
              docBlocks.push({
                type: "document",
                source: { type: "text", media_type: "text/plain", data: cap(extractedText, 80_000) },
              } as DocumentBlockParam);
            }
          } catch (err) {
            req.log.warn({ err, name: doc.name }, "DOC (legacy) parse failed via antiword");
          }
        } else if (isText && doc.text?.trim()) {
          extractedText = doc.text.trim();
          docBlocks.push({
            type: "document",
            source: { type: "text", media_type: "text/plain", data: cap(extractedText, 80_000) },
          } as DocumentBlockParam);
        }

        // Persist to object storage + legal_documents table
        try {
          const rawBuf: Buffer | null = doc.data
            ? Buffer.from(doc.data, "base64")
            : doc.text
            ? Buffer.from(doc.text, "utf8")
            : null;

          if (rawBuf) {
            const objectPath = await objectStorage.uploadBuffer(rawBuf, doc.mediaType);
            const finalExtracted = extractedText || (isText && doc.text ? doc.text.trim() : "");
            await db.insert(legalDocumentsTable).values({
              id: nanoid(),
              userId,
              conversationId,
              messageId: userMsgId,
              name: doc.name,
              contentType: doc.mediaType,
              objectPath,
              extractedText: finalExtracted.slice(0, 200_000),
              size: rawBuf.length,
              charCount: finalExtracted.length,
            });
          }
        } catch (storageErr) {
          req.log.warn({ storageErr, name: doc.name }, "Legal: failed to persist document to storage");
        }
      }));
    }

    // Build attachments JSON for storage
    const storedAttachments = [
      ...(images?.map((img) => ({ type: "image", name: img.name ?? "image", mediaType: img.mediaType, data: img.data })) ?? []),
      ...(documents?.map((doc) => ({ type: "document", name: doc.name, mediaType: doc.mediaType })) ?? []),
    ];

    // Save user message (using pre-generated ID so documents can reference it)
    const isFirstMessage = history.length === 0;
    const userText = message?.trim() ?? "";
    const contentLabel = userText
      || (hasDocs && documents!.length === 1 ? `[${documents![0].name}]` : hasDocs ? `[${documents!.length} documents]` : "")
      || (hasImages && images!.length === 1 ? "[image]" : hasImages ? `[${images!.length} images]` : "");
    await db.insert(legalMessagesTable).values({
      id: userMsgId,
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
      await db.update(legalConversationsTable)
        .set({ title: titleFromMessage(titleSource), updatedAt: new Date() })
        .where(and(eq(legalConversationsTable.id, conversationId), eq(legalConversationsTable.userId, userId)));
    } else {
      await db.update(legalConversationsTable)
        .set({ updatedAt: new Date() })
        .where(and(eq(legalConversationsTable.id, conversationId), eq(legalConversationsTable.userId, userId)));
    }

    // ── Tractatus memory ───────────────────────────────────────────────────────
    let memoryContext = "";
    if (TRACTATUS_ENABLED) {
      try {
        memoryContext = await buildTieredPromptContext(jobId, jobType);
      } catch (err) {
        req.log.error({ err }, "Legal Tractatus memory build failed — falling back");
        memoryContext = "";
      }
    }

    // ── Build context sections ─────────────────────────────────────────────────
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
      strongly_critical: "TONE: Be maximally skeptical and critical. Actively seek flaws, weaknesses, gaps, contradictions, and counterarguments. Lead with what is wrong or questionable. Do not soften criticism.",
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

    // ── Legal-specific scrutiny rules ─────────────────────────────────────────
    const legalScrutinyRules = `
LEGAL DOCUMENT AND VALIDITY REVIEW — MANDATORY RULES:
This assistant specializes in legal analysis. Apply rigorous legal scrutiny to EVERY question.

DOCUMENT REVIEW:
- Read every element of any document: every checkbox, date, name, signature line, blank field, procedural step, clause, and cross-reference.
- Identify specifically what is wrong, inconsistent, missing, ambiguous, procedurally deficient, or legally risky — BEFORE stating anything positive.
- Never pattern-match a document to a familiar form and declare it valid without checking every element against actual requirements.
- If a checkbox for the correct procedure is blank while an incorrect one is checked, say so explicitly and first.
- If dates are inconsistent or clearly wrong, flag them.
- If required signatures, witnesses, or notarization are missing or improperly executed, say so.
- Do NOT lead with "Yes, this is valid" or "This looks fine" when defects exist. Lead with the defects.
- It is far better to flag a false problem than to miss a real one. The user's legal interests depend on catching problems, not confirming hopes.
- Always end document reviews with: "Verify all of this with a licensed attorney before acting on it."

GENERAL LEGAL ANALYSIS:
- Cite specific legal standards, statutes, rules, or procedural requirements when known (and flag if you are uncertain).
- Distinguish clearly between what is legally required vs. what is merely conventional or advisable.
- Flag jurisdictional issues — note when the answer depends on which jurisdiction applies.
- Do not assume the law is uniform across states/countries. Say explicitly when it varies.
- When discussing rights, obligations, deadlines, or consequences, be precise — vague reassurances are harmful.
- Never give a "comfort answer." If the legal situation is ambiguous, uncertain, or risky, say so clearly.
- ALWAYS end substantive legal analysis with a reminder to consult a licensed attorney.`;

    let systemPrompt: string;

    if (TRACTATUS_ENABLED && memoryContext) {
      systemPrompt = `You are the Legal LLM for this user — a specialized legal analysis assistant. Your role is rigorous, accurate, and skeptical legal analysis.

CORE BEHAVIOR:
- Answer legal questions narrowly, precisely, and accurately. No padding, no unsolicited reassurance.
- Default tone is neutral and analytical — not ingratiating, not alarmist. State what the law requires.
- Never invent legal standards, case names, statutes, or procedural rules. If uncertain, say so explicitly.
- When you review a document, read every detail before responding.
- Distinguish facts from law from opinion clearly in every answer.
- Jurisdictional differences matter enormously — always note when the answer varies by jurisdiction.
${preferencesBlock}
TRACTATUS MEMORY (authoritative — captures prior legal matters discussed):
${memoryContext}

Memory rules:
- When the user references a prior matter, filing, or document, treat stored memory as context.
- When you detect a contradiction between what the user now says and what is in memory, flag it.
${legalScrutinyRules}

${projectContext}

${docContext}${priorConversationContext ? `\n\n${priorConversationContext}` : ""}`;
    } else {
      systemPrompt = `You are a specialized legal analysis AI. Your role is rigorous, accurate, and skeptical legal analysis.

CORE BEHAVIOR:
- Answer legal questions narrowly, precisely, and accurately. No padding, no unsolicited reassurance.
- Default tone is neutral and analytical — not ingratiating, not alarmist. State what the law requires.
- Never invent legal standards, case names, statutes, or procedural rules. If uncertain, say so explicitly.
- When you review a document, read every detail before responding.
- Distinguish facts from law from opinion clearly in every answer.
- Jurisdictional differences matter enormously — always note when the answer varies by jurisdiction.
${preferencesBlock}${legalScrutinyRules}

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

    // Append current message
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
      await db.insert(legalMessagesTable).values({
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
            req.log.info({ jobId, deltaNodes: delta.length }, "Legal Tractatus: Tier 1 updated");
          }
        } catch (err) {
          req.log.error({ err }, "Legal Tractatus: post-turn delta extraction failed");
        }
      });
    }

  } catch (err) {
    req.log.error({ err }, "Legal chat failed");
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
    res.end();
  }
});

export default router;
