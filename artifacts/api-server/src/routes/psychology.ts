import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  AnalyzePsychologyBody,
  AnalyzePsychologyResponse,
  ChatPsychologyBody,
  ChatPsychologyResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const MODEL = "gpt-5.4";

type GoalSnapshot = {
  title: string;
  notes?: string | null;
  timeframe: string;
  importance?: number | null;
  done: number;
  due: number;
  rate: number;
};

type Category = {
  name: string;
  blurb: string;
  taskCount: number;
  done: number;
  due: number;
  rate: number;
};

const ANALYSIS_SYSTEM = `You are the reflective "mind" of a goal-tracking app called Goal Tracker, whose ethos is honest follow-through.
You read the goals a person sets for themselves — and, crucially, how reliably they actually follow through on each kind — and you build a candid psychological portrait of them on that basis alone.

Principles:
- Profile the PERSON from the NATURE of their goals plus their completion behaviour by category. Two people with identical completion rates but different goal content should get different portraits.
- Be insightful, specific and honest — not flattering, not a horoscope. Earn trust by noticing real patterns (e.g. "you commit hardest to physical goals but let learning goals slip").
- You are NOT a clinician. Give no medical or psychiatric diagnoses. If goals touch on risky or self-destructive behaviour, treat it soberly and without moralising lectures, but do let it inform the portrait honestly.
- Ground every claim in the actual goals/stats provided. Never invent goals.

Group the goals into a small set (2-6) of meaningful categories by their nature (e.g. Fitness & Body, Career & Craft, Learning, Health & Habits, Relationships, Creative, Mind & Meaning, Admin). Assign every goal to exactly one category by its index.

Return ONLY JSON with this exact shape:
{
  "headline": string,            // a short, vivid one-liner capturing who this person is as a goal-setter
  "summary": string,             // 2-4 sentences of candid portrait grounded in the data
  "traits": [                    // 3-5 traits
    { "label": string, "score": number (0-100), "note": string }
  ],
  "categories": [
    { "name": string, "blurb": string, "goalIndices": number[] }
  ],
  "insights": [ string ]         // 2-4 sharp observations linking goal-nature to follow-through
}`;

function emptyAnalysis() {
  return {
    generatedAt: new Date().toISOString(),
    headline: "Not enough to go on yet",
    summary:
      "Add a few goals — especially medium and long-term ones — and come back. Once there's a track record of what you aim for and what you actually finish, a portrait can take shape.",
    traits: [],
    categories: [],
    insights: [],
  };
}

router.post("/psychology/analysis", async (req, res): Promise<void> => {
  const parsed = AnalyzePsychologyBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid analysis body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const goals = parsed.data.goals as GoalSnapshot[];
  if (goals.length === 0) {
    res.json(AnalyzePsychologyResponse.parse(emptyAnalysis()));
    return;
  }

  const goalLines = goals
    .map((g, i) => {
      const imp = g.importance != null ? `, importance ${g.importance}/10` : "";
      const note = g.notes ? ` — note: ${g.notes}` : "";
      const rate = g.due > 0 ? `${Math.round(g.rate * 100)}%` : "no tracked occurrences yet";
      return `[${i}] "${g.title}" (${g.timeframe}${imp}) — follow-through ${rate} (${g.done}/${g.due})${note}`;
    })
    .join("\n");

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ANALYSIS_SYSTEM },
        {
          role: "user",
          content: `Here are my goals and how reliably I follow through on each:\n\n${goalLines}\n\nProfile me.`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const data = JSON.parse(raw) as {
      headline?: string;
      summary?: string;
      traits?: { label?: string; score?: number; note?: string }[];
      categories?: { name?: string; blurb?: string; goalIndices?: number[] }[];
      insights?: string[];
    };

    // Build categories deterministically: every goal is assigned to exactly one
    // category. We trust the LLM's grouping but enforce the invariant ourselves —
    // first category to claim a goal index keeps it; duplicates and out-of-range
    // indices are ignored; any goal no category claimed lands in a fallback.
    const claimed = new Set<number>();
    const categories: Category[] = [];
    for (const c of data.categories ?? []) {
      const idx: number[] = [];
      for (const raw of c.goalIndices ?? []) {
        const i = Math.trunc(raw);
        if (Number.isInteger(i) && i >= 0 && i < goals.length && !claimed.has(i)) {
          claimed.add(i);
          idx.push(i);
        }
      }
      if (idx.length === 0) continue;
      const done = idx.reduce((s, i) => s + (goals[i]?.done ?? 0), 0);
      const due = idx.reduce((s, i) => s + (goals[i]?.due ?? 0), 0);
      categories.push({
        name: c.name ?? "Other",
        blurb: c.blurb ?? "",
        taskCount: idx.length,
        done,
        due,
        rate: due > 0 ? done / due : 0,
      });
    }

    const leftover = goals.map((_, i) => i).filter((i) => !claimed.has(i));
    if (leftover.length > 0) {
      const done = leftover.reduce((s, i) => s + (goals[i]?.done ?? 0), 0);
      const due = leftover.reduce((s, i) => s + (goals[i]?.due ?? 0), 0);
      categories.push({
        name: categories.length === 0 ? "Your goals" : "Other",
        blurb:
          categories.length === 0
            ? "Your goals, taken together."
            : "Goals that didn't fit cleanly into the groups above.",
        taskCount: leftover.length,
        done,
        due,
        rate: due > 0 ? done / due : 0,
      });
    }

    const traits = (data.traits ?? [])
      .filter((t) => t.label)
      .map((t) => ({
        label: t.label as string,
        score: Math.max(0, Math.min(100, Math.round(t.score ?? 0))),
        note: t.note ?? "",
      }));

    const result = {
      generatedAt: new Date().toISOString(),
      headline: data.headline ?? "Your goal portrait",
      summary: data.summary ?? "",
      traits,
      categories,
      insights: (data.insights ?? []).filter((s): s is string => typeof s === "string"),
    };

    res.json(AnalyzePsychologyResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Psychology analysis failed");
    res.status(500).json({ error: "Could not build your profile right now." });
  }
});

const CHAT_SYSTEM = `You are the reflective "mind" of the Goal Tracker app, talking directly with the user about their goals and their follow-through.
You have access to their goals, their completion rate per goal-category, and a short profile summary. Use them.

Voice: candid, perceptive, warm but unsparing — a sharp friend who tells the truth, not a flatterer or a therapist. Keep replies tight (a few sentences, occasionally a short list). No clinical diagnoses.

You can and should:
- Point out patterns linking the KIND of goal to how reliably they finish it.
- Answer "what does this say about me?" honestly, grounded in the data.
- Handle hypotheticals: if they propose a new goal (e.g. "what if I set jogging six miles today?"), reason from their track record in that category about how likely they are to follow through and what would help.
Never invent goals or stats you weren't given. If there isn't enough data, say so plainly.`;

router.post("/psychology/chat", async (req, res): Promise<void> => {
  const parsed = ChatPsychologyBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid chat body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { messages, goals, categories, profileSummary } = parsed.data as {
    messages: { role: string; content: string }[];
    goals: GoalSnapshot[];
    categories?: Category[];
    profileSummary?: string | null;
  };

  const goalLines = goals.length
    ? goals
        .map((g) => {
          const rate = g.due > 0 ? `${Math.round(g.rate * 100)}%` : "untracked";
          return `- "${g.title}" (${g.timeframe}) — follow-through ${rate} (${g.done}/${g.due})`;
        })
        .join("\n")
    : "(no goals yet)";

  const catLines = (categories ?? []).length
    ? (categories ?? [])
        .map(
          (c) =>
            `- ${c.name}: ${c.due > 0 ? Math.round(c.rate * 100) + "%" : "untracked"} follow-through across ${c.taskCount} goal(s)`,
        )
        .join("\n")
    : "(no category breakdown yet)";

  const context = `THE USER'S GOALS:\n${goalLines}\n\nFOLLOW-THROUGH BY CATEGORY:\n${catLines}\n\nPROFILE SUMMARY:\n${profileSummary || "(none yet)"}`;

  const convo = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: CHAT_SYSTEM },
        { role: "system", content: context },
        ...convo,
      ],
    });

    const reply =
      completion.choices[0]?.message?.content?.trim() ||
      "I'm not sure what to say to that — try asking again.";

    res.json(ChatPsychologyResponse.parse({ reply }));
  } catch (err) {
    req.log.error({ err }, "Psychology chat failed");
    res.status(500).json({ error: "Could not reach the assistant right now." });
  }
});

export default router;
