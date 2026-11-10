import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  configurable: true,
});

const storage = await import("./storage.ts");
const date = "2026-09-12";

beforeEach(() => {
  storage.clearAll();
});

test("same-day entries retain only their own Living Diary messages through serialization and deletion", () => {
  const first = storage.createDiaryEntry(date);
  storage.setDiaryEntry(date, "First entry", first.id);
  storage.addDiaryMessage(date, { role: "user", content: "First question" }, first.id);
  storage.addDiaryMessage(date, { role: "assistant", content: "First answer" }, first.id);

  const second = storage.createDiaryEntry(date);
  storage.setDiaryEntry(date, "Second entry", second.id);
  storage.addDiaryMessage(date, { role: "user", content: "Second question" }, second.id);
  storage.addDiaryMessage(date, { role: "assistant", content: "Second answer" }, second.id);

  const reloaded = JSON.parse(JSON.stringify(storage.getState())) as ReturnType<typeof storage.getState>;
  const reloadedFirst = reloaded.diary?.find((entry) => entry.id === first.id);
  const reloadedSecond = reloaded.diary?.find((entry) => entry.id === second.id);

  assert.deepEqual(
    reloadedFirst?.conversation?.map(({ role, content }) => ({ role, content })),
    [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
    ],
  );
  assert.deepEqual(
    reloadedSecond?.conversation?.map(({ role, content }) => ({ role, content })),
    [
      { role: "user", content: "Second question" },
      { role: "assistant", content: "Second answer" },
    ],
  );

  storage.deleteDiaryEntry(date, first.id);
  assert.equal(storage.getDiaryEntry(date, first.id), undefined);
  assert.deepEqual(
    storage.getDiaryEntry(date, second.id)?.conversation?.map(({ role, content }) => ({ role, content })),
    [
      { role: "user", content: "Second question" },
      { role: "assistant", content: "Second answer" },
    ],
  );
});

test("normal diary editing updates only the selected same-day entry", () => {
  const first = storage.createDiaryEntry(date);
  const second = storage.createDiaryEntry(date);

  storage.setDiaryEntry(date, "Edited first entry", first.id);
  storage.setDiaryEntry(date, "Unchanged second entry", second.id);
  storage.setDiaryEntry(date, "Edited first entry again", first.id);

  assert.equal(storage.getDiaryEntry(date, first.id)?.text, "Edited first entry again");
  assert.equal(storage.getDiaryEntry(date, second.id)?.text, "Unchanged second entry");
  assert.equal(storage.getDiaryEntries(date).length, 2);
});

test("interactive drafts preserve paragraphs and remain isolated across same-day entries", () => {
  const first = storage.createDiaryEntry(date);
  const second = storage.createDiaryEntry(date);
  const draft = "First paragraph.\n\nSecond paragraph with substance.\n";
  storage.setDiaryDraft(date, draft, first.id!);
  storage.setDiaryDraft(date, "Different draft", second.id!);
  const reloaded = JSON.parse(JSON.stringify(storage.getState()));
  assert.equal(reloaded.diary.find((entry: { id: string }) => entry.id === first.id).draft, draft);
  assert.equal(storage.getDiaryEntry(date, second.id)?.draft, "Different draft");
});

test("questions do not clear the writing draft or become diary prose", () => {
  const entry = storage.createDiaryEntry(date);
  storage.setDiaryEntry(date, "Existing prose.\n\nAnother paragraph.\n", entry.id);
  storage.setDiaryDraft(date, "Unsent thoughts.\n\nStill writing.", entry.id!);
  storage.submitDiaryMessage(date, entry.id!, "What does my writing reveal?", "question");
  const saved = storage.getDiaryEntry(date, entry.id)!;
  assert.equal(saved.text, "Existing prose.\n\nAnother paragraph.\n");
  assert.equal(saved.draft, "Unsent thoughts.\n\nStill writing.");
  assert.equal(saved.conversation?.[0].kind, "question");
});

test("an explicit diary submission saves prose and conversation together before the AI responds", () => {
  const entry = storage.createDiaryEntry(date);
  const content = "A thoughtful first paragraph.\n\nA second paragraph.";
  storage.setDiaryDraft(date, content, entry.id!);
  storage.submitDiaryMessage(date, entry.id!, content);
  const saved = storage.getDiaryEntry(date, entry.id)!;
  assert.equal(saved.text, content);
  assert.equal(saved.draft, "");
  assert.equal(saved.conversation?.[0].content, content);
  storage.setDiaryDraft(date, "Next thoughts", entry.id!);
  storage.addDiaryMessage(date, { role: "assistant", content: "A concise response." }, entry.id);
  assert.equal(storage.getDiaryEntry(date, entry.id)?.draft, "Next thoughts");
});

test("empty prose edits cannot delete the entry's conversation", () => {
  const entry = storage.createDiaryEntry(date);
  storage.submitDiaryMessage(date, entry.id!, "First writing");
  storage.setDiaryEntry(date, "", entry.id);
  assert.equal(storage.getDiaryEntry(date, entry.id)?.conversation?.length, 1);
});