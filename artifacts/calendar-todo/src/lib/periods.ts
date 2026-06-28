import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  endOfWeek,
  format,
  startOfWeek,
} from "date-fns";
import type { JournalPeriod } from "./types";

export const PERIODS: { value: JournalPeriod; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

/** Stable key for the period containing `date`. */
export function periodKey(period: JournalPeriod, date: Date): string {
  switch (period) {
    case "day":
      return format(date, "yyyy-MM-dd");
    case "week":
      return "W:" + format(startOfWeek(date), "yyyy-MM-dd");
    case "month":
      return format(date, "yyyy-MM");
    case "year":
      return format(date, "yyyy");
  }
}

/** Inverse of periodKey: a representative Date for a stored period key. */
export function keyToDate(period: JournalPeriod, key: string): Date {
  const raw = key.startsWith("W:") ? key.slice(2) : key;
  if (period === "year") return new Date(Number(raw), 0, 1);
  if (period === "month") {
    const [y, m] = raw.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }
  const [y, m, d] = raw.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Human-readable label for the period containing `date`. */
export function periodLabel(period: JournalPeriod, date: Date): string {
  switch (period) {
    case "day":
      return format(date, "EEEE, MMMM d, yyyy");
    case "week": {
      const start = startOfWeek(date);
      const end = endOfWeek(date);
      return `Week of ${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
    }
    case "month":
      return format(date, "MMMM yyyy");
    case "year":
      return format(date, "yyyy");
  }
}

/** Move the anchor date by `delta` periods (e.g. -1 = previous, +1 = next). */
export function shiftPeriod(period: JournalPeriod, date: Date, delta: number): Date {
  switch (period) {
    case "day":
      return addDays(date, delta);
    case "week":
      return addWeeks(date, delta);
    case "month":
      return addMonths(date, delta);
    case "year":
      return addYears(date, delta);
  }
}

/** The noun used in prompts, e.g. "today", "this week". */
export function periodNoun(period: JournalPeriod): string {
  switch (period) {
    case "day":
      return "day";
    case "week":
      return "week";
    case "month":
      return "month";
    case "year":
      return "year";
  }
}

/** Short prompt shown above the textarea. */
export function periodPrompt(period: JournalPeriod): string {
  switch (period) {
    case "day":
      return "What did you actually accomplish today?";
    case "week":
      return "What did you actually accomplish this week?";
    case "month":
      return "What did you actually accomplish this month?";
    case "year":
      return "What did you actually accomplish this year?";
  }
}
