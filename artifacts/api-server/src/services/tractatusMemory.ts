/**
 * tractatusMemory.ts
 *
 * Hierarchical compression memory system.
 * Tier 1 = live (new facts appended every turn).
 * Tier 2+ = progressively compressed summaries.
 * ALL tiers are dynamic — nothing is immutable.
 * Compression is chunked so arbitrarily large tiers never fail.
 *
 * FOUNDATION MODEL: The highest-numbered tier is the most compressed and
 * serves as the authoritative foundation. buildTieredPromptContext renders
 * the highest tier first (labelled FOUNDATION) so the LLM treats it with
 * highest authority.
 *
 * CONCURRENCY SAFETY:
 *   compressTier is split into two phases:
 *   Phase 1 – read the tier + call Claude (outside any lock, long-running).
 *   Phase 2 – write inside db.transaction() with pg_advisory_xact_lock so
 *              lock acquisition, re-read, all writes, and lock release all
 *              execute on the same pinned connection, serializing concurrent
 *              compressions of the same tier without holding the lock during
 *              Claude API calls.
 *
 *   DB INVARIANT: UNIQUE(job_id, job_type, tier) constraint on tractatus_tiers
 *   ensures one row per tier. getTier picks the most-recently-updated row as a
 *   last-resort dedup if the constraint was not yet present.
 */

import { eq, and, asc, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, tractatusTiersTable, tractatusArchiveTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";

// ── Types ─────────────────────────────────────────────────────────────────────

export type NodeTag =
  | "ASSERTS"
  | "REJECTS"
  | "ASSUMES"
  | "OPEN"
  | "KEY_TERM"
  | "ENTITY"
  | "CROSS_REF"
  | "CONFLICT_FLAG";

export interface TreeNode {
  k: string;
  tag: NodeTag;
  text: string;
}

export interface DeltaNode {
  tag: NodeTag;
  text: string;
}

export interface Tier {
  id: string;
  tier: number;
  tree: { nodes: TreeNode[] };
  nodeCount: number;
  compressionCount: number;
  lastUpdate: Date;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Compression threshold per tier: when nodeCount hits this, compress into tier+1. */
const TIER_THRESHOLDS: Record<number, number> = {
  1: 60,   // compress live tier at 60 nodes
  2: 50,   // compress tier-2 at 50 nodes
  3: 40,   // compress tier-3 at 40 nodes
};
const DEFAULT_THRESHOLD = 35;

/** Max nodes kept in source tier after compression (load-bearing nodes are always kept). */
const POST_COMPRESS_KEEP = 20;

/** Nodes per chunk when a tier is too large for one Claude call. */
const COMPRESS_CHUNK_SIZE = 60;

const ANTI_SYCOPHANCY_CLAUSES = `ANTI_SYCOPHANCY_CLAUSES:
- Preserve every REJECTS entry verbatim. Do not soften, qualify, or convert a REJECTS into an OPEN.
- Preserve every numerical value, date, proper name, citation, and quoted phrase exactly as it appears.
- If two entries contradict, do not silently merge them. Emit a CONFLICT_FLAG entry that quotes both.
- Defeats, negative results, and counterexamples are load-bearing. Preserve them anyway.
- You are not being graded on smoothness. You are graded on whether the tier can detect a hallucination two turns from now.`;

// ── Helpers ────────────────────────────────────────────────────────────────────

function treeNodes(tier: Tier): TreeNode[] {
  return tier.tree?.nodes ?? [];
}

function isLoadBearing(tag: NodeTag): boolean {
  return tag === "REJECTS" || tag === "CONFLICT_FLAG";
}

function renderNodes(nodes: TreeNode[]): string {
  return nodes.map((n) => `${n.k}: ${n.tag}: ${n.text}`).join("\n");
}

function generateKeys(existingNodes: TreeNode[], newCount: number): string[] {
  const maxNum = existingNodes.reduce((max, n) => {
    const num = parseFloat(n.k);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0);
  return Array.from({ length: newCount }, (_, i) =>
    (Math.floor(maxNum) + 1 + i).toFixed(1),
  );
}

/**
 * Produce a stable pair of signed int32 advisory lock keys for (jobId, jobType, tier).
 * Uses FNV-1a hash of the job key. The tier is the second key component.
 * These map to the two-argument form of pg_advisory_xact_lock(int4, int4).
 */
function tierLockKeys(jobId: string, jobType: string, tier: number): [number, number] {
  const str = `${jobId}:${jobType}`;
  // FNV-1a 32-bit
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (Math.imul(h, 16777619) >>> 0);
  }
  // Convert to signed int32 for pg
  const k1 = h | 0;
  // Tier as second key (clamped to positive int32)
  const k2 = tier & 0x7fffffff;
  return [k1, k2];
}

// ── Database helpers ───────────────────────────────────────────────────────────

export async function loadAllTiers(jobId: string, jobType: string): Promise<Tier[]> {
  const rows = await db
    .select()
    .from(tractatusTiersTable)
    .where(and(eq(tractatusTiersTable.jobId, jobId), eq(tractatusTiersTable.jobType, jobType)))
    .orderBy(asc(tractatusTiersTable.tier));
  return rows.map((r) => ({
    id: r.id,
    tier: r.tier,
    tree: (r.tree as { nodes: TreeNode[] }),
    nodeCount: r.nodeCount,
    compressionCount: r.compressionCount,
    lastUpdate: r.lastUpdate,
  }));
}

/**
 * Load a single tier row using the given db-like querier (db or a transaction).
 * If somehow multiple rows exist for the same tier (race before constraint was applied),
 * picks the most recently-updated row.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getTierQ(querier: any, jobId: string, jobType: string, tierNum: number): Promise<Tier | null> {
  const rows = await querier
    .select()
    .from(tractatusTiersTable)
    .where(and(
      eq(tractatusTiersTable.jobId, jobId),
      eq(tractatusTiersTable.jobType, jobType),
      eq(tractatusTiersTable.tier, tierNum),
    ))
    .orderBy(sql`${tractatusTiersTable.lastUpdate} DESC`)
    .limit(1);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id,
    tier: r.tier,
    tree: (r.tree as { nodes: TreeNode[] }),
    nodeCount: r.nodeCount,
    compressionCount: r.compressionCount,
    lastUpdate: r.lastUpdate,
  };
}

/** Convenience wrapper using the global db connection (for reads outside transactions). */
async function getTier(jobId: string, jobType: string, tierNum: number): Promise<Tier | null> {
  return getTierQ(db, jobId, jobType, tierNum);
}

async function archiveTier(
  jobId: string,
  jobType: string,
  tier: Tier,
  reason: "pre_compression" | "pre_repair" | "manual_audit",
): Promise<void> {
  try {
    await db.insert(tractatusArchiveTable).values({
      id: randomUUID(),
      jobId,
      jobType,
      tier: tier.tier,
      treeSnapshot: tier.tree as Record<string, unknown>,
      nodeCountAtSnapshot: tier.nodeCount,
      reason,
    });
  } catch {
    // archive failure is non-fatal
  }
}

// ── Compression (chunked) ──────────────────────────────────────────────────────

/** Call Claude to compress a flat list of nodes into a smaller set. */
async function compressNodes(nodes: TreeNode[]): Promise<DeltaNode[]> {
  const flatSource = renderNodes(nodes);

  const prompt = `You are compressing a memory tier. Synthesize the nodes below into a smaller, coherent set that preserves all essential knowledge.

${ANTI_SYCOPHANCY_CLAUSES}

SOURCE NODES:
${flatSource}

OUTPUT REQUIREMENTS:
- Return ONLY a JSON array: [{"tag":"ASSERTS","text":"..."},...]
- Allowed tags: ASSERTS, REJECTS, ASSUMES, OPEN, KEY_TERM, ENTITY, CROSS_REF, CONFLICT_FLAG
- Preserve 100% of REJECTS and CONFLICT_FLAG entries verbatim
- Preserve all dates, proper names, numerical values, case numbers exactly
- Merge or summarize ASSERTS and ASSUMES intelligently
- Output no prose — only the JSON array`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  // Try full array parse first
  const start = stripped.indexOf("[");
  if (start !== -1) {
    let depth = 0, end = -1, inStr = false, esc = false;
    for (let i = start; i < stripped.length; i++) {
      const c = stripped[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) {
      try {
        const parsed = JSON.parse(stripped.slice(start, end + 1)) as DeltaNode[];
        if (parsed.length > 0) return parsed;
      } catch { /* fall through */ }
    }
  }

  // Fallback: extract individual objects
  const results: DeltaNode[] = [];
  let i = 0;
  while (i < stripped.length) {
    const objStart = stripped.indexOf("{", i);
    if (objStart === -1) break;
    let depth = 0, objEnd = -1, inStr = false, esc = false;
    for (let j = objStart; j < stripped.length; j++) {
      const c = stripped[j];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { objEnd = j; break; } }
    }
    if (objEnd === -1) break;
    try {
      const obj = JSON.parse(stripped.slice(objStart, objEnd + 1)) as DeltaNode;
      if (obj.tag && obj.text) results.push(obj);
    } catch { /* skip malformed */ }
    i = objEnd + 1;
  }

  if (results.length === 0) {
    throw new Error(`compressNodes: failed to parse Claude output (${raw.slice(0, 200)})`);
  }
  console.warn(`[tractatusMemory] compressNodes: recovered ${results.length} nodes from partial output`);
  return results;
}

/** Run chunked Claude compression on a list of nodes. Pure function — no DB access. */
async function doChunkedCompression(sourceNodes: TreeNode[]): Promise<DeltaNode[]> {
  if (sourceNodes.length <= COMPRESS_CHUNK_SIZE) {
    return compressNodes(sourceNodes);
  }

  // First pass: compress each chunk independently
  const chunks: TreeNode[][] = [];
  for (let i = 0; i < sourceNodes.length; i += COMPRESS_CHUNK_SIZE) {
    chunks.push(sourceNodes.slice(i, i + COMPRESS_CHUNK_SIZE));
  }
  const chunkResults: DeltaNode[] = [];
  for (const chunk of chunks) {
    chunkResults.push(...(await compressNodes(chunk)));
  }

  // Second pass: if still large, merge-compress
  if (chunkResults.length > COMPRESS_CHUNK_SIZE) {
    const mergeNodes: TreeNode[] = chunkResults.map((d, idx) => ({
      k: `${idx + 1}.0`, tag: d.tag, text: d.text,
    }));
    return compressNodes(mergeNodes);
  }
  return chunkResults;
}

/**
 * Build the final compressed node list, enforcing REJECTS/CONFLICT_FLAG preservation.
 * Pure function — no DB access.
 */
function buildCompressedNodeList(
  sourceNodes: TreeNode[],
  compressedDelta: DeltaNode[],
): TreeNode[] {
  // Enforce: never drop REJECTS or CONFLICT_FLAGs
  const srcRejects = sourceNodes.filter((n) => n.tag === "REJECTS").map((n) => n.text);
  const outRejects = compressedDelta.filter((d) => d.tag === "REJECTS").map((d) => d.text);
  for (const r of srcRejects) {
    if (!outRejects.some((cr) => cr.trim() === r.trim())) {
      compressedDelta.push({ tag: "REJECTS", text: r });
    }
  }
  const srcConflicts = sourceNodes.filter((n) => n.tag === "CONFLICT_FLAG").map((n) => n.text);
  const outConflicts = compressedDelta.filter((d) => d.tag === "CONFLICT_FLAG").map((d) => d.text);
  for (const c of srcConflicts) {
    if (!outConflicts.some((cc) => cc.trim() === c.trim())) {
      compressedDelta.push({ tag: "CONFLICT_FLAG", text: c });
    }
  }
  return compressedDelta.map((d, i) => ({ k: `${i + 1}.0`, tag: d.tag, text: d.text }));
}

/**
 * Compress sourceTier into sourceTier+1.
 *
 * TWO-PHASE CONCURRENCY DESIGN:
 *
 * Phase 1 (outside any lock):
 *   Read the source tier and run chunked Claude compression.
 *   This is the slow, long-running part — holding a DB lock here would
 *   exhaust the connection pool under concurrent load.
 *
 * Phase 2 (inside db.transaction — one pinned connection):
 *   1. Acquire pg_advisory_xact_lock(k1, k2) — transaction-level, so it
 *      auto-releases on commit/rollback on the same connection.
 *   2. Re-read the source tier to confirm it is still above threshold
 *      (a concurrent process may have already compressed it during Phase 1).
 *   3. Write compressed nodes to the destination tier.
 *   4. Trim the source tier.
 *   5. Record whether the destination tier now exceeds its threshold.
 *
 * Cascade happens after the transaction commits, using a fresh lock acquisition
 * for the destination tier.
 */
export async function compressTier(
  jobId: string,
  jobType: string,
  sourceTier: number,
): Promise<void> {
  const threshold = TIER_THRESHOLDS[sourceTier] ?? DEFAULT_THRESHOLD;

  // ── Phase 1: Read + Claude compression (outside any DB lock) ─────────────
  const tier = await getTier(jobId, jobType, sourceTier);
  if (!tier) {
    console.warn(`[tractatusMemory] compressTier: Tier ${sourceTier} not found for ${jobId}`);
    return;
  }
  if (tier.nodeCount < threshold) return; // already below threshold

  // Archive before compression (non-fatal, outside transaction)
  await archiveTier(jobId, jobType, tier, "pre_compression");

  const sourceNodes = treeNodes(tier);
  const compressedDelta = await doChunkedCompression(sourceNodes);
  const compressedNodes = buildCompressedNodeList(sourceNodes, compressedDelta);

  // ── Phase 2: Write under transaction-level advisory lock ─────────────────
  // pg_advisory_xact_lock holds for the duration of this transaction and
  // releases automatically on commit/rollback — all on the same connection.
  const [k1, k2] = tierLockKeys(jobId, jobType, sourceTier);
  let cascadeDestTier: number | null = null;

  await db.transaction(async (tx) => {
    // All operations in this callback run on one pinned DB connection.
    // The advisory lock serializes concurrent compressions of the same tier.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = tx as unknown as typeof db;

    await q.execute(sql`SELECT pg_advisory_xact_lock(${k1}::int, ${k2}::int)`);

    // Re-read under lock: if a concurrent process already compressed this tier
    // during our Phase 1 (Claude), skip the write to avoid double-compression.
    const freshTier = await getTierQ(q, jobId, jobType, sourceTier);
    if (!freshTier || freshTier.nodeCount < threshold) {
      return; // concurrent process handled it — nothing to write
    }

    const destTier = sourceTier + 1;
    const existing = await getTierQ(q, jobId, jobType, destTier);

    if (existing) {
      const existingNodes = treeNodes(existing);
      const keys = generateKeys(existingNodes, compressedNodes.length);
      const mergedNodes = [
        ...existingNodes,
        ...compressedNodes.map((n, i) => ({ ...n, k: keys[i] })),
      ];
      await q.update(tractatusTiersTable)
        .set({
          tree: { nodes: mergedNodes } as unknown as Record<string, unknown>,
          nodeCount: mergedNodes.length,
          compressionCount: (existing.compressionCount ?? 0) + 1,
          lastUpdate: new Date(),
        })
        .where(eq(tractatusTiersTable.id, existing.id));

      // Check cascade condition based on post-merge count
      const destThreshold = TIER_THRESHOLDS[destTier] ?? DEFAULT_THRESHOLD;
      if (mergedNodes.length >= destThreshold) {
        cascadeDestTier = destTier;
      }
    } else {
      // No existing destTier row — insert one.
      // ON CONFLICT handles the rare race where two processes both reached this
      // branch simultaneously (unique constraint on job_id, job_type, tier).
      await q.execute(sql`
        INSERT INTO tractatus_tiers
          (id, job_id, job_type, tier, tree, node_count, compression_count, last_update)
        VALUES (
          gen_random_uuid(),
          ${jobId},
          ${jobType},
          ${destTier},
          ${JSON.stringify({ nodes: compressedNodes })}::jsonb,
          ${compressedNodes.length},
          1,
          NOW()
        )
        ON CONFLICT (job_id, job_type, tier) DO UPDATE SET
          tree = jsonb_build_object('nodes',
            (tractatus_tiers.tree -> 'nodes') ||
            ${JSON.stringify(compressedNodes)}::jsonb
          ),
          node_count = jsonb_array_length(
            (tractatus_tiers.tree -> 'nodes') ||
            ${JSON.stringify(compressedNodes)}::jsonb
          ),
          compression_count = tractatus_tiers.compression_count + 1,
          last_update = NOW()
      `);

      const destThreshold = TIER_THRESHOLDS[destTier] ?? DEFAULT_THRESHOLD;
      if (compressedNodes.length >= destThreshold) {
        cascadeDestTier = destTier;
      }
    }

    // Trim source tier: keep load-bearing nodes + most-recent non-load-bearing up to POST_COMPRESS_KEEP
    // Use freshTier's nodes (current state, read under lock) for the trim
    const freshNodes = treeNodes(freshTier);
    const loadBearing = freshNodes.filter((n) => isLoadBearing(n.tag));
    const trimable = freshNodes.filter((n) => !isLoadBearing(n.tag));
    const kept = trimable.slice(-Math.max(0, POST_COMPRESS_KEEP - loadBearing.length));
    const trimmed = [...loadBearing, ...kept];

    await q.update(tractatusTiersTable)
      .set({
        tree: { nodes: trimmed } as unknown as Record<string, unknown>,
        nodeCount: trimmed.length,
        lastUpdate: new Date(),
      })
      .where(eq(tractatusTiersTable.id, freshTier.id));
    // Transaction commits here; pg_advisory_xact_lock released automatically.
  });

  // ── Cascade: compress destination tier if it exceeded threshold ────────────
  // Outside the transaction — acquires a fresh lock for destTier independently.
  if (cascadeDestTier !== null) {
    await compressTier(jobId, jobType, cascadeDestTier);
  }
}

// ── Live tier update ───────────────────────────────────────────────────────────

/**
 * Append delta nodes to Tier 1 (live tier).
 * Creates Tier 1 if it does not exist.
 * Triggers chunked compression if node count exceeds threshold.
 */
export async function updateLiveTier(
  jobId: string,
  jobType: string,
  delta: DeltaNode[],
): Promise<{ nodeCount: number; compressed: boolean }> {
  if (!delta.length) return { nodeCount: 0, compressed: false };

  const existing = await getTier(jobId, jobType, 1);
  const currentNodes: TreeNode[] = existing ? treeNodes(existing) : [];
  const keys = generateKeys(currentNodes, delta.length);
  const newNodes: TreeNode[] = delta.map((d, i) => ({ k: keys[i], tag: d.tag, text: d.text }));
  const allNodes = [...currentNodes, ...newNodes];
  const nodeCount = allNodes.length;

  if (existing) {
    await db.update(tractatusTiersTable)
      .set({
        tree: { nodes: allNodes } as unknown as Record<string, unknown>,
        nodeCount,
        lastUpdate: new Date(),
      })
      .where(eq(tractatusTiersTable.id, existing.id));
  } else {
    // Use ON CONFLICT to handle rare concurrent inserts on Tier 1
    await db.execute(sql`
      INSERT INTO tractatus_tiers
        (id, job_id, job_type, tier, tree, node_count, compression_count, last_update)
      VALUES (
        gen_random_uuid(), ${jobId}, ${jobType}, 1,
        ${JSON.stringify({ nodes: allNodes })}::jsonb,
        ${nodeCount}, 0, NOW()
      )
      ON CONFLICT (job_id, job_type, tier) DO UPDATE SET
        tree = jsonb_build_object('nodes',
          (tractatus_tiers.tree -> 'nodes') ||
          ${JSON.stringify(newNodes)}::jsonb
        ),
        node_count = tractatus_tiers.node_count + ${newNodes.length},
        last_update = NOW()
    `);
  }

  const threshold = TIER_THRESHOLDS[1] ?? DEFAULT_THRESHOLD;
  let compressed = false;
  if (nodeCount >= threshold) {
    try {
      await compressTier(jobId, jobType, 1);
      compressed = true;
    } catch (err) {
      console.error("[tractatusMemory] Compression failed:", err);
      throw err;
    }
  }

  return { nodeCount, compressed };
}

// ── Prompt context builder ─────────────────────────────────────────────────────

/**
 * Build the tiered prompt context string for injection into the system prompt.
 * Total budget: ~20,000 characters.
 * Higher tiers (more compressed = more foundational) get priority.
 * The highest-numbered tier is labelled FOUNDATION and shown first.
 */
export async function buildTieredPromptContext(
  jobId: string,
  jobType: string,
): Promise<string> {
  const tiers = await loadAllTiers(jobId, jobType);
  if (!tiers.length) return "";

  // Highest tier = most compressed = foundational. Show highest first.
  const sorted = [...tiers].sort((a, b) => b.tier - a.tier);

  const TOTAL_BUDGET = 20_000;
  const perTierBudget = Math.floor(TOTAL_BUDGET / Math.max(sorted.length, 1));

  const parts: string[] = [];

  for (const t of sorted) {
    const budget = Math.max(perTierBudget, 3000);
    const nodes = treeNodes(t);
    const loadBearingNodes = nodes.filter((n) => isLoadBearing(n.tag));
    const normalNodes = nodes.filter((n) => !isLoadBearing(n.tag));

    // Tier 1 (live): show newest first
    const orderedNormal = t.tier === 1 ? [...normalNodes].reverse() : normalNodes;

    // Always include load-bearing nodes
    const lbText = renderNodes(loadBearingNodes);

    // Fill remaining budget with normal nodes
    let remaining = budget - lbText.length - 50;
    const normalLines: string[] = [];
    for (const n of orderedNormal) {
      const line = `${n.k}: ${n.tag}: ${n.text}`;
      if (remaining - line.length < 0) break;
      normalLines.push(line);
      remaining -= line.length + 1;
    }

    const allLines = [
      ...normalLines,
      ...loadBearingNodes.map((n) => `${n.k}: ${n.tag}: ${n.text}`),
    ];
    const text = allLines.join("\n");

    if (text.trim()) {
      const maxTier = Math.max(...tiers.map((t) => t.tier));
      const label = t.tier === maxTier
        ? `TIER ${t.tier} — FOUNDATION (most compressed, highest authority)`
        : t.tier === 1
        ? "TIER 1 — LIVE MEMORY (recent facts, newest first)"
        : `TIER ${t.tier} — COMPRESSED (intermediate summary)`;
      parts.push(`=== ${label} ===\n${text}`);
    }
  }

  return parts.join("\n\n");
}

// ── Memory viewer ──────────────────────────────────────────────────────────────

export interface TierView {
  tier: number;
  nodeCount: number;
  compressionCount: number;
  lastUpdate: Date;
  nodes: TreeNode[];
}

export async function viewAllTiers(jobId: string, jobType: string): Promise<TierView[]> {
  const tiers = await loadAllTiers(jobId, jobType);
  return tiers.map((t) => ({
    tier: t.tier,
    nodeCount: t.nodeCount,
    compressionCount: t.compressionCount,
    lastUpdate: t.lastUpdate,
    nodes: treeNodes(t),
  }));
}

// ── Force repair ───────────────────────────────────────────────────────────────

/**
 * Force-compress all tiers to a clean state.
 * Loops until every tier is below its threshold (up to MAX_ROUNDS iterations).
 * Processes the lowest over-threshold tier each round and lets compressTier's
 * cascade handle higher tiers automatically.
 *
 * Uses the same advisory-locked, two-phase compressTier path so repair is safe
 * to call concurrently with live chat turns.
 *
 * FOUNDATION GUARANTEE: the highest-numbered tier is never deleted by repair —
 * it serves as the durable foundation (most-compressed, authoritative summary
 * of all prior memory). Lower tiers are trimmed after compression.
 */
export async function forceRepairMemory(
  jobId: string,
  jobType: string,
): Promise<{ tiersRepaired: number; rounds: number }> {
  let tiersRepaired = 0;
  const MAX_ROUNDS = 8;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const tiers = await loadAllTiers(jobId, jobType);

    // Find the lowest over-threshold tier (compressTier cascade handles higher ones)
    const overThreshold = tiers
      .sort((a, b) => a.tier - b.tier)
      .find((t) => t.nodeCount > (TIER_THRESHOLDS[t.tier] ?? DEFAULT_THRESHOLD));

    if (!overThreshold) {
      // All tiers are below threshold — stable state reached
      return { tiersRepaired, rounds: round - 1 };
    }

    try {
      await compressTier(jobId, jobType, overThreshold.tier);
      tiersRepaired++;
    } catch (err) {
      console.error(`[tractatusMemory] forceRepairMemory round ${round}: failed to compress tier ${overThreshold.tier}:`, err);
    }
  }

  console.warn(`[tractatusMemory] forceRepairMemory: hit MAX_ROUNDS (${MAX_ROUNDS}) for ${jobId}`);
  return { tiersRepaired, rounds: MAX_ROUNDS };
}

// ── Audit ──────────────────────────────────────────────────────────────────────

export interface AuditReport {
  verified: string[];
  contradicted: string[];
  unverifiable: string[];
}

export async function auditAgainstMemory(
  text: string,
  jobId: string,
  jobType: string,
): Promise<AuditReport> {
  const memoryContext = await buildTieredPromptContext(jobId, jobType);

  if (!memoryContext) {
    return { verified: [], contradicted: [], unverifiable: ["No memory exists yet for this job."] };
  }

  const auditPrompt = `You are auditing a text against a memory store.

MEMORY:
${memoryContext}

TEXT TO AUDIT:
${text}

For each factual claim in the TEXT, classify it as:
- VERIFIED: directly supported by a memory node
- CONTRADICTED: directly contradicted by a memory node (quote the node)
- UNVERIFIABLE: cannot be confirmed or denied from the memory

${ANTI_SYCOPHANCY_CLAUSES}

Return ONLY JSON:
{
  "verified": ["claim text..."],
  "contradicted": ["claim text — contradicts: [node text]"],
  "unverifiable": ["claim text..."]
}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{ role: "user", content: auditPrompt }],
  });

  const raw = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as AuditReport;
  } catch { /* fall through */ }

  return { verified: [], contradicted: [], unverifiable: ["Audit parsing failed: " + raw.slice(0, 300)] };
}

// ── Delta extraction ───────────────────────────────────────────────────────────

/**
 * Extract a delta from one conversation turn.
 * Returns delta nodes to be written into Tier 1.
 */
export async function extractDeltaFromTurn(
  userMessage: string,
  assistantReply: string,
  jobId: string,
  jobType: string,
): Promise<DeltaNode[]> {
  // Load highest-numbered tier for context
  const allTiers = await loadAllTiers(jobId, jobType);
  const topTier = allTiers.sort((a, b) => b.tier - a.tier)[0];
  const memoryHint = topTier
    ? `EXISTING MEMORY CONTEXT (highest tier — most compressed):\n${renderNodes(treeNodes(topTier).slice(0, 15))}`
    : "";

  const deltaPrompt = `You are extracting a delta update for a memory tier from one conversation turn.

${memoryHint}

USER MESSAGE:
${userMessage.slice(0, 2000)}

ASSISTANT REPLY:
${assistantReply.slice(0, 3000)}

${ANTI_SYCOPHANCY_CLAUSES}

Extract ONLY genuinely new or updated facts, commitments, entities, case details, and open questions worth persisting. Do not extract generic or already-known information.

Return ONLY a JSON array:
[{"tag":"ASSERTS","text":"..."}, {"tag":"ENTITY","text":"..."}, ...]

Allowed tags: ASSERTS, REJECTS, ASSUMES, OPEN, KEY_TERM, ENTITY, CROSS_REF, CONFLICT_FLAG
If nothing new emerged from this turn, return: []
Output ONLY the JSON array.`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: deltaPrompt }],
  });

  const raw = response.content[0]?.type === "text" ? response.content[0].text : "[]";

  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as DeltaNode[];
      return parsed.filter(
        (d) => typeof d.tag === "string" && typeof d.text === "string" && d.text.trim().length > 0,
      );
    }
  } catch { /* fall through */ }

  return [];
}
