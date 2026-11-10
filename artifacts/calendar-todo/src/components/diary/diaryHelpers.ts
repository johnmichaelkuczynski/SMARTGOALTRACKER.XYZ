import { format, isValid, parseISO } from "date-fns";
import type { DiaryEntry } from "@/lib/types";

export const todayKey = () => format(new Date(), "yyyy-MM-dd");

export function isValidDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value));
}

export function diaryDateLabel(value: string): string {
  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, "EEEE, MMMM d, yyyy") : value;
}

export function shortDateLabel(value: string): string {
  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, "MMM d, yyyy") : value;
}

export function entryKeyOf(entry: DiaryEntry): string {
  return entry.id ?? `legacy:${entry.date}`;
}

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function entryWriting(entry: DiaryEntry): string {
  const draft = entry.draft ?? "";
  return (entry.text.trim() === draft.trim()
    ? entry.text
    : [entry.text, draft].filter(Boolean).join("\n\n")).trim();
}

export function errorMessage(caught: unknown, fallback: string): string {
  if (caught instanceof Error && caught.message) return caught.message;
  return fallback;
}
