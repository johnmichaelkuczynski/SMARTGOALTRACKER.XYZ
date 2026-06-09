import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { ChatAssistantBody, ChatAssistantResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const MODEL = "gpt-5.4";

type StatSummary = { label: string; done: number; due: number; rate: number };
type GoalSnapshot = {
  title: string;
  notes?: string | null;
  timeframe: string;
  importance?: number | null;
  done: number;
  due: number;
  rate: number;
};
type Category = { name: string; rate: number; taskCount: number; due: number };
type ScheduleItem = {
  title: string;
  date: string;
  timeframe: string;
  importance?: number | null;
  status: string;
};
type Reflection = { period: string; label: string; text: string };
type AssistantContext = {
  today?: string;
  overall?: StatSummary;
  byTimeframe?: StatSummary[];
  goals?: GoalSnapshot[];
  categories?: Category[];
  schedule?: ScheduleItem[];
  reflections?: Reflection[];
  profileSummary?: string | null;
};

const MAX_TURNS = 24;
const MAX_NOTE = 400;
const MAX_REFLECTION = 1200;
const MAX_SUMMARY = 2000;

const pct = (rate: number, due: number) => (due > 0 ? `${Math.round(rate * 100)}%` : "untracked");

const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

/** Assemble the full app-state context the model reasons over. Each section is bounded to keep the prompt sane. */
function buildContext(ctx: AssistantContext): string {
  const parts: string[] = [];
  parts.push(`TODAY: ${ctx.today ?? "(unknown)"}`);

  if (ctx.overall) {
    parts.push(
      `OVERALL FOLLOW-THROUGH: ${pct(ctx.overall.rate, ctx.overall.due)} (${ctx.overall.done}/${ctx.overall.due} tracked occurrences completed).`,
    );
  }

  if (ctx.byTimeframe?.length) {
    const lines = ctx.byTimeframe
      .map((s) => `- ${s.label}: ${pct(s.rate, s.due)} (${s.done}/${s.due})`)
      .join("\n");
    parts.push(`FOLLOW-THROUGH BY TIMEFRAME:\n${lines}`);
  }

  if (ctx.goals?.length) {
    const lines = ctx.goals
      .slice(0, 60)
      .map((g) => {
        const imp = g.importance != null ? `, importance ${g.importance}/10` : "";
        const note = g.notes ? ` — note: ${cap(g.notes, MAX_NOTE)}` : "";
        return `- "${g.title}" (${g.timeframe}${imp}) — follow-through ${pct(g.rate, g.due)} (${g.done}/${g.due})${note}`;
      })
      .join("\n");
    parts.push(
      `THE USER'S GOALS AND HOW RELIABLY THEY FOLLOW THROUGH ON EACH:\n${lines}`,
    );
  } else {
    parts.push("THE USER'S GOALS: (none set yet)");
  }

  if (ctx.categories?.length) {
    const lines = ctx.categories
      .map((c) => `- ${c.name}: ${pct(c.rate, c.due)} across ${c.taskCount} goal(s)`)
      .join("\n");
    parts.push(`FOLLOW-THROUGH BY KIND OF GOAL:\n${lines}`);
  }

  if (ctx.schedule?.length) {
    const lines = ctx.schedule
      .slice(0, 60)
      .map((s) => {
        const imp = s.importance != null ? `, importance ${s.importance}/10` : "";
        return `- ${s.date}: "${s.title}" (${s.timeframe}${imp}) [${s.status}]`;
      })
      .join("\n");
    parts.push(`SCHEDULE (today and upcoming):\n${lines}`);
  } else {
    parts.push("SCHEDULE: (nothing scheduled in the near term)");
  }

  if (ctx.reflections?.length) {
    const lines = ctx.reflections
      .slice(0, 20)
      .map((r) => `(${r.period}) ${r.label}:\n${cap(r.text, MAX_REFLECTION)}`)
      .join("\n\n");
    parts.push(`THE USER'S OWN REFLECTIONS (what they say they actually did):\n${lines}`);
  }

  if (ctx.profileSummary) {
    parts.push(
      `PSYCHOLOGICAL PROFILE SUMMARY (built earlier from their goals):\n${cap(ctx.profileSummary, MAX_SUMMARY)}`,
    );
  }

  return parts.join("\n\n");
}

const ASSISTANT_SYSTEM = `You are the assistant built into "Goal Tracker", a calendar-style to-do and goal app whose ethos is honest follow-through. You are talking directly with the user.

You are a fully capable, general-purpose assistant — you can help with anything the user asks, reason, brainstorm, explain, draft, plan, and answer open questions, exactly as a strong general assistant would. You are NOT limited to talking about their goals.

BUT you also have something a generic assistant doesn't: a live snapshot of THIS user's app — what they've scheduled, what they've completed, their analytics, the kinds of goals they set, and crucially how reliably they actually follow through on each kind. A psychological profile summary may also be present. Use this context whenever it makes your answer more useful, personal, or honest.

How to use the context:
- When the user asks what they should do, or whether to take something on, reason from their real schedule and their track record in that KIND of goal — not generic advice. If they reliably finish physical goals but drop learning goals, say so and let it shape your recommendation.
- When they ask "what kind of person am I / what does this say about me", answer candidly and specifically from the data: completion rates by category, the gap between what they schedule and what they finish, what their reflections reveal. Be perceptive and truthful, warm but unsparing — a sharp friend, not a flatterer or a therapist.
- Notice and name patterns: procrastination on certain categories, over-scheduling, importance vs. follow-through mismatches, intention-vs-action gaps between goals and reflections.
- For general/off-topic questions, just answer well; weave in their context only if relevant.

Rules:
- Never invent goals, tasks, stats, or completions you weren't given. If the data doesn't support a claim, say so plainly.
- No medical or psychiatric diagnoses. Treat anything risky soberly, without moralising lectures.
- Keep replies tight and readable — usually a few sentences or a short list, longer only when the user clearly wants depth.`;

router.post("/assistant/chat", async (req, res): Promise<void> => {
  const parsed = ChatAssistantBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid assistant chat body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { messages, context } = parsed.data as {
    messages: { role: string; content: string }[];
    context: AssistantContext;
  };

  const contextBlock = buildContext(context);

  const convo = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
    .slice(-MAX_TURNS);

  if (convo.length === 0) {
    res.status(400).json({ error: "No messages to respond to." });
    return;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: ASSISTANT_SYSTEM },
        { role: "system", content: `CURRENT APP CONTEXT FOR THIS USER:\n\n${contextBlock}` },
        ...convo,
      ],
    });

    const reply =
      completion.choices[0]?.message?.content?.trim() ||
      "I'm not sure how to answer that. Try rephrasing.";
    res.json(ChatAssistantResponse.parse({ reply }));
  } catch (err) {
    req.log.error({ err }, "Assistant chat failed");
    res.status(500).json({ error: "Couldn't get a reply right now. Try again in a moment." });
  }
});

export default router;
