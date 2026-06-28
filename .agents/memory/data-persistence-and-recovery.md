---
name: Calendar To-Do data persistence & identity-change recovery
description: Where task/goal data actually lives, why an auth-instance change appears to "wipe" it, and how recovery works.
---

**Where data lives:** task/goal/journal/rules data is a single JSON blob kept in
the BROWSER localStorage under `tally:v1:${clerkUserId}` (see
`artifacts/calendar-todo/src/lib/storage.ts`). Server sync (`PUT /state` →
Postgres `user_state` table) is best-effort: `flushSave` swallows all errors. So
if the `user_state` table is missing, saves fail silently and the browser is the
ONLY copy.

**The "all my data is wiped" failure mode:** changing the Clerk auth instance
(e.g. re-running `setupClerkWhitelabelAuth()`, or pasting different Clerk keys)
changes the user's `clerkUserId`. The app then reads `tally:v1:<new-id>` (empty)
while the real data sits stranded under `tally:v1:<old-id>`. Data is NOT deleted —
it's orphaned in the same browser. **Tell the user: do not clear browser
data/history; recovery only works from the same browser.**

**Recovery (implemented):** `storage.ts` `syncUser` now calls
`findRichestOrphan()` — when the active identity's store is empty, it scans all
`tally:v1*` localStorage keys, picks the richest non-empty blob, and adopts it
(non-destructive: old key left as backup). The agent CANNOT verify this worked,
because it cannot read the user's browser localStorage and the screenshot tool
uses a fresh browser with empty storage. Verification requires the user opening
the app in their own browser.

**Also note:** this project's dev Postgres had NO tables (migrations never run).
`pnpm --filter @workspace/db run push` (drizzle-kit push) creates `user_state` and
`documents`. Without the table, server-side backup never worked. There is no
production DB until the app is deployed.

**Why:** prevents future identity-change data loss and makes the browser-only copy
durable server-side once the table exists.

**Cross-origin / duplicate-app recovery:** localStorage is per-origin, so data in a
"duplicate" app (different `.replit.app`/`.replit.dev` URL) is NOT readable server-side
and NOT reachable by `findRichestOrphan` (same-origin only). The only bridge between two
separate projects is the user's browser. Implemented an Export/Import path
(`exportState`/`importState` in storage.ts + `RestoreDataDialog`): a DevTools console
snippet on the source app downloads a `goal-tracker-backup.json` of all `tally:v1*` keys;
the destination app imports it (accepts raw state, map-of-states, or map-of-stringified
states; picks richest non-empty; stashes a `tally-preimport-backup:*` undo copy first).

**Save durability + the preview false-alarm:** `flushSave` now serializes (single
in-flight + one queued resave) so an older write can't clobber newer under the server's
last-write-wins upsert, and surfaces status via `useSaveState`/`retrySave`. CAUTION: a
visible "not saved" error fires in the in-workspace/canvas iframe because cookie auth
401s there (see embedded-preview-auth) — a loud banner there is a FALSE alarm that
enrages users. Keep sync-failure UI subtle (small muted indicator), not a full-width
banner.
