export type Timeframe = "daily" | "medium" | "long";
export type ScheduleType = "on" | "by";
export type Recurrence = "none" | "daily" | "weekly" | "monthly";

export interface Task {
  id: string;
  title: string;
  notes?: string;
  timeframe: Timeframe;
  scheduleType: ScheduleType;
  date: string;
  /** Optional deadline for tasks scheduled on a specific day. If unset, the task is due on its scheduled day. */
  dueBy?: string;
  importance?: number;
  recurrence: Recurrence;
  recurrenceEndDate?: string;
  createdAt: string;
  archived?: boolean;
}

export type CompletionStatus = "done" | "partial";

export interface Completion {
  taskId: string;
  date: string;
  completedAt: string;
  /** "done" = fully accomplished, "partial" = partially accomplished. Missing (legacy) is treated as "done". */
  status?: CompletionStatus;
  /** Optional note: a remark on a done task, or what's left to do on a partial one. */
  comment?: string;
}

export type JournalPeriod = "day" | "week" | "month" | "year";

export interface JournalEntry {
  period: JournalPeriod;
  /** Stable key identifying the period, e.g. "2026-06-09" (day), "W:2026-06-07" (week), "2026-06" (month), "2026" (year). */
  periodKey: string;
  text: string;
  updatedAt: string;
}

export interface StoreState {
  tasks: Task[];
  completions: Completion[];
  journal: JournalEntry[];
  seeded: boolean;
}
