import assert from "node:assert/strict";
import { test } from "node:test";
import type { Completion, Task } from "./types";
import { carriedTaskOccurrencesForDate } from "./recurrence";

const task = (overrides: Partial<Task> & Pick<Task, "id" | "date">): Task => ({
  title: overrides.id,
  timeframe: "daily",
  scheduleType: "on",
  recurrence: "none",
  createdAt: `${overrides.date}T09:00:00.000Z`,
  ...overrides,
});

test("carries unfinished task occurrences from earlier dates, preserving their own dates", () => {
  const carry = task({ id: "carry", date: "2026-10-20" });
  const sameDay = task({ id: "today", date: "2026-10-21" });
  const recurring = task({
    id: "recurring",
    date: "2026-10-19",
    recurrence: "daily",
  });
  const archived = task({
    id: "archived",
    date: "2026-10-18",
    archived: true,
  });
  const completed: Completion = {
    taskId: "done",
    date: "2026-10-17",
    completedAt: "2026-10-17T12:00:00.000Z",
  };
  const done = task({ id: "done", date: "2026-10-17" });
  const tasks = [carry, sameDay, recurring, archived, done];

  const carried = carriedTaskOccurrencesForDate(tasks, [completed], "2026-10-21");

  assert.deepEqual(
    carried.map(({ task: carriedTask, date }) => [carriedTask.id, date]),
    [
      ["carry", "2026-10-20"],
      ["recurring", "2026-10-19"],
      ["recurring", "2026-10-20"],
    ],
  );
  assert.equal(carried[0].task, carry);
});

test("does not carry completed recurring occurrences, but carries the next missed date independently", () => {
  const dailyTask = task({
    id: "daily",
    date: "2026-10-19",
    recurrence: "daily",
  });
  const yesterday: Completion = {
    taskId: "daily",
    date: "2026-10-20",
    completedAt: "2026-10-20T12:00:00.000Z",
  };

  assert.deepEqual(
    carriedTaskOccurrencesForDate([dailyTask], [yesterday], "2026-10-21").map(({ date }) => date),
    ["2026-10-19"],
  );
});

test("a partial completion clears a task from the carry-forward list", () => {
  const partial: Completion = {
    taskId: "partial",
    date: "2026-10-20",
    completedAt: "2026-10-20T12:00:00.000Z",
    status: "partial",
  };

  assert.deepEqual(
    carriedTaskOccurrencesForDate(
      [task({ id: "partial", date: "2026-10-20" })],
      [partial],
      "2026-10-21",
    ),
    [],
  );
});
