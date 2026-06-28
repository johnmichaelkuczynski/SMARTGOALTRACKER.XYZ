import { addDays, format, startOfDay } from "date-fns";
import type {
  AssistantContext,
  PsychAnalysis,
  PsychCategory,
  ReflectionEntry,
  ScheduleItem,
  StatSummary,
} from "@workspace/api-client-react";
import type { Completion, JournalEntry, Task } from "./types";
import { computeAnalytics, goalSnapshots } from "./analytics";
import { occurrencesBetween, parse } from "./recurrence";
import { keyToDate, periodLabel } from "./periods";

const SCHEDULE_HORIZON_DAYS = 14;
const TIMEFRAME_LABELS: Record<string, string> = {
  daily: "Daily",
  medium: "Medium-term",
  long: "Long-term",
};

function statusFor(completions: Completion[], taskId: string, date: string): string {
  const c = completions.find((x) => x.taskId === taskId && x.date === date);
  if (!c) return "pending";
  return c.status === "partial" ? "partial" : "done";
}

/** Today's and near-future scheduled occurrences across all active tasks, sorted by date. */
function buildSchedule(tasks: Task[], completions: Completion[]): ScheduleItem[] {
  const today = startOfDay(new Date());
  const end = addDays(today, SCHEDULE_HORIZON_DAYS);
  const items: ScheduleItem[] = [];
  for (const t of tasks) {
    if (t.archived) continue;
    for (const date of occurrencesBetween(t, today, end)) {
      items.push({
        title: t.title,
        date,
        timeframe: t.timeframe,
        importance: t.importance ?? null,
        status: statusFor(completions, t.id, date),
      });
    }
  }
  return items.sort((a, b) => parse(a.date).getTime() - parse(b.date).getTime()).slice(0, 80);
}

function buildReflections(journal: JournalEntry[]): ReflectionEntry[] {
  return [...journal]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20)
    .map((e) => ({
      period: e.period,
      label: periodLabel(e.period, keyToDate(e.period, e.periodKey)),
      text: e.text,
    }));
}

/** Assemble the full context payload the assistant reasons over from current app state. */
export function buildAssistantContext(
  tasks: Task[],
  completions: Completion[],
  journal: JournalEntry[],
  analysis: PsychAnalysis | null,
): AssistantContext {
  const { overall, byTimeframe } = computeAnalytics(tasks, completions);

  const overallSummary: StatSummary = {
    label: "Overall",
    done: overall.done,
    due: overall.due,
    rate: overall.rate,
  };

  const timeframeSummaries: StatSummary[] = (["daily", "medium", "long"] as const).map((tf) => ({
    label: TIMEFRAME_LABELS[tf],
    done: byTimeframe[tf].done,
    due: byTimeframe[tf].due,
    rate: byTimeframe[tf].rate,
  }));

  const categories: PsychCategory[] | undefined = analysis?.categories?.length
    ? analysis.categories
    : undefined;

  return {
    today: format(new Date(), "EEEE, MMMM d, yyyy"),
    overall: overallSummary,
    byTimeframe: timeframeSummaries,
    goals: goalSnapshots(tasks, completions),
    categories,
    schedule: buildSchedule(tasks, completions),
    reflections: buildReflections(journal),
    profileSummary: analysis?.summary ?? null,
  };
}
