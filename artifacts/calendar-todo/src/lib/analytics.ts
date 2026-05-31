import { isAfter, parseISO, startOfDay, subDays } from "date-fns";
import type { Completion, Task, Timeframe } from "./types";
import { fmt, occurrencesBetween, parse } from "./recurrence";

export interface Stats {
  due: number;
  done: number;
  rate: number;
}

const HORIZON_DAYS = 365;

/** Credit for a completion: full = 1, partial = 0.5, none = 0. Legacy completions (no status) count as done. */
function creditFor(completions: Completion[], taskId: string, date: string): number {
  const c = completions.find((x) => x.taskId === taskId && x.date === date);
  if (!c) return 0;
  return c.status === "partial" ? 0.5 : 1;
}

/** Best credit from any completion on or before the given time (for "by" deadlines). */
function creditOnOrBefore(completions: Completion[], taskId: string, t: number): number {
  let best = 0;
  for (const c of completions) {
    if (c.taskId !== taskId) continue;
    if (parse(c.date).getTime() <= t) {
      best = Math.max(best, c.status === "partial" ? 0.5 : 1);
    }
  }
  return best;
}

/**
 * For each task, count due-and-past occurrences and completed ones.
 * "Past" = occurrence date <= today.
 * For "by" tasks: counted as due once the by-date has passed; completed if any completion exists on or before that date.
 */
function statsFor(task: Task, completions: Completion[], today: Date): Stats {
  const start = subDays(today, HORIZON_DAYS);
  const occs = occurrencesBetween(task, start, today);
  let due = 0;
  let done = 0;
  for (const date of occs) {
    const d = parse(date);
    if (isAfter(d, today)) continue;
    due += 1;
    if (task.scheduleType === "by") {
      done += creditOnOrBefore(completions, task.id, d.getTime());
    } else {
      done += creditFor(completions, task.id, date);
    }
  }
  return { due, done, rate: due ? done / due : 0 };
}

function combine(arr: Stats[]): Stats {
  const due = arr.reduce((s, x) => s + x.due, 0);
  const done = arr.reduce((s, x) => s + x.done, 0);
  return { due, done, rate: due ? done / due : 0 };
}

export function computeAnalytics(tasks: Task[], completions: Completion[]) {
  const today = startOfDay(new Date());
  const active = tasks.filter((t) => !t.archived);
  const per = active.map((t) => ({ task: t, stats: statsFor(t, completions, today) }));

  const overall = combine(per.map((p) => p.stats));

  const byTimeframe: Record<Timeframe, Stats> = {
    daily: combine(per.filter((p) => p.task.timeframe === "daily").map((p) => p.stats)),
    medium: combine(per.filter((p) => p.task.timeframe === "medium").map((p) => p.stats)),
    long: combine(per.filter((p) => p.task.timeframe === "long").map((p) => p.stats)),
  };

  const byImportance: { importance: number; stats: Stats }[] = [];
  for (let i = 1; i <= 10; i += 1) {
    const subset = per.filter((p) => p.task.importance === i).map((p) => p.stats);
    byImportance.push({ importance: i, stats: combine(subset) });
  }

  return { overall, byTimeframe, byImportance };
}

export function dueByItems(tasks: Task[], completions: Completion[]) {
  const today = startOfDay(new Date());
  return tasks
    .filter((t) => !t.archived)
    .filter((t) => t.scheduleType === "by" || (t.scheduleType === "on" && t.dueBy && t.dueBy !== t.date))
    .map((t) => {
      const dueStr = t.scheduleType === "by" ? t.date : (t.dueBy as string);
      const dueDate = parse(dueStr);
      const done = completions.some(
        (c) =>
          c.taskId === t.id &&
          (c.status ?? "done") === "done" &&
          parse(c.date).getTime() <= dueDate.getTime(),
      );
      const overdue = isAfter(today, dueDate) && !done;
      return { task: t, done, overdue, dueDate };
    })
    .filter(({ done }) => !done)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

export { fmt };
