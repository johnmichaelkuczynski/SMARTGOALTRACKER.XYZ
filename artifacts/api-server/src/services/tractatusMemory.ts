/**
 * tractatusMemory.ts
 *
 * Hierarchical compression memory system.
 * Tier 1 = live (new facts appended every turn).
 * Tier 2+ = progressively compressed summaries.
 * ALL tiers are dynamic — nothing is immutable.
 * Compression is chunked so large tiers never fail.
 */

import { eq, and, asc } from "drizzle-orm";
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

async function getTier(jobId: string, jobType: string, tierNum: number): Promise<Tier | null> {
  const rows = await db
    .select()
    .from(tractatusTiersTable)
    .where(and(
      eq(tractatusTiersTable.jobId, jobId),
      eq(tractatusTiersTable.jobType, jobType),
      eq(tractatusTiersTable.tier, tierNum),
    ))
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

/**
 * Compress sourceTier into sourceTier+1.
 * Uses chunked compression so arbitrarily large tiers never fail.
 * Archives first. After compression, trims source tier.
 */
export async function compressTier(
  jobId: string,
  jobType: string,
  sourceTier: number,
): Promise<void> {
  const tier = await getTier(jobId, jobType, sourceTier);
  if (!tier) throw new Error(`compressTier: Tier ${sourceTier} not found for ${jobId}`);

  await archiveTier(jobId, jobType, tier, "pre_compression");

  const sourceNodes = treeNodes(tier);

  // Chunked compression: split into COMPRESS_CHUNK_SIZE chunks, compress each, then merge-compress
  let compressedDelta: DeltaNode[];

  if (sourceNodes.length <= COMPRESS_CHUNK_SIZE) {
    compressedDelta = await compressNodes(sourceNodes);
  } else {
    // First pass: compress each chunk independently
    const chunks: TreeNode[][] = [];
    for (let i = 0; i < sourceNodes.length; i += COMPRESS_CHUNK_SIZE) {
      chunks.push(sourceNodes.slice(i, i + COMPRESS_CHUNK_SIZE));
    }

    const chunkResults: DeltaNode[] = [];
    for (const chunk of chunks) {
      const result = await compressNodes(chunk);
      chunkResults.push(...result);
    }

    // Second pass: if still large, compress the chunk results together
    if (chunkResults.length > COMPRESS_CHUNK_SIZE) {
      const mergeNodes: TreeNode[] = chunkResults.map((d, idx) => ({
        k: `${idx + 1}.0`, tag: d.tag, text: d.text,
      }));
      compressedDelta = await compressNodes(mergeNodes);
    } else {
      compressedDelta = chunkResults;
    }
  }

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

  const compressedNodes: TreeNode[] = compressedDelta.map((d, i) => ({
    k: `${i + 1}.0`, tag: d.tag, text: d.text,
  }));

  const destTier = sourceTier + 1;
  const existing = await getTier(jobId, jobType, destTier);

  if (existing) {
    const existingNodes = treeNodes(existing);
    const keys = generateKeys(existingNodes, compressedNodes.length);
    const mergedNodes = [
      ...existingNodes,
      ...compressedNodes.map((n, i) => ({ ...n, k: keys[i] })),
    ];
    await db.update(tractatusTiersTable)
      .set({
        tree: { nodes: mergedNodes } as unknown as Record<string, unknown>,
        nodeCount: mergedNodes.length,
        compressionCount: (existing.compressionCount ?? 0) + 1,
        lastUpdate: new Date(),
      })
      .where(eq(tractatusTiersTable.id, existing.id));
  } else {
    await db.insert(tractatusTiersTable).values({
      id: randomUUID(),
      jobId,
      jobType,
      tier: destTier,
      tree: { nodes: compressedNodes } as unknown as Record<string, unknown>,
      nodeCount: compressedNodes.length,
      compressionCount: 1,
    });
  }

  // Trim source tier: keep load-bearing + most recent non-load-bearing up to POST_COMPRESS_KEEP
  const loadBearing = sourceNodes.filter((n) => isLoadBearing(n.tag));
  const trimable = sourceNodes.filter((n) => !isLoadBearing(n.tag));
  const kept = trimable.slice(-Math.max(0, POST_COMPRESS_KEEP - loadBearing.length));
  const trimmed = [...loadBearing, ...kept];

  await db.update(tractatusTiersTable)
    .set({
      tree: { nodes: trimmed } as unknown as Record<string, unknown>,
      nodeCount: trimmed.length,
      lastUpdate: new Date(),
    })
    .where(eq(tractatusTiersTable.id, tier.id));

  // Recursively compress higher tier if it exceeds its threshold
  const destTierRow = await getTier(jobId, jobType, destTier);
  const destThreshold = TIER_THRESHOLDS[destTier] ?? DEFAULT_THRESHOLD;
  if (destTierRow && destTierRow.nodeCount >= destThreshold) {
    await compressTier(jobId, jobType, destTier);
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
    await db.insert(tractatusTiersTable).values({
      id: randomUUID(),
      jobId,
      jobType,
      tier: 1,
      tree: { nodes: allNodes } as unknown as Record<string, unknown>,
      nodeCount,
      compressionCount: 0,
    });
  }

  const threshold = TIER_THRESHOLDS[1] ?? DEFAULT_THRESHOLD;
  let compressed = false;
  if (nodeCount >= threshold) {
    try {
      await compressTier(jobId, jobType, 1);
      compressed = true;
    } catch (err) {
      console.error("[tractatusMemory] Compression failed:", err);
      // Re-throw so the caller knows — don't silently swallow
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
 * Force-compress all tiers down to a clean state.
 * Archives everything first, then compresses from the highest tier downward.
 * Use when tiers have become bloated and automatic compression has fallen behind.
 */
export async function forceRepairMemory(jobId: string, jobType: string): Promise<{ tiersRepaired: number }> {
  const tiers = await loadAllTiers(jobId, jobType);
  let tiersRepaired = 0;

  // Archive all tiers first
  for (const t of tiers) {
    await archiveTier(jobId, jobType, t, "pre_repair");
  }

  // Compress all tiers that exceed their threshold, starting from highest
  const sorted = [...tiers].sort((a, b) => b.tier - a.tier);
  for (const t of sorted) {
    const threshold = TIER_THRESHOLDS[t.tier] ?? DEFAULT_THRESHOLD;
    if (t.nodeCount > threshold) {
      try {
        await compressTier(jobId, jobType, t.tier);
        tiersRepaired++;
      } catch (err) {
        console.error(`[tractatusMemory] forceRepairMemory: failed to compress tier ${t.tier}:`, err);
      }
    }
  }

  return { tiersRepaired };
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
