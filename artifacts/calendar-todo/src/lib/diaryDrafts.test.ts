import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreUnsyncedDiaryEdits } from "./diaryDrafts";
import type { DiaryEntry } from "./types";

const old: DiaryEntry = {
  id: "entry", date: "2026-11-09", text: "Original", updatedAt: "2026-11-09T10:00:00.000Z",
};
test("an immediate reload recovers newer unsynced diary prose, paragraphs and conversation", () => {
  const newer: DiaryEntry = {
    ...old, text: "First.\n\nSecond.", draft: "Third.\n",
    updatedAt: "2026-11-09T10:02:00.000Z",
    conversation: [{ id: "turn", role: "user", content: "First.\n\nSecond.", createdAt: "2026-11-09T10:02:00.000Z" }],
  };
  const result = restoreUnsyncedDiaryEdits([old], [newer], "2026-11-09T10:01:00.000Z");
  assert.deepEqual(result, [newer]);
  assert.deepEqual(restoreUnsyncedDiaryEdits([], [newer], "2026-11-09T10:01:00.000Z"), [newer]);
});
test("an older browser cache never resurrects a server-deleted entry or overwrites newer writing", () => {
  assert.deepEqual(restoreUnsyncedDiaryEdits([], [old], "2026-11-09T10:01:00.000Z"), []);
  const remote = { ...old, text: "New server writing", updatedAt: "2026-11-09T10:03:00.000Z" };
  assert.deepEqual(restoreUnsyncedDiaryEdits([remote], [old], "2026-11-09T10:04:00.000Z"), [remote]);
});
test("legacy dated entries also recover unsynced paragraphs without duplicating the entry", () => {
  const legacy = { ...old, id: undefined };
  const edited = { ...legacy, draft: "Legacy draft.\n\nAnother paragraph.", updatedAt: "2026-11-09T10:02:00.000Z" };
  assert.deepEqual(restoreUnsyncedDiaryEdits([legacy], [edited], "2026-11-09T10:01:00.000Z"), [edited]);
});
