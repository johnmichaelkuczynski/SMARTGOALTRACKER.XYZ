---
name: Object-storage path ownership (IDOR)
description: Any server route that downloads/transcribes/reads an object by a client-supplied objectPath must enforce ownership, not just auth.
---

Routes that accept a client-supplied `objectPath` (e.g. voice transcribe, document register) and then `getObjectEntityFile(...).download()` must check object-level ownership, not just that the caller is signed in. Otherwise any authenticated user who learns/guesses another user's object path can read their bytes (IDOR).

**Why:** `ObjectStorageService.getObjectEntityFile()` only validates `/objects/...` format + existence. `canAccessObject()` returns `false` when no ACL policy exists, so it can't be used as the sole gate for a *fresh* presigned upload (which has no policy yet until claimed).

**How to apply (claim-on-first-use):**
1. `getObjectAclPolicy(file)`.
2. If a policy exists and `owner !== userId` → return 403.
3. If no policy → this is the uploader's fresh object; proceed and then `trySetObjectEntityAclPolicy({ owner: userId, visibility: "private" })` to claim it.
4. Also cap object size (`metadata.size`) before `download()` to avoid buffering huge blobs, and put `AbortSignal.timeout(...)` on outbound third-party fetches (e.g. AssemblyAI) so a hung upstream can't tie up the request.
