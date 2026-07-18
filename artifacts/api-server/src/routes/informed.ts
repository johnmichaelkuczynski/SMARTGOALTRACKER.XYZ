import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  db,
  informedMessagesTable,
  userStateTable,
  documentsTable,
  projectsTable,
  projectMessagesTable,
  projectDocumentsTable,
} from "@workspace/db";

const router: IRouter = Router();
const MODEL = "claude-sonnet-4-6";
const MAX_HISTORY = 40;
const MAX_DOC_CHARS = 8000;
const MAX_PROJECT_MSG_CHARS = 3000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function cap(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function pct(rate: number, due: number): string {
  return due > 0 ? `${Math.round(rate * 100)}%` : "untracked";
}

interface StatSummary { label: string; done: number; due: number; rate: number }
interface GoalSnapshot {
  title: string; notes?: string | null; timeframe: string;
  importance?: number | null; done: number; due: number; rate: number;
}
interface Reflection { period: string; label: string; text: string }
interface Category { name: string; rate: number; taskCount: number; due: number }

interface AppState {
  overall?: StatSummary;
  byTimeframe?: StatSummary[];
  goals?: GoalSnapshot[];
  categories?: Category[];
  reflections?: Reflection[];
  profileSummary?: string | null;
  today?: string;
}

function buildTaskContext(state: AppState): string {
  const parts: string[] = [];
  parts.push(`TODAY: ${state.today ?? new Date().toDateString()}`);

  if (state.overall) {
    parts.push(`OVERALL FOLLOW-THROUGH: ${pct(state.overall.rate, state.overall.due)} (${state.overall.done}/${state.overall.due} tracked completions)`);
  }

  if (state.byTimeframe?.length) {
    parts.push(`BY TIMEFRAME:\n${state.byTimeframe.map((s) => `  - ${s.label}: ${pct(s.rate, s.due)} (${s.done}/${s.due})`).join("\n")}`);
  }

  if (state.goals?.length) {
    const lines = state.goals.slice(0, 60).map((g) => {
      const imp = g.importance != null ? `, importance ${g.importance}/10` : "";
      const note = g.notes ? ` — "${cap(g.notes, 200)}"` : "";
      return `  - "${g.title}" (${g.timeframe}${imp}) — follow-through ${pct(g.rate, g.due)}${note}`;
    });
    parts.push(`GOALS:\n${lines.join("\n")}`);
  } else {
    parts.push("GOALS: (none set yet)");
  }

  if (state.categories?.length) {
    const lines = state.categories.map((c) => `  - ${c.name}: ${pct(c.rate, c.due)} across ${c.taskCount} goal(s)`);
    parts.push(`BY CATEGORY:\n${lines.join("\n")}`);
  }

  if (state.reflections?.length) {
    const lines = state.reflections.slice(0, 15).map((r) => `(${r.period}) ${r.label}:\n${cap(r.text, 600)}`);
    parts.push(`USER'S OWN REFLECTIONS:\n${lines.join("\n\n")}`);
  }

  if (state.profileSummary) {
    parts.push(`PSYCHOLOGICAL PROFILE:\n${cap(state.profileSummary, 2000)}`);
  }

  return parts.join("\n\n");
}

// ── Get conversation history ──────────────────────────────────────────────────

router.get("/informed/messages", async (req, res): Promise<void> => {
  const userId = req.userId!;
  try {
    const messages = await db
      .select()
      .from(informedMessagesTable)
      .where(eq(informedMessagesTable.userId, userId))
      .orderBy(informedMessagesTable.createdAt);
    res.json(messages);
  } catch (err) {
    req.log.error({ err }, "Failed to load informed messages");
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// ── Clear conversation ────────────────────────────────────────────────────────

router.delete("/informed/messages", async (req, res): Promise<void> => {
  const userId = req.userId!;
  try {
    await db.delete(informedMessagesTable).where(eq(informedMessagesTable.userId, userId));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to clear informed messages");
    res.status(500).json({ error: "Failed to clear conversation" });
  }
});

// ── Chat (streaming SSE) ──────────────────────────────────────────────────────

router.post("/informed/chat", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { message } = req.body as { message?: string };
  if (!message?.trim()) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    // Load everything in parallel
    const [history, userStateRow, globalDocs, projects] = await Promise.all([
      db.select().from(informedMessagesTable)
        .where(eq(informedMessagesTable.userId, userId))
        .orderBy(informedMessagesTable.createdAt),
      db.select().from(userStateTable)
        .where(eq(userStateTable.userId, userId))
        .limit(1),
      db.select({ name: documentsTable.name, text: documentsTable.extractedText })
        .from(documentsTable)
        .where(eq(documentsTable.userId, userId)),
      db.select().from(projectsTable)
        .where(eq(projectsTable.userId, userId))
        .orderBy(desc(projectsTable.updatedAt)),
    ]);

    // Load project messages and documents for each project (up to 5 most recent)
    const recentProjects = projects.slice(0, 5);
    const projectDetails = await Promise.all(
      recentProjects.map(async (p) => {
        const [msgs, docs] = await Promise.all([
          db.select({ role: projectMessagesTable.role, content: projectMessagesTable.content })
            .from(projectMessagesTable)
            .where(eq(projectMessagesTable.projectId, p.id))
            .orderBy(desc(projectMessagesTable.createdAt))
            .limit(10),
          db.select({ name: projectDocumentsTable.name, content: projectDocumentsTable.content })
            .from(projectDocumentsTable)
            .where(eq(projectDocumentsTable.projectId, p.id)),
        ]);
        return { project: p, messages: msgs.reverse(), docs };
      }),
    );

    // Save user message
    await db.insert(informedMessagesTable).values({
      id: randomUUID(), userId, role: "user", content: message.trim(),
    });

    // Build context blocks
    const appState = (userStateRow[0]?.data ?? {}) as AppState;
    const taskContext = buildTaskContext(appState);

    let projectContext = "";
    if (projectDetails.length > 0) {
      const sections = projectDetails.map(({ project, messages, docs }) => {
        const recent = messages
          .map((m) => `${m.role === "user" ? "USER" : "ADVISOR"}: ${cap(m.content, 400)}`)
          .join("\n");
        const docText = docs
          .map((d) => `  Document "${d.name}": ${cap(d.content, 600)}`)
          .join("\n");
        return [
          `PROJECT: "${project.name}"`,
          project.description ? `Description: ${project.description}` : null,
          docs.length ? `Documents:\n${docText}` : null,
          messages.length ? `Recent conversation (last ${messages.length} messages):\n${cap(recent, MAX_PROJECT_MSG_CHARS)}` : "No conversation yet.",
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
- When the user asks for advice, plans, or decisions, reason from their ACTUAL track record, not generic principles. If they reliably finish one type of goal but always abandon another, say so.
- When they ask about their projects, you already know the context — don't ask them to re-explain.
- When they ask "what should I work on today?", look at their goals, follow-through patterns, and projects and give a specific, reasoned answer.
- When they ask open-ended questions, give sharp, honest answers grounded in their specific situation.
- You can help with ANYTHING — writing, coding, analysis, brainstorming — but you always have this person's full context available to make your help more relevant.
- Be direct, honest, and specific. A sharp advisor who actually knows their situation, not a generic chatbot.
- Never make up facts about their data. If you don't see something in the context, say so.`;

    // Build conversation for Claude
    const convo = history.slice(-MAX_HISTORY).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    convo.push({ role: "user", content: message.trim() });

    // Stream response
    let fullResponse = "";
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: convo,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }

    // Save assistant reply
    if (fullResponse) {
      await db.insert(informedMessagesTable).values({
        id: randomUUID(), userId, role: "assistant", content: fullResponse,
      });
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Informed chat failed");
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
    res.end();
  }
});

export default router;
