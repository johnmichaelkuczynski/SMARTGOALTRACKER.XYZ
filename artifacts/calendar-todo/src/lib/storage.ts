import { useSyncExternalStore } from "react";
import type { Completion, StoreState, Task } from "./types";
import { seedData } from "./seed";

const KEY = "tally:v1";

function load(): StoreState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const seeded = seedData();
      localStorage.setItem(KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw) as StoreState;
    if (!parsed.tasks) parsed.tasks = [];
    if (!parsed.completions) parsed.completions = [];
    return parsed;
  } catch {
    const seeded = seedData();
    return seeded;
  }
}

let state: StoreState = typeof window !== "undefined" ? load() : { tasks: [], completions: [], seeded: false };
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
  listeners.forEach((l) => l());
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
    state = {
      ...state,
      completions: state.completions.filter((c) => !(c.taskId === taskId && c.date === date)),
    };
  } else {
    const completion: Completion = {
      taskId,
      date,
      completedAt: new Date().toISOString(),
    };
    state = { ...state, completions: [...state.completions, completion] };
  }
  persist();
}

export function isCompleted(taskId: string, date: string): boolean {
  return state.completions.some((c) => c.taskId === taskId && c.date === date);
}

export function clearAll() {
  state = { tasks: [], completions: [], seeded: true };
  persist();
}

export function resetSeed() {
  state = seedData();
  persist();
}
