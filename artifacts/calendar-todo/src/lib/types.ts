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
  /** Optional time of day, "HH:mm" (24h). Set when the task happens at a specific moment, e.g. a meeting. */
  time?: string;
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

/** A self-imposed negative command — something the user has told themselves NOT to do. */
export type RuleBound = "standing" | "deadline" | "condition";
export type RuleStatus = "active" | "ended";
export type RuleOutcome = "held" | "broken";

export interface Rule {
  id: string;
  /** The prohibition itself, e.g. "No drinking" or "No building more apps until existing ones are beta tested". */
  text: string;
  /** standing = indefinite; deadline = until a date; condition = until a stated condition is met. */
  bound: RuleBound;
  /** yyyy-MM-dd deadline, when bound === "deadline". */
  untilDate?: string;
  /** Free-text release condition, when bound === "condition". */
  untilCondition?: string;
  notes?: string;
  createdAt: string;
  status: RuleStatus;
  /** When the rule was ended (ISO). */
  endedAt?: string;
  /** How it ended: held (you kept it) or broken (you didn't). */
  outcome?: RuleOutcome;
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
  /** Self-imposed negative commands (things not to do). */
  rules?: Rule[];
  seeded: boolean;
  /** The user's own free-text context for the Mind analysis — their side of the story, things the stats and journal don't capture. */
  mindContext?: string;
}
