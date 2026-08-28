import { useSyncExternalStore } from "react";
import {
  getState as fetchServerState,
  saveState as saveServerState,
} from "@workspace/api-client-react";
import type {
  Completion,
  CompletionStatus,
  DiaryEntry,
  JournalEntry,
  JournalPeriod,
  Rule,
  RuleOutcome,
  StoreState,
  Task,
} from "./types";
import { seedData } from "./seed";

const LEGACY_KEY = "tally:v1";
const DEVICE_KEY = "tally:device-id";
const SAVE_DEBOUNCE_MS = 800;

function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return "anon-" + Math.random().toString(36).slice(2);
  }
}

export const deviceId: string = getOrCreateDeviceId();

export type SyncStatus = "idle" | "loading" | "ready";
/** Whether the latest local change has been persisted to the server database. */
export type SaveState = "idle" | "saving" | "saved" | "error";

function keyFor(userId: string | null): string {
  return userId ? `tally:v1:${userId}` : LEGACY_KEY;
}

function emptyState(): StoreState {
  return { tasks: [], completions: [], journal: [], diary: [], rules: [], seeded: false };
}

function normalize(raw: Partial<StoreState> | null | undefined): StoreState {
  const s = (raw ?? {}) as StoreState;
  if (!s.tasks) s.tasks = [];
  if (!s.completions) s.completions = [];
  if (!s.journal) s.journal = [];
  if (!s.diary) s.diary = [];
  if (!s.rules) s.rules = [];
  return s;
}

function readLocal(key: string): StoreState | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? normalize(JSON.parse(raw) as StoreState) : null;
  } catch {
    return null;
  }
}

function hasContent(s: StoreState | null | undefined): boolean {
  if (!s) return false;
  return (
    (s.tasks?.length ?? 0) > 0 ||
    (s.completions?.length ?? 0) > 0 ||
    (s.rules?.length ?? 0) > 0 ||
    (s.journal?.length ?? 0) > 0 ||
    (s.diary?.length ?? 0) > 0
  );
}

function contentScore(s: StoreState): number {
  return (
    (s.tasks?.length ?? 0) +
    (s.completions?.length ?? 0) +
    (s.rules?.length ?? 0) +
    (s.journal?.length ?? 0) +
    (s.diary?.length ?? 0)
  );
}

let activeUserId: string | null = null;
// Bumped on every identity transition so stale in-flight requests can bail out.
let syncToken = 0;
let syncStatus: SyncStatus = "idle";
let saveState: SaveState = "idle";
let serverUpdatedAt: string | null = null;
let suppressSave = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
// Single-flight save guard: only one save is ever in flight, and any change
// made while a save runs queues exactly one follow-up that sends the latest
// state. This prevents an older in-flight write from clobbering newer data
// under the server's last-write-wins upsert.
let saving = false;
let resaveQueued = false;

let state: StoreState = emptyState();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function setSyncStatus(s: SyncStatus) {
  if (syncStatus === s) return;
  syncStatus = s;
  notify();
}

function setSaveState(s: SaveState) {
  if (saveState === s) return;
  saveState = s;
  notify();
}

function setServerUpdatedAt(value: string | null) {
  if (serverUpdatedAt === value) return;
  serverUpdatedAt = value;
  notify();
}

function cancelPendingSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function persist() {
  try {
    localStorage.setItem(keyFor(activeUserId), JSON.stringify(state));
  } catch {}
  notify();
  if (!suppressSave && activeUserId) scheduleSave(activeUserId);
}

function scheduleSave(userId: string) {
  cancelPendingSave();
  // A change is pending: reflect "unsaved" immediately so the UI never shows
  // "saved" while local edits have not yet reached the server.
  setSaveState("saving");
  saveTimer = setTimeout(() => void flushSave(userId), SAVE_DEBOUNCE_MS);
}

async function flushSave(userId: string) {
  saveTimer = null;
  // Don't flush a save scheduled for a user who is no longer active.
  if (activeUserId !== userId) return;
  // Serialize: if a save is already running, queue exactly one follow-up that
  // will send the latest state once the current one finishes.
  if (saving) {
    resaveQueued = true;
    return;
  }
  saving = true;
  setSaveState("saving");
  // Capture both the payload and the session token at send time so a save
  // that completes after a session change can't report stale status.
  const token = syncToken;
  const snapshot = state;
  try {
    const saved = await saveServerState({ data: snapshot as unknown as Record<string, unknown> });
    if (token === syncToken && activeUserId === userId) {
      setServerUpdatedAt(saved.updatedAt);
      // Stay in "saving" if newer changes are already queued/pending.
      if (!resaveQueued && !saveTimer) setSaveState("saved");
    }
  } catch {
    // Keep the local cache and surface the failure so the user knows their
    // data has NOT reached the database. retrySave() can re-attempt it.
    if (token === syncToken && activeUserId === userId) setSaveState("error");
  } finally {
    saving = false;
    // Flush any change that arrived while we were in flight, sending the
    // newest state last (correct under last-write-wins).
    if (resaveQueued && activeUserId === userId) {
      resaveQueued = false;
      void flushSave(userId);
    }
  }
}

/** Re-attempt the last server save (used by the "couldn't save" retry UI). */
export function retrySave(): void {
  if (activeUserId) void flushSave(activeUserId);
}

/** Wait until every pending local change has reached the signed-in user's database row. */
export async function ensureStateSaved(): Promise<void> {
  const userId = activeUserId;
  if (!userId) throw new Error("No signed-in user.");

  const hadPendingTimer = saveTimer !== null;
  cancelPendingSave();

  if (saving) {
    if (hadPendingTimer) resaveQueued = true;
  } else if (hadPendingTimer || saveState === "error") {
    await flushSave(userId);
  }

  const deadline = Date.now() + 15_000;
  while (saving || resaveQueued || saveTimer) {
    if (Date.now() >= deadline) throw new Error("Timed out saving the latest workspace data.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  if (saveState === "error") {
    throw new Error("The latest workspace data could not be saved.");
  }
}

/** Immediately remove all private in-memory state when a session ends. */
export function clearActiveSessionState(): void {
  syncToken += 1;
  cancelPendingSave();
  activeUserId = null;
  state = emptyState();
  syncStatus = "idle";
  saveState = "idle";
  serverUpdatedAt = null;
  suppressSave = false;
  resaveQueued = false;
  notify();
}

/** Load the signed-in user's state, hydrating only that user's local cache first. */
export async function syncUser(userId: string): Promise<void> {
  if (activeUserId === userId && syncStatus === "ready") return;
  const token = ++syncToken;
  cancelPendingSave();
  activeUserId = userId;
  setSyncStatus("loading");

  const cached = readLocal(keyFor(userId));
  if (cached && token === syncToken) {
    state = cached;
    notify();
  }

  try {
    const res = await fetchServerState();
    // Bail if the session changed while the request was in flight.
    if (token !== syncToken) return;
    if (res.data && typeof res.data === "object") {
      setServerUpdatedAt(res.updatedAt);
      suppressSave = true;
      state = normalize(res.data as Partial<StoreState>);
      persist();
      suppressSave = false;
    } else {
      setServerUpdatedAt(res.updatedAt);
      state = normalize(cached ?? emptyState());
      persist();
    }
  } catch {
    // Offline or server error: keep whatever cache we have.
  } finally {
    if (token === syncToken) setSyncStatus("ready");
  }
}

/** Flush local edits, then replace in-memory state with the latest authenticated database row. */
export async function refreshUserState(): Promise<void> {
  const userId = activeUserId;
  if (!userId) throw new Error("No signed-in user.");
  await ensureStateSaved();

  const token = syncToken;
  const res = await fetchServerState();
  if (token !== syncToken || activeUserId !== userId) return;

  setServerUpdatedAt(res.updatedAt);
  if (res.data && typeof res.data === "object") {
    suppressSave = true;
    try {
      state = normalize(res.data as Partial<StoreState>);
      persist();
    } finally {
      suppressSave = false;
    }
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useStore(): StoreState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    subscribe,
    () => syncStatus,
    () => syncStatus,
  );
}

export function useSaveState(): SaveState {
  return useSyncExternalStore(
    subscribe,
    () => saveState,
    () => saveState,
  );
}

export function useServerUpdatedAt(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => serverUpdatedAt,
    () => serverUpdatedAt,
  );
}

export function getState(): StoreState {
  return state;
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function addTask(input: Omit<Task, "id" | "createdAt">) {
  const task: Task = {
    ...input,
    id: uid(),
    createdAt: new Date().toISOString(),
  };
  state = { ...state, tasks: [...state.tasks, task] };
  persist();
  return task;
}

export function updateTask(id: string, patch: Partial<Task>) {
  state = {
    ...state,
    tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  };
  persist();
}

/** Toggle one checklist item on a task. Never affects task-level completion. */
export function toggleSubtask(taskId: string, subtaskId: string) {
  state = {
    ...state,
    tasks: state.tasks.map((t) => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        subtasks: (t.subtasks ?? []).map((s) =>
          s.id === subtaskId
            ? { ...s, doneAt: s.doneAt ? undefined : new Date().toISOString() }
            : s,
        ),
      };
    }),
  };
  persist();
}

export function deleteTask(id: string) {
  state = {
    ...state,
    tasks: state.tasks.filter((t) => t.id !== id),
    completions: state.completions.filter((c) => c.taskId !== id),
  };
  persist();
}

export function toggleCompletion(taskId: string, date: string) {
  const existing = state.completions.find((c) => c.taskId === taskId && c.date === date);
  if (existing) {
    clearCompletion(taskId, date);
  } else {
    setCompletion(taskId, date, "done");
  }
}

/** Mark (or update) a completion with a status and optional comment. */
export function setCompletion(
  taskId: string,
  date: string,
  status: CompletionStatus,
  comment?: string,
) {
  const existing = state.completions.find((c) => c.taskId === taskId && c.date === date);
  const trimmed = comment?.trim() || undefined;
  if (existing) {
    state = {
      ...state,
      completions: state.completions.map((c) =>
        c.taskId === taskId && c.date === date ? { ...c, status, comment: trimmed } : c,
      ),
    };
  } else {
    const completion: Completion = {
      taskId,
      date,
      completedAt: new Date().toISOString(),
      status,
      comment: trimmed,
    };
    state = { ...state, completions: [...state.completions, completion] };
  }
  persist();
}

export function clearCompletion(taskId: string, date: string) {
  state = {
    ...state,
    completions: state.completions.filter((c) => !(c.taskId === taskId && c.date === date)),
  };
  persist();
}

export function getCompletion(taskId: string, date: string): Completion | undefined {
  return state.completions.find((c) => c.taskId === taskId && c.date === date);
}

export function isCompleted(taskId: string, date: string): boolean {
  return state.completions.some((c) => c.taskId === taskId && c.date === date);
}

export function getJournalEntry(
  period: JournalPeriod,
  periodKey: string,
): JournalEntry | undefined {
  return state.journal.find((e) => e.period === period && e.periodKey === periodKey);
}

/** Upsert a reflection. Empty text removes the entry. */
export function setJournalEntry(period: JournalPeriod, periodKey: string, text: string) {
  const trimmed = text.trim();
  const rest = state.journal.filter((e) => !(e.period === period && e.periodKey === periodKey));
  state = {
    ...state,
    journal: trimmed
      ? [...rest, { period, periodKey, text: trimmed, updatedAt: new Date().toISOString() }]
      : rest,
  };
  persist();
}

/** Delete a journal entry entirely. */
export function deleteJournalEntry(period: JournalPeriod, periodKey: string) {
  state = {
    ...state,
    journal: state.journal.filter((e) => !(e.period === period && e.periodKey === periodKey)),
  };
  persist();
}

export function getDiaryEntry(date: string): DiaryEntry | undefined {
  return (state.diary ?? []).find((entry) => entry.date === date);
}

/** Upsert one diary entry for a calendar day. Empty text removes the entry. */
export function setDiaryEntry(date: string, text: string) {
  const trimmed = text.trim();
  const rest = (state.diary ?? []).filter((entry) => entry.date !== date);
  state = {
    ...state,
    diary: trimmed
      ? [...rest, { date, text: trimmed, updatedAt: new Date().toISOString() }]
      : rest,
  };
  persist();
}

/** Save the user's own context for the Mind analysis. Empty text clears it. */
export function setMindContext(text: string) {
  const trimmed = text.trim();
  state = { ...state, mindContext: trimmed || undefined };
  persist();
}

export function addRule(input: Omit<Rule, "id" | "createdAt" | "status">) {
  const rule: Rule = {
    ...input,
    id: uid(),
    createdAt: new Date().toISOString(),
    status: "active",
  };
  state = { ...state, rules: [...(state.rules ?? []), rule] };
  persist();
  return rule;
}

export function updateRule(id: string, patch: Partial<Rule>) {
  state = {
    ...state,
    rules: (state.rules ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
  };
  persist();
}

export function deleteRule(id: string) {
  state = { ...state, rules: (state.rules ?? []).filter((r) => r.id !== id) };
  persist();
}

/** End an active rule, recording whether it was held or broken. */
export function endRule(id: string, outcome: RuleOutcome) {
  state = {
    ...state,
    rules: (state.rules ?? []).map((r) =>
      r.id === id
        ? { ...r, status: "ended", outcome, endedAt: new Date().toISOString() }
        : r,
    ),
  };
  persist();
}

/** Bring an ended rule back into force. */
export function reinstateRule(id: string) {
  state = {
    ...state,
    rules: (state.rules ?? []).map((r) =>
      r.id === id
        ? { ...r, status: "active", outcome: undefined, endedAt: undefined }
        : r,
    ),
  };
  persist();
}

export function clearAll() {
  state = { tasks: [], completions: [], journal: [], diary: [], rules: [], seeded: true };
  persist();
}

/** Download the current store as a JSON backup the user can keep or move. */
export function exportState(): string {
  return JSON.stringify(state, null, 2);
}

export type ImportResult = { ok: true; score: number } | { ok: false; error: string };

/**
 * Restore data from a backup blob. Accepts three shapes:
 *  - a raw StoreState object,
 *  - a map of `tally:v1*` keys -> StoreState objects, or
 *  - a map of `tally:v1*` keys -> stringified StoreState (the console-export
 *    format used to lift data out of another app's browser storage).
 * Picks the richest non-empty candidate, adopts it, and syncs it to the server.
 */
export function importState(jsonText: string): ImportResult {
  if (!activeUserId) {
    return { ok: false, error: "Sign in before restoring a backup." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "That doesn't look like valid backup data." };
  }

  const candidates: StoreState[] = [];
  const looksLikeState = (o: unknown): o is Partial<StoreState> =>
    !!o &&
    typeof o === "object" &&
    !Array.isArray(o) &&
    ["tasks", "completions", "rules", "journal", "diary"].some((k) =>
      Array.isArray((o as Record<string, unknown>)[k]),
    );

  const tryAdd = (v: unknown) => {
    let obj: unknown = v;
    if (typeof v === "string") {
      try {
        obj = JSON.parse(v);
      } catch {
        return;
      }
    }
    if (looksLikeState(obj)) candidates.push(normalize(obj));
  };

  if (looksLikeState(parsed)) {
    tryAdd(parsed);
  } else if (parsed && typeof parsed === "object") {
    for (const v of Object.values(parsed as Record<string, unknown>)) tryAdd(v);
  }

  let best: StoreState | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    if (!hasContent(c)) continue;
    const sc = contentScore(c);
    if (sc > bestScore) {
      best = c;
      bestScore = sc;
    }
  }

  if (!best) {
    return { ok: false, error: "No tasks, rules, journal entries, or diary entries were found in that backup." };
  }

  // Safety net: before overwriting, stash the current data under a dedicated
  // backup key so a wrong import is recoverable. The key is deliberately NOT
  // a `tally:v1*` key so normal account sync never reads it.
  if (hasContent(state)) {
    try {
      localStorage.setItem(
        `tally-preimport-backup:${activeUserId ?? "anon"}`,
        JSON.stringify({ savedAt: new Date().toISOString(), data: state }),
      );
    } catch {}
  }

  state = best;
  // persist() writes the local cache and, because a user is signed in,
  // schedules a save to the server database.
  persist();
  setSyncStatus("ready");
  return { ok: true, score: bestScore };
}

export function resetSeed() {
  state = seedData();
  persist();
}
