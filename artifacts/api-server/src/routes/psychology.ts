import { Router, type IRouter } from "express";
import { count, desc, eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { accomplishmentsTable, db, userStateTable } from "@workspace/db";
import {
  AnalyzePsychologyBody,
  AnalyzePsychologyResponse,
  ChatPsychologyBody,
  ChatPsychologyResponse,
  PlanPsychologyBody,
  PlanPsychologyResponse,
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

type Reflection = {
  period: string;
  label: string;
  text: string;
};

type StoredTask = {
  id?: string;
  title?: string;
  notes?: string;
  timeframe?: string;
  importance?: number;
  date?: string;
  scheduleType?: string;
  recurrence?: string;
  recurrenceEndDate?: string;
  archived?: boolean;
  subtasks?: { text?: string; doneAt?: string }[];
};

type StoredCompletion = {
  taskId?: string;
  date?: string;
  status?: string;
  comment?: string;
};

type StoredState = {
  tasks?: StoredTask[];
  completions?: StoredCompletion[];
  journal?: { period?: string; periodKey?: string; text?: string; updatedAt?: string }[];
  diary?: { date?: string; text?: string; updatedAt?: string }[];
  rules?: { text?: string; notes?: string; status?: string; outcome?: string }[];
  mindContext?: string;
};

const ANALYSIS_HORIZON_DAYS = 365;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return startOfDay(next);
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, date.getDate());
}

function formatStoredDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseStoredDate(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
}

function storedOccurrences(task: StoredTask, start: Date, end: Date): string[] {
  const taskDate = parseStoredDate(task.date);
  if (!taskDate) return [];
  const recurrenceEnd = parseStoredDate(task.recurrenceEndDate);
  const scheduleType = task.scheduleType ?? "on";
  const recurrence = task.recurrence ?? "none";

  if (scheduleType === "by" || recurrence === "none") {
    return taskDate >= start && taskDate <= end
      ? [formatStoredDate(taskDate)]
      : [];
  }

  const limit = recurrenceEnd && recurrenceEnd < end ? recurrenceEnd : end;
  const occurrences: string[] = [];

  if (recurrence === "monthly") {
    const anchorDay = taskDate.getDate();
    for (let n = 0; n <= 600; n += 1) {
      const candidate = addMonths(taskDate, n);
      if (candidate > limit) break;
      if (
        candidate.getDate() === anchorDay &&
        candidate >= start &&
        candidate <= limit
      ) {
        occurrences.push(formatStoredDate(candidate));
      }
    }
    return occurrences;
  }

  let cursor = taskDate < start ? start : taskDate;
  if (recurrence === "weekly") {
    while (
      (cursor.getTime() - taskDate.getTime()) % (7 * 24 * 60 * 60 * 1000) !== 0 &&
      cursor <= end
    ) {
      cursor = addDays(cursor, 1);
    }
  }

  while (cursor <= limit) {
    occurrences.push(formatStoredDate(cursor));
    if (recurrence === "daily") cursor = addDays(cursor, 1);
    else if (recurrence === "weekly") cursor = addDays(cursor, 7);
    else break;
  }
  return occurrences;
}

function completionCredit(completion: StoredCompletion | undefined): number {
  if (!completion) return 0;
  return completion.status === "partial" ? 0.5 : 1;
}

function storedStats(task: StoredTask, completions: StoredCompletion[]) {
  const today = startOfDay(new Date());
  const start = addDays(today, -ANALYSIS_HORIZON_DAYS);
  const occurrences = storedOccurrences(task, start, today);
  let done = 0;

  for (const occurrence of occurrences) {
    if (task.scheduleType === "by") {
      const deadline = parseStoredDate(occurrence)?.getTime() ?? 0;
      let best = 0;
      for (const completion of completions) {
        const completionDate = parseStoredDate(completion.date)?.getTime();
        if (completion.taskId === task.id && completionDate != null && completionDate <= deadline) {
          best = Math.max(best, completionCredit(completion));
        }
      }
      done += best;
    } else {
      done += completionCredit(
        completions.find(
          (completion) => completion.taskId === task.id && completion.date === occurrence,
        ),
      );
    }
  }

  return {
    done,
    due: occurrences.length,
    rate: occurrences.length > 0 ? done / occurrences.length : 0,
  };
}

/** Render the user's own accounts of what they accomplished, most recent first, capped to keep prompts bounded. */
function reflectionLines(reflections: Reflection[] | undefined): string {
  if (!reflections || reflections.length === 0) return "";
  const capped = reflections.slice(0, 40);
  const body = capped
    .map((r) => `(${r.period}) ${r.label}:\n${r.text}`)
    .join("\n\n");
  return body;
}

const ANALYSIS_SYSTEM = `You are the reflective "mind" of a goal-tracking app called Goal Tracker, whose ethos is honest follow-through.
You read the goals a person sets for themselves — and, crucially, how reliably they actually follow through on each kind — and you build a candid psychological portrait of them on that basis alone.

Principles:
- Profile the PERSON from the NATURE of their goals plus their completion behaviour by category. Two people with identical completion rates but different goal content should get different portraits.
- You may also be given the user's OWN reflections — free-text accounts of what they actually accomplished each day/week/month/year. These are first-person truth and often matter MORE than the checkbox stats: what someone chooses to record, celebrate, or confess reveals who they are. What they report doing may diverge from what they set out to do — notice that gap explicitly and let it shape the portrait.
- Be insightful, specific and honest — not flattering, not a horoscope. Earn trust by noticing real patterns (e.g. "you commit hardest to physical goals but let learning goals slip", or "your goals are all career, but your reflections are all about people").
- You may also be given the user's OWN CONTEXT — their side of the story, pushing back on or adding to what the raw data shows (e.g. "I do a lot of work I never log", "I was ill that month", "the beta testing is actually done, I just didn't record it"). Take it seriously and let it genuinely revise the portrait where it's plausible — you are not obliged to agree with it, but engage with it honestly rather than ignoring it or rubber-stamping it. Where their context changes your read, say so.
- You are NOT a clinician. Give no medical or psychiatric diagnoses. If goals or reflections touch on risky or self-destructive behaviour, treat it soberly and without moralising lectures, but do let it inform the portrait honestly.
- Ground every claim in the actual goals, stats, and reflections provided. Never invent goals or accomplishments.

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

type DataSource = {
  databaseUpdatedAt: string | null;
  taskCount: number;
  completionCount: number;
  journalCount: number;
  diaryCount: number;
  accomplishmentCount: number;
  ruleCount: number;
};

function emptyAnalysis(source: DataSource) {
  return {
    generatedAt: new Date().toISOString(),
    headline: "Not enough to go on yet",
    summary:
      "Add a few goals — especially medium and long-term ones — and come back. Once there's a track record of what you aim for and what you actually finish, a portrait can take shape.",
    traits: [],
    categories: [],
    insights: [],
    source,
  };
}

router.post("/psychology/analysis", async (req, res): Promise<void> => {
  const parsed = AnalyzePsychologyBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid analysis body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.userId!;
  const [stateRows, accomplishments, accomplishmentTotals] = await Promise.all([
    db
      .select()
      .from(userStateTable)
      .where(eq(userStateTable.userId, userId))
      .limit(1),
    db
      .select()
      .from(accomplishmentsTable)
      .where(eq(accomplishmentsTable.userId, userId))
      .orderBy(desc(accomplishmentsTable.date))
      .limit(120),
    db
      .select({ value: count() })
      .from(accomplishmentsTable)
      .where(eq(accomplishmentsTable.userId, userId)),
  ]);

  const stateRow = stateRows[0];
  const stored = (stateRow?.data ?? {}) as StoredState;
  const storedTasks = Array.isArray(stored.tasks) ? stored.tasks : [];
  const storedCompletions = Array.isArray(stored.completions) ? stored.completions : [];
  const submittedGoals = parsed.data.goals as GoalSnapshot[];
  const activeStoredTasks = storedTasks.filter((task) => !task.archived);
  const goals: GoalSnapshot[] =
    stateRow
      ? activeStoredTasks.map((task) => {
          const stats = storedStats(task, storedCompletions);
          return {
            title: task.title?.trim() || "Untitled goal",
            notes: task.notes?.trim() || null,
            timeframe: task.timeframe || "daily",
            importance: task.importance ?? null,
            ...stats,
          };
        })
      : submittedGoals;

  const databaseReflections: (Reflection & { updatedAt: string })[] = [
    ...(stored.journal ?? [])
      .filter((entry) => entry.text?.trim())
      .map((entry) => ({
        period: entry.period || "journal",
        label: entry.periodKey || "Journal entry",
        text: entry.text!.trim(),
        updatedAt: entry.updatedAt || entry.periodKey || "",
      })),
    ...(stored.diary ?? [])
      .filter((entry) => entry.text?.trim())
      .map((entry) => ({
        period: "diary",
        label: entry.date || "Diary entry",
        text: entry.text!.trim(),
        updatedAt: entry.updatedAt || entry.date || "",
      })),
    ...accomplishments.map((entry) => ({
      period: "accomplishment",
      label: entry.date,
      text: entry.text,
      updatedAt: entry.updatedAt.toISOString(),
    })),
  ];
  const reflections: Reflection[] = databaseReflections
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 160)
    .map(({ period, label, text }) => ({ period, label, text }));
  const submittedContext =
    ((parsed.data.context as string | null | undefined)?.trim() || "").slice(0, 4000);
  const context = (stored.mindContext?.trim() || submittedContext).slice(0, 4000);
  const source: DataSource = {
    databaseUpdatedAt: stateRow?.updatedAt.toISOString() ?? null,
    taskCount: storedTasks.length,
    completionCount: storedCompletions.length,
    journalCount: (stored.journal ?? []).length,
    diaryCount: (stored.diary ?? []).length,
    accomplishmentCount: Number(accomplishmentTotals[0]?.value ?? 0),
    ruleCount: (stored.rules ?? []).length,
  };
  if (goals.length === 0 && (!reflections || reflections.length === 0) && !context) {
    res.json(AnalyzePsychologyResponse.parse(emptyAnalysis(source)));
    return;
  }

  const goalLines = goals.length
    ? goals
        .map((g, i) => {
          const imp = g.importance != null ? `, importance ${g.importance}/10` : "";
          const note = g.notes ? ` — note: ${g.notes}` : "";
          const rate = g.due > 0 ? `${Math.round(g.rate * 100)}%` : "no tracked occurrences yet";
          return `[${i}] "${g.title}" (${g.timeframe}${imp}) — follow-through ${rate} (${g.done}/${g.due})${note}`;
        })
        .join("\n")
    : "(no explicit goals set)";

  const reflectionBlock = reflectionLines(reflections);
  const databaseHistory = storedTasks
    .slice(-300)
    .map((task) => {
      const completionCount = storedCompletions.filter(
        (completion) => completion.taskId && completion.taskId === task.id,
      ).length;
      const checklist = (task.subtasks ?? [])
        .filter((item) => item.text?.trim())
        .slice(0, 20)
        .map((item) => `${item.doneAt ? "[done]" : "[open]"} ${item.text!.trim()}`)
        .join("; ");
      return `${task.archived ? "[archived]" : "[active]"} ${task.title || "Untitled"}${
        task.date ? ` | date ${task.date}` : ""
      } | ${completionCount} recorded completions${
        task.notes ? ` | notes: ${task.notes.slice(0, 1200)}` : ""
      }${checklist ? ` | checklist: ${checklist}` : ""}`;
    })
    .join("\n");
  const ruleHistory = (stored.rules ?? [])
    .slice(-100)
    .map(
      (rule) =>
        `[${rule.status || "unknown"}${rule.outcome ? `/${rule.outcome}` : ""}] ${
          rule.text || "Untitled rule"
        }${rule.notes ? ` — ${rule.notes.slice(0, 800)}` : ""}`,
    )
    .join("\n");
  const databaseSummary = `Authoritative database snapshot:
- Database record updated: ${stateRow?.updatedAt.toISOString() ?? "not available"}
- Stored tasks/goals: ${storedTasks.length} (${activeStoredTasks.length} active, ${
    storedTasks.length - activeStoredTasks.length
  } archived)
- Stored completion records: ${storedCompletions.length}
- Stored journal entries: ${(stored.journal ?? []).length}
- Stored diary entries: ${(stored.diary ?? []).length}
- Stored accomplishments: ${accomplishments.length}
- Stored personal rules: ${(stored.rules ?? []).length}`;
  const userContent = `${databaseSummary}

Here are my current active goals and database-backed follow-through statistics:

${goalLines}${
    reflectionBlock
      ? `\n\nHere are my newest database-stored journal entries, diary entries, and accomplishments:\n\n${reflectionBlock}`
      : ""
  }${databaseHistory ? `\n\nHere is the broader stored task history, including archived items, notes, checklists, and completion counts:\n\n${databaseHistory}` : ""}${
    ruleHistory ? `\n\nHere are my stored personal rules and their outcomes:\n\n${ruleHistory}` : ""
  }${
    context
      ? `\n\nHere is my database-stored personal context, which should genuinely affect the profile:\n\n${context}`
      : ""
  }\n\nBuild a fresh profile from this current database snapshot. Give substantial weight to recent entries and changes; do not repeat an older profile merely because earlier themes still exist.`;

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ANALYSIS_SYSTEM },
        { role: "user", content: userContent },
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
      source,
    };

    res.json(AnalyzePsychologyResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Psychology analysis failed");
    res.status(500).json({ error: "Could not build your profile right now." });
  }
});

const PLAN_SYSTEM = `You are the reflective "mind" of the Goal Tracker app, whose ethos is honest follow-through.
The user has just been given a candid psychological portrait of themselves built from their goals and follow-through, and is now saying: "OK, fine — suppose everything you're saying is true. What should I do?"

Your job: TAKE THE READ AT FACE VALUE and turn it into a concrete, prioritised plan of action. Do not re-litigate or soften the portrait, do not hedge with "but maybe it's not true" — they have already conceded the premise. Tell them what to actually do about it.

Principles:
- Be specific and actionable. Each move should be something they could start this week, grounded in the patterns in their data (e.g. "you finish concrete physical tasks but stall on commercialization — so timebox 90 minutes every Friday to ship one go-to-market task, treated as concretely as a workout").
- Work WITH their nature, not against it. If they execute well on concrete tasks but avoid vague ones, the plan should convert vague goals into concrete ones — not just tell them to "try harder".
- Address the gaps the profile surfaced: where they follow through least, where intention and action diverge, the traits and insights given.
- Be candid and direct, not a flattering life-coach. A few sharp, high-leverage moves beat a long generic checklist.
- Ground everything in the actual goals, stats, traits, insights and reflections provided. Never invent goals or accomplishments.
- No clinical or medical advice.

Return ONLY JSON with this exact shape:
{
  "premise": string,        // 1-2 sentences restating, in your voice, the read you're taking at face value
  "moves": [                // 3-6 concrete moves, ordered most important first
    { "title": string,      // a short imperative name, e.g. "Make 'business mode' concrete"
      "detail": string }    // 1-3 sentences: exactly what to do and why it follows from the profile
  ],
  "firstStep": string       // the single smallest thing to do first, today
}`;

router.post("/psychology/plan", async (req, res): Promise<void> => {
  const parsed = PlanPsychologyBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid plan body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { goals, categories, traits, insights, headline, profileSummary, reflections, context } =
    parsed.data as {
      goals: GoalSnapshot[];
      categories?: Category[];
      traits?: { label: string; score: number; note: string }[];
      insights?: string[];
      headline?: string | null;
      profileSummary?: string | null;
      reflections?: Reflection[];
      context?: string | null;
    };
  const sideContext = (context?.trim() || "").slice(0, 4000);

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

  const traitLines = (traits ?? []).length
    ? (traits ?? []).map((t) => `- ${t.label} (${t.score}/100): ${t.note}`).join("\n")
    : "(none)";

  const insightLines = (insights ?? []).length
    ? (insights ?? []).map((s) => `- ${s}`).join("\n")
    : "(none)";

  const reflectionBlock = reflectionLines(reflections);
  const userContent = `THE READ ON ME (take this at face value):
HEADLINE: ${headline || "(none)"}
SUMMARY: ${profileSummary || "(none)"}

TRAITS:
${traitLines}

PATTERNS / INSIGHTS:
${insightLines}

MY GOALS:
${goalLines}

FOLLOW-THROUGH BY CATEGORY:
${catLines}${
    reflectionBlock ? `\n\nMY OWN REFLECTIONS (what I actually did):\n${reflectionBlock}` : ""
  }${
    sideContext ? `\n\nMY OWN CONTEXT (things the data doesn't capture):\n${sideContext}` : ""
  }

OK, fine — suppose all of that is true. What should I do?`;

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PLAN_SYSTEM },
        { role: "user", content: userContent },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const data = JSON.parse(raw) as {
      premise?: string;
      moves?: { title?: string; detail?: string }[];
      firstStep?: string;
    };

    const moves = (data.moves ?? [])
      .filter((m) => m.title || m.detail)
      .map((m) => ({ title: m.title ?? "", detail: m.detail ?? "" }));

    // Guard against a successful-but-empty model response so the UI never shows a blank plan.
    if (moves.length === 0) {
      moves.push({
        title: "Pick your weakest category and make one goal concrete",
        detail:
          "Take the area where you follow through least, choose a single goal in it, and rewrite it as one specific action with a date — the kind of concrete task you actually finish.",
      });
    }

    const result = {
      generatedAt: new Date().toISOString(),
      premise: data.premise ?? "",
      moves,
      firstStep: data.firstStep ?? moves[0]?.title ?? "",
    };

    res.json(PlanPsychologyResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Psychology plan failed");
    res.status(500).json({ error: "Could not build your plan right now." });
  }
});

const CHAT_SYSTEM = `You are the reflective "mind" of the Goal Tracker app, talking directly with the user about their goals and their follow-through.
You have access to their goals, their completion rate per goal-category, and a short profile summary. Use them.

Voice: candid, perceptive, warm but unsparing — a sharp friend who tells the truth, not a flatterer or a therapist. Keep replies tight (a few sentences, occasionally a short list). No clinical diagnoses.

You may also have their REFLECTIONS — free-text accounts, in their own words, of what they actually accomplished each day/week/month/year. Treat these as first-person truth that often reveals more than the stats, and note honestly where what they did diverges from what they set out to do.

You may also have their OWN CONTEXT — their side of the story, pushing back on or adding to what the data shows. When they push back in conversation, engage with it genuinely: be willing to update your read where their account is plausible, say so when it changes your mind, and stay honest rather than caving just to please them. You are a thinking partner who can be persuaded by good evidence, not a yes-man and not a stubborn judge.

You can and should:
- Point out patterns linking the KIND of goal to how reliably they finish it.
- Answer "what does this say about me?" honestly, grounded in the data and their reflections.
- Weigh their reflections heavily: reference what they actually reported doing, and surface gaps between intention and action.
- Handle hypotheticals: if they propose a new goal (e.g. "what if I set jogging six miles today?"), reason from their track record in that category about how likely they are to follow through and what would help.
Never invent goals, stats, or accomplishments you weren't given. If there isn't enough data, say so plainly.`;

router.post("/psychology/chat", async (req, res): Promise<void> => {
  const parsed = ChatPsychologyBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid chat body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { messages, goals, categories, profileSummary, reflections, context: userContext } =
    parsed.data as {
      messages: { role: string; content: string }[];
      goals: GoalSnapshot[];
      categories?: Category[];
      profileSummary?: string | null;
      reflections?: Reflection[];
      context?: string | null;
    };
  const sideContext = (userContext?.trim() || "").slice(0, 4000);

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

  const reflectionBlock = reflectionLines(reflections);
  const context = `THE USER'S GOALS:\n${goalLines}\n\nFOLLOW-THROUGH BY CATEGORY:\n${catLines}\n\nPROFILE SUMMARY:\n${profileSummary || "(none yet)"}${
    reflectionBlock ? `\n\nTHE USER'S OWN REFLECTIONS (what they actually did):\n${reflectionBlock}` : ""
  }${
    sideContext
      ? `\n\nTHE USER'S OWN CONTEXT (their side of the story — things the data above doesn't capture; weigh it honestly):\n${sideContext}`
      : ""
  }`;

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
