import { useSyncExternalStore } from "react";
import {
  getState as fetchServerState,
  saveState as saveServerState,
} from "@workspace/api-client-react";
import type {
  Completion,
  CompletionStatus,
  JournalEntry,
  JournalPeriod,
  StoreState,
  Task,
} from "./types";
import { seedData } from "./seed";

const LEGACY_KEY = "tally:v1";
const SAVE_DEBOUNCE_MS = 800;

export type SyncStatus = "idle" | "loading" | "ready";

function keyFor(userId: string | null): string {
  return userId ? `tally:v1:${userId}` : LEGACY_KEY;
}

function emptyState(): StoreState {
  return { tasks: [], completions: [], journal: [], seeded: false };
}

function normalize(raw: Partial<StoreState> | null | undefined): StoreState {
  const s = (raw ?? {}) as StoreState;
  if (!s.tasks) s.tasks = [];
  if (!s.completions) s.completions = [];
  if (!s.journal) s.journal = [];
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

let activeUserId: string | null = null;
// Bumped on every account transition (sign-in, switch, sign-out) so in-flight
// loads/saves can detect they belong to a stale session and bail out.
let syncToken = 0;
let syncStatus: SyncStatus = "idle";
let suppressSave = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

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
  saveTimer = setTimeout(() => void flushSave(userId), SAVE_DEBOUNCE_MS);
}

async function flushSave(userId: string) {
  saveTimer = null;
  // Don't flush a save scheduled for a user who is no longer active.
  if (activeUserId !== userId) return;
  const snapshot = state;
  try {
    await saveServerState({ data: snapshot as unknown as Record<string, unknown> });
  } catch {
    // Keep the local cache; the next change will retry the save.
  }
}

/** Load the signed-in user's state from the server, hydrating from the local cache first for instant UI. */
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
      suppressSave = true;
      state = normalize(res.data as Partial<StoreState>);
      persist();
      suppressSave = false;
    } else {
      // New account: adopt this user's cache, else migrate pre-login anonymous
      // data once (then clear it so other accounts can't inherit it), else seed.
      let initial = cached;
      if (!initial) {
        const legacy = readLocal(LEGACY_KEY);
        if (legacy) {
          initial = legacy;
          try {
            localStorage.removeItem(LEGACY_KEY);
          } catch {}
        }
      }
      state = normalize(initial ?? seedData());
      persist();
    }
  } catch {
    // Offline or server error: keep whatever cache we have.
  } finally {
    if (token === syncToken) setSyncStatus("ready");
  }
}

/** Reset to an empty store on sign-out so no data leaks between accounts. */
export function resetForSignOut(): void {
  syncToken++;
  cancelPendingSave();
  activeUserId = null;
  state = emptyState();
  setSyncStatus("idle");
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

export function clearAll() {
  state = { tasks: [], completions: [], journal: [], seeded: true };
  persist();
}

export function resetSeed() {
  state = seedData();
  persist();
}
