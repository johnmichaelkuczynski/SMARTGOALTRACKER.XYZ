---
name: Task visibility & overdue carry-forward
description: How the Goal Tracker day view decides what shows, and the rule for carrying unfinished tasks forward
---

# Day-view task visibility

A non-recurring task (`recurrence === "none"`, either `scheduleType` "on" or "by") is, by `taskOccursOn`, only "on" its exact `task.date`. `task.date` controls *visibility*; `dueBy` is just metadata on the card. So anything dated for another day — past or future — is absent from today's columns. This made users think added tasks were lost.

## Overdue carry-forward (DayView)
Incomplete, non-recurring, past-dated tasks are surfaced in an "Overdue · carried over" section, but ONLY when viewing today (`dateStr === todayStr`). Recurring tasks are excluded (they recur per-occurrence).

**Critical rule:** render each overdue row with `date={task.date}` (its OWN original date), never today's date.
**Why:** completions are keyed `(taskId, date)` via `setCompletion`. Keying to the original date keeps calendar history / analytics accurate AND makes the overdue filter (`no completion at task.date`) clear the item once checked off. Keying to today would double-count and leave the item stuck in overdue.

**How to apply:** any future "carry forward / show elsewhere" feature for one-off tasks must preserve original-date completion keying. `dayRate` stays based on today's `dayTasks` only — don't fold overdue into the day score.

Partial completions currently count as "resolved" (cleared from overdue), consistent with the rest of the app treating any completion record as handled for that date.

## Management views (All-tasks page) must not write recurring completions
The All-tasks page (`/all`) reuses `TaskRow` with `date={task.date}`. For non-recurring tasks that's fine (same keying as overdue). But a recurring task has many occurrences — completing it from a dateless list would write a completion to its anchor date and pollute history/analytics. Rule: on any dateless/management list, pass `hideCompletion` for recurring tasks (`recurrence !== "none"`) so the completion control is replaced by a static indicator; edit/delete still work. Completion of recurring tasks happens only from a day-scoped view.
