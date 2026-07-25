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

// ── Chat (SSE streaming) ──────────────────────────────────────────────────────

router.post("/informed/chat", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { message, conversationId, context, imageData, imageMediaType } = req.body as {
    message?: string;
    conversationId?: string;
    context?: FrontendContext;
    imageData?: string;
    imageMediaType?: string;
  };

  const hasImage = !!(imageData && imageMediaType);
  if (!message?.trim() && !hasImage) {
    res.status(400).json({ error: "Message or image is required" });
    return;
  }
  if (!conversationId) {
    res.status(400).json({ error: "conversationId is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

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

    // Save user message (store image alongside text)
    const isFirstMessage = history.length === 0;
    const userText = message?.trim() ?? "";
    await db.insert(informedMessagesTable).values({
      id: randomUUID(),
      userId,
      conversationId,
      role: "user",
      content: userText || "[image]",
      imageData: hasImage ? imageData : null,
      imageMediaType: hasImage ? imageMediaType : null,
    });

    // Auto-title from first message
    const titleSource = userText || (hasImage ? "Image" : "New chat");
    if (isFirstMessage) {
      await db.update(informedConversationsTable)
        .set({ title: titleFromMessage(titleSource), updatedAt: new Date() })
        .where(and(eq(informedConversationsTable.id, conversationId), eq(informedConversationsTable.userId, userId)));
    } else {
      await db.update(informedConversationsTable)
        .set({ updatedAt: new Date() })
        .where(and(eq(informedConversationsTable.id, conversationId), eq(informedConversationsTable.userId, userId)));
    }

    // Build system prompt
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

    const systemPrompt = `You are an AI assistant with complete knowledge of this specific user's life, goals, and projects inside their Goal Tracker app. You are not a generic assistant — you know this person.

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

    // Build conversation history for Claude — include images for stored messages
    const convo: MessageParam[] = history.slice(-MAX_HISTORY).map((m) => {
      if (m.role === "user" && m.imageData && m.imageMediaType) {
        return buildUserMessage(m.content === "[image]" ? "" : m.content, m.imageData, m.imageMediaType);
      }
      return { role: m.role as "user" | "assistant", content: m.content };
    });

    // Append current message (with image if present)
    convo.push(buildUserMessage(userText, imageData, imageMediaType));

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
  } catch (err) {
    req.log.error({ err }, "Informed chat failed");
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
    res.end();
  }
});

export default router;
