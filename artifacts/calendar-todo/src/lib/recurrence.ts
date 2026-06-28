import {
  addDays,
  addMonths,
  addWeeks,
  format,
  isAfter,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
} from "date-fns";
import type { Task } from "./types";

export function fmt(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function parse(s: string): Date {
  return startOfDay(parseISO(s));
}

/**
 * Does task occur on the given date in its "on" schedule?
 * For "by" tasks, this returns true only on the by-date itself.
 */
export function taskOccursOn(task: Task, dateStr: string): boolean {
  const date = parse(dateStr);
  const taskDate = parse(task.date);
  const recEnd = task.recurrenceEndDate ? parse(task.recurrenceEndDate) : null;

  if (task.scheduleType === "by") {
    return isSameDay(date, taskDate);
  }

  if (task.recurrence === "none") {
    return isSameDay(date, taskDate);
  }

  if (isBefore(date, taskDate)) return false;
  if (recEnd && isAfter(date, recEnd)) return false;

  if (task.recurrence === "daily") return true;

  if (task.recurrence === "weekly") {
    const diff = Math.round((date.getTime() - taskDate.getTime()) / (1000 * 60 * 60 * 24));
    return diff % 7 === 0;
  }

  if (task.recurrence === "monthly") {
    return date.getDate() === taskDate.getDate();
  }

  return false;
}

/**
 * Get all task instances scheduled "on" the given date (excluding by-tasks unless their by-date is today).
 */
export function tasksForDate(tasks: Task[], dateStr: string): Task[] {
  return tasks.filter((t) => !t.archived && taskOccursOn(t, dateStr));
}

/**
 * Generate all expected occurrence dates for a task between start and end (inclusive).
 * Returns yyyy-MM-dd strings.
 */
export function occurrencesBetween(task: Task, start: Date, end: Date): string[] {
  const out: string[] = [];
  const taskDate = parse(task.date);
  const recEnd = task.recurrenceEndDate ? parse(task.recurrenceEndDate) : null;

  if (task.scheduleType === "by") {
    if (!isBefore(taskDate, start) && !isAfter(taskDate, end)) {
      out.push(fmt(taskDate));
    }
    return out;
  }

  if (task.recurrence === "none") {
    if (!isBefore(taskDate, start) && !isAfter(taskDate, end)) {
      out.push(fmt(taskDate));
    }
    return out;
  }

  const limit = recEnd && isBefore(recEnd, end) ? recEnd : end;

  if (task.recurrence === "monthly") {
    // Step from the anchor by N months so end-of-month dates don't drift.
    // Only emit if the resulting date's day-of-month matches the anchor
    // (skips months without that day, e.g. Feb 30 — consistent with taskOccursOn).
    const anchorDay = taskDate.getDate();
    let n = 0;
    while (true) {
      const candidate = addMonths(taskDate, n);
      if (isAfter(candidate, limit)) break;
      if (
        candidate.getDate() === anchorDay &&
        !isBefore(candidate, start) &&
        !isAfter(candidate, limit)
      ) {
        out.push(fmt(candidate));
      }
      n += 1;
      if (n > 600) break;
    }
    return out;
  }

  let cursor = isBefore(taskDate, start) ? start : taskDate;
  if (task.recurrence === "weekly") {
    while (
      (cursor.getTime() - taskDate.getTime()) % (7 * 24 * 60 * 60 * 1000) !== 0 &&
      !isAfter(cursor, end)
    ) {
      cursor = addDays(cursor, 1);
    }
  }

  while (!isAfter(cursor, limit)) {
    out.push(fmt(cursor));
    if (task.recurrence === "daily") cursor = addDays(cursor, 1);
    else if (task.recurrence === "weekly") cursor = addWeeks(cursor, 1);
    else break;
  }

  return out;
}
