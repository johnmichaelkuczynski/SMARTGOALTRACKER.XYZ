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

export interface Completion {
  taskId: string;
  date: string;
  completedAt: string;
}

export interface StoreState {
  tasks: Task[];
  completions: Completion[];
  seeded: boolean;
}
