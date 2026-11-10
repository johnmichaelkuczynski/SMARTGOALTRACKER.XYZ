import assert from "node:assert/strict";
import { test } from "node:test";
import { conciseDiaryParagraph, diaryWritingStats, selectDiaryWriting, validDiaryDate } from "./diaryAnalytics";

test("diary analytics counts only authored writing and drafts, never AI replies or questions", () => {
  const records = [
    { id: "one", date: "2026-11-09", text: "Four words written here.", draft: "Two more.", conversation: [{ role: "assistant", content: "Never count this" }] },
    { id: "two", date: "2026-11-09", text: "Another entry." },
    { id: "three", date: "2026-11-10", text: "", draft: "Draft only." },
    { id: "question", date: "2026-11-10", text: "", conversation: [{ role: "user", content: "Question?" }] },
    { date: "2026-11-11", text: "Outside range" },
  ];
  assert.deepEqual(diaryWritingStats(selectDiaryWriting(records, "2026-11-09", "2026-11-10")), {
    entryCount: 3, writingDays: 2, wordCount: 10, from: "2026-11-09", to: "2026-11-10",
  });
});
test("chat output is one paragraph and never more than 120 words", () => {
  const reply = conciseDiaryParagraph(Array.from({ length: 130 }, () => "word").join("\n\n"));
  assert.equal(reply.includes("\n"), false);
  assert.equal(reply.split(/\s+/).length, 120);
});
test("diary date validation rejects impossible dates", () => {
  assert.equal(validDiaryDate("2026-02-30"), false);
  assert.equal(validDiaryDate("2026-11-09"), true);
});
