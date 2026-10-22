---
name: Task visibility & overdue carry-forward
description: How the Goal Tracker day view decides what shows, and the rule for carrying unfinished tasks forward
---

# Day-view task visibility

A non-recurring task (`recurrence === "none"`, either `scheduleType` "on" or "by") is, by `taskOccursOn`, only "on" its exact `task.date`. `task.date` controls *visibility*; `dueBy` is just metadata on the card. So anything dated for another day — past or future — is absent from today's columns. This made users think added tasks were lost.

## Overdue carry-forward (DayView)
On any selected day, incomplete, unarchived task occurrences dated earlier than the selected day appear at the bottom of that day's To do list, after its fresh tasks. This includes individual recurring occurrences. Do not duplicate these tasks in a separate overdue rail.

**Critical rule:** render each carried occurrence with `date={occurrenceDate}`, never the selected date.
**Why:** completions are keyed `(taskId, date)` via `setCompletion`. Keying to the occurrence date keeps calendar history / analytics accurate, clears only that missed occurrence, and leaves today's recurring occurrence independent.

**How to apply:** keep all occurrences scheduled for the selected day above carryovers; sort fresh tasks newest first and carryovers by most recent occurrence first. `dayRate` stays based on occurrences scheduled for that day only — don't fold carryovers into the day score.

Partial completions count as resolved and clear that occurrence from carry-forward, consistent with the rest of the app treating any completion record as handled for that date.

## Management views (All-tasks page) must not write recurring completions
The All-tasks page (`/all`) reuses `TaskRow` with `date={task.date}`. For non-recurring tasks that's fine (same keying as overdue). But a recurring task has many occurrences — completing it from a dateless list would write a completion to its anchor date and pollute history/analytics. Rule: on any dateless/management list, pass `hideCompletion` for recurring tasks (`recurrence !== "none"`) so the completion control is replaced by a static indicator; edit/delete still work. Completion of recurring tasks happens only from a day-scoped view.
