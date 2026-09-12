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