import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  accomplishmentsTable,
  db,
  documentsTable,
  userStateTable,
} from "@workspace/db";

const router: IRouter = Router();
const MODEL = "gpt-5.4";

type Message = { role: "user" | "assistant"; content: string };
type StoredState = {
  tasks?: Array<Record<string, unknown>>;
  completions?: Array<Record<string, unknown>>;
  journal?: Array<Record<string, unknown>>;
  diary?: Array<Record<string, unknown>>;
  rules?: Array<Record<string, unknown>>;
  mindContext?: string;
};

const cap = (value: unknown, limit: number) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

router.post("/diary/chat", async (req, res): Promise<void> => {
  const date = typeof req.body?.date === "string" ? req.body.date : "";
  const entry = typeof req.body?.entry === "string" ? req.body.entry.trim() : "";
  const messages = Array.isArray(req.body?.messages)
    ? req.body.messages
        .filter(
          (item: unknown): item is Message =>
            Boolean(
              item &&
                typeof item === "object" &&
                (((item as Message).role === "user") || ((item as Message).role === "assistant")) &&
                typeof (item as Message).content === "string",
            ),
        )
        .slice(-20)
    : [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !entry || messages.length === 0) {
    res.status(400).json({ error: "A dated diary entry and question are required." });
    return;
  }

  const userId = req.userId!;
  try {
    const [stateRows, accomplishments, documents] = await Promise.all([
      db.select().from(userStateTable).where(eq(userStateTable.userId, userId)).limit(1),
      db
        .select()
        .from(accomplishmentsTable)
        .where(eq(accomplishmentsTable.userId, userId))
        .orderBy(desc(accomplishmentsTable.date))
        .limit(80),
      db
        .select({ name: documentsTable.name, text: documentsTable.extractedText })
        .from(documentsTable)
        .where(eq(documentsTable.userId, userId)),
    ]);

    const stored = (stateRows[0]?.data ?? {}) as StoredState;
    const tasks = (stored.tasks ?? []).slice(-250).map((task) => ({
      title: cap(task.title, 300),
      notes: cap(task.notes, 800),
      date: task.date,
      timeframe: task.timeframe,
      importance: task.importance,
      archived: task.archived,
      subtasks: task.subtasks,
    }));
    const context = {
      databaseUpdatedAt: stateRows[0]?.updatedAt?.toISOString() ?? null,
      tasksAndGoals: tasks,
      completions: (stored.completions ?? []).slice(-500),
      journal: (stored.journal ?? []).slice(-80),
      diaryHistory: (stored.diary ?? []).slice(-80).map((item) => ({
        date: item.date,
        text: cap(item.text, 3000),
      })),
      accomplishments: accomplishments.map((item) => ({
        date: item.date,
        text: cap(item.text, 2000),
      })),
      rules: (stored.rules ?? []).slice(-100),
      personalContext: cap(stored.mindContext, 4000),
      documents: documents.slice(0, 12).map((item) => ({
        name: item.name,
        text: cap(item.text, 5000),
      })),
    };

    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 220,
      messages: [
        {
          role: "system",
          content: `You are the user's Living Diary: perceptive, conversational, honest, and informed by their authenticated Goal Tracker database. Respond to the question or reflection in the current diary entry. Use relevant stored tasks, goals, completion history, journal and diary entries, accomplishments, rules, personal context, and documents. Distinguish evidence from inference. Never invent facts. Do not diagnose. If the stored evidence is insufficient, say so. Avoid canned therapy language and rigid analytical templates. Answer in exactly one concise paragraph of no more than 120 words. Do not use headings, lists, or separate paragraphs.`,
        },
        {
          role: "system",
          content: `AUTHORITATIVE CURRENT DATABASE CONTEXT:\n${JSON.stringify(context)}`,
        },
        {
          role: "system",
          content: `CURRENT DIARY ENTRY FOR ${date}:\n${entry}`,
        },
        ...messages.map((message: Message) => ({
          role: message.role,
          content: cap(message.content, 6000),
        })),
      ],
    });

    const rawReply = completion.choices[0]?.message?.content?.trim();
    const reply = rawReply
      ? rawReply.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim()
      : "";
    if (!reply) {
      res.status(502).json({ error: "The Living Diary returned no answer." });
      return;
    }
    res.json({ reply });
  } catch (err) {
    req.log.error({ err }, "Living Diary response failed");
    res.status(500).json({ error: "The Living Diary could not answer right now." });
  }
});

export default router;