import { addDays, format } from "date-fns";
import type { StoreState } from "./types";

export function seedData(): StoreState {
  const today = new Date();
  const f = (d: Date) => format(d, "yyyy-MM-dd");
  const now = new Date().toISOString();

  const tasks = [
    {
      id: "seed-1",
      title: "Morning walk",
      timeframe: "daily" as const,
      scheduleType: "on" as const,
      date: f(today),
      recurrence: "daily" as const,
      importance: 6,
      createdAt: now,
    },
    {
      id: "seed-2",
      title: "Read for thirty minutes",
      timeframe: "daily" as const,
      scheduleType: "on" as const,
      date: f(today),
      recurrence: "daily" as const,
      importance: 7,
      createdAt: now,
    },
    {
      id: "seed-3",
      title: "Submit conference abstract",
      timeframe: "medium" as const,
      scheduleType: "by" as const,
      date: f(addDays(today, 14)),
      recurrence: "none" as const,
      importance: 9,
      notes: "Polish methods section before sending.",
      createdAt: now,
    },
    {
      id: "seed-4",
      title: "Publish first peer-reviewed article",
      timeframe: "medium" as const,
      scheduleType: "by" as const,
      date: f(addDays(today, 120)),
      recurrence: "none" as const,
      importance: 10,
      createdAt: now,
    },
    {
      id: "seed-5",
      title: "Finish PhD",
      timeframe: "long" as const,
      scheduleType: "by" as const,
      date: f(addDays(today, 365 * 3)),
      recurrence: "none" as const,
      importance: 10,
      createdAt: now,
    },
    {
      id: "seed-6",
      title: "Weekly review",
      timeframe: "daily" as const,
      scheduleType: "on" as const,
      date: f(addDays(today, -7)),
      recurrence: "weekly" as const,
      importance: 5,
      createdAt: now,
    },
  ];

  const completions = [
    { taskId: "seed-1", date: f(addDays(today, -1)), completedAt: now },
    { taskId: "seed-1", date: f(addDays(today, -2)), completedAt: now },
    { taskId: "seed-2", date: f(addDays(today, -1)), completedAt: now },
    { taskId: "seed-6", date: f(addDays(today, -7)), completedAt: now },
  ];

  return { tasks, completions, seeded: true };
}
