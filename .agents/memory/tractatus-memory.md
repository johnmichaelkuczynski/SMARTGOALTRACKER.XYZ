---
name: Tractatus memory system
description: Tractatus Skeleton Fusion long-term memory for the Informed LLM — architecture, tables, module location, integration points.
---

# Tractatus Memory System

## What it is
A durable, tiered, compression-resistant long-term memory layer for the Informed LLM. Based on Tractatus Skeleton Fusion + Cross-Chunk Coherence architecture per owner's specification.

## Database tables (Neon Postgres)
- `tractatus_tiers` — stores all memory tiers per job (T0=skeleton/immutable, T1=live, T2+=compressed)
- `tractatus_archive` — snapshots taken before every compression (reason: pre_compression | pre_repair | manual_audit)
- Created via direct SQL (drizzle-kit push fails in non-TTY environments)

## Owner module
`artifacts/api-server/src/services/tractatusMemory.ts` — ONLY this module may read/write the two tables.

## Key functions
- `skeletonToTier0(skeleton, jobId, jobType)` — immutable; no-op if T0 exists
- `updateLiveTier(jobId, jobType, delta)` — appends delta nodes to T1; compresses at 150 nodes
- `compressTier(jobId, jobType, sourceTier)` — archives then compresses via Claude; REJECTS/CONFLICT_FLAG never dropped
- `buildTieredPromptContext(jobId, jobType)` — builds 15k-char tiered context string
- `extractUserSkeleton(userId, state, messages)` — called once on first Informed use
- `extractDeltaFromTurn(userMsg, assistantReply, jobId, jobType)` — Haiku call after each turn
- `auditAgainstMemory(text, jobId, jobType)` — returns {verified, contradicted, unverifiable}

## Integration in informed.ts
- jobId = `${userId}-life`, jobType = `"informed_life"` (per-user life job)
- First message: extracts skeleton → skeletonToTier0
- Before Claude: injects buildTieredPromptContext into system prompt (takes priority over flat context)
- After Claude: fire-and-forget extractDeltaFromTurn → updateLiveTier
- Audit endpoint: POST /api/informed/audit
- Status endpoint: GET /api/informed/memory/status

## Feature flag
`TRACTATUS_MEMORY_ENABLED !== "false"` — defaults ON. Set env var to "false" to revert to flat context fallback.

## Anti-sycophancy clauses
Verbatim block stored as `ANTI_SYCOPHANCY_CLAUSES` constant. Must appear in: chunk/message prompt, delta extraction prompt, compression prompt.

**Why:** Owner specified this to prevent REJECTS being softened to OPEN, prevent hallucinated facts, and ensure contradictions are flagged rather than silently merged.

## Tier budgets (buildTieredPromptContext)
T0: 6000 chars | T1: 5000 chars | T2: 2500 chars | T3+: 1500 chars total. REJECTS and CONFLICT_FLAG always included even if budget exceeded.
