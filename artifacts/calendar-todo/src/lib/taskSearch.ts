import type { Task } from "./types";

export function taskSearchText(task: Task): string {
  return [
    task.title,
    task.notes ?? "",
    ...(task.subtasks ?? []).map((subtask) => subtask.text),
  ]
    .join(" ")
    .toLowerCase();
}

export function taskMatchesQuery(task: Task, query: string): boolean {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) return true;
  const searchable = taskSearchText(task);
  return terms.every((term) => searchable.includes(term));
}

export function taskSearchExcerpt(task: Task, query: string): string | null {
  const details = [
    task.notes ?? "",
    ...(task.subtasks ?? []).map((subtask) => subtask.text),
  ].filter(Boolean);
  if (details.length === 0) return null;

  const term = query.trim().toLowerCase().split(/\s+/).find(Boolean);
  const source =
    (term && details.find((detail) => detail.toLowerCase().includes(term))) ||
    details[0];
  const matchIndex = term ? source.toLowerCase().indexOf(term) : 0;
  const start = Math.max(0, matchIndex - 55);
  const end = Math.min(source.length, start + 170);
  const excerpt = source.slice(start, end).trim();

  return `${start > 0 ? "…" : ""}${excerpt}${end < source.length ? "…" : ""}`;
}