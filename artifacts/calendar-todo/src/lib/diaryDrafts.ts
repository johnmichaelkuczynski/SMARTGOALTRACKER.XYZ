import type { DiaryEntry } from "./types";

/**
 * Recover only newer diary edits from this authenticated user's own cache.
 * A newer server save/deletion must never be undone by an old browser cache.
 */
export function restoreUnsyncedDiaryEdits(
  server: DiaryEntry[],
  cached: DiaryEntry[],
  serverUpdatedAt: string | null,
): DiaryEntry[] {
  const restored = [...server];
  for (const local of cached) {
    if (serverUpdatedAt && local.updatedAt <= serverUpdatedAt) continue;
    const localId = local.id ?? `legacy:${local.date}`;
    const index = restored.findIndex((entry) =>
      (entry.id ?? `legacy:${entry.date}`) === localId && entry.date === local.date,
    );
    if (index < 0) {
      if (local.text.trim() || local.draft?.trim() || local.conversation?.length) restored.push(local);
    } else if (local.updatedAt > restored[index].updatedAt) {
      // Recover the whole entry so submitted prose and its conversation cannot diverge.
      restored[index] = local;
    }
  }
  return restored;
}
