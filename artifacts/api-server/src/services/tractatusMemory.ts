/**
 * tractatusMemory.ts
 *
 * Single owner module for the Tractatus Skeleton Fusion memory system.
 * ONLY this module may read/write tractatus_tiers and tractatus_archive.
 * All other code must call these exported functions.
 */

import { eq, and, asc, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, tractatusTiersTable, tractatusArchiveTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Skeleton {
  thesis: string;
  outline: string[];
  keyTerms: { term: string; definition: string }[];
  commitmentLedger: {
    asserts: string[];
    rejects: string[];
    assumes: string[];
  };
  entities: string[];
  audienceParams?: string;
  rigorLevel?: string;
}

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
  k: string;       // key, e.g. "1.0", "1.1"
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

export interface AuditReport {
  verified: string[];
  contradicted: string[];
  unverifiable: string[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Compression threshold: tier 1 triggers at 150 nodes; deeper tiers scale down. */
const TIER_THRESHOLDS: Record<number, number> = {
  1: 150,
  2: 80,
  3: 50,
};
const DEFAULT_THRESHOLD = 40;

/** Nodes kept in source tier after compression. */
const POST_COMPRESS_KEEP = 30;

/**
 * ANTI_SYCOPHANCY_CLAUSES — appears verbatim in:
 *   1. The chunk / message processing prompt
 *   2. The Tier-1 delta extraction prompt
 *   3. The compression prompt
 */
const ANTI_SYCOPHANCY_CLAUSES = `ANTI_SYCOPHANCY_CLAUSES:
- Preserve every REJECTS entry verbatim. Do not soften, qualify, or convert a REJECTS into an OPEN.
- Preserve every numerical value, date, proper name, citation, and quoted phrase exactly as it appears.
- If two entries contradict, do not silently merge them. Emit a CONFLICT_FLAG entry that quotes both.
- Defeats, negative results, and counterexamples are load-bearing. They cost more to preserve than positive claims. Preserve them anyway.
- You are not being graded on smoothness, harmony, or readability. You are being graded on whether the tier you emit can be used to detect a hallucination two chunks from now.`;

// ── Helpers ────────────────────────────────────────────────────────────────────

function treeNodes(tier: Tier): TreeNode[] {
  return tier.tree?.nodes ?? [];
}

function isLoadBearing(tag: NodeTag): boolean {
  return tag === "REJECTS" || tag === "CONFLICT_FLAG";
}

/** Render a node array to the flat key:value format for LLM prompts. */
function renderNodes(nodes: TreeNode[]): string {
  return nodes.map((n) => `${n.k}: ${n.tag}: ${n.text}`).join("\n");
}

/** Generate sequential keys for new delta nodes within a tier. */
function generateKeys(existingNodes: TreeNode[], newCount: number): string[] {
  const maxNum = existingNodes.reduce((max, n) => {
    const num = parseFloat(n.k);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0);
  return Array.from({ length: newCount }, (_, i) =>
    (Math.floor(maxNum) + 1 + i).toFixed(1),
  );
}

/** Load all tiers for a job, sorted by tier number ascending. */
export async function loadAllTiers(jobId: string, jobType: string): Promise<Tier[]> {
  const rows = await db
    .select()
    .from(tractatusTiersTable)
    .where(
      and(
        eq(tractatusTiersTable.jobId, jobId),
        eq(tractatusTiersTable.jobType, jobType),
      ),
    )
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
    .where(
      and(
        eq(tractatusTiersTable.jobId, jobId),
        eq(tractatusTiersTable.jobType, jobType),
        eq(tractatusTiersTable.tier, tierNum),
      ),
    )
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

// ── Archive ────────────────────────────────────────────────────────────────────

async function archiveTier(
  jobId: string,
  jobType: string,
  tier: Tier,
  reason: "pre_compression" | "pre_repair" | "manual_audit",
): Promise<void> {
  await db.insert(tractatusArchiveTable).values({
    id: randomUUID(),
    jobId,
    jobType,
    tier: tier.tier,
    treeSnapshot: tier.tree as Record<string, unknown>,
    nodeCountAtSnapshot: tier.nodeCount,
    reason,
  });
}

// ── Core API ───────────────────────────────────────────────────────────────────

/**
 * Store a Skeleton as the immutable Tier 0 for a job.
 * No-op if Tier 0 already exists (Tier 0 is immutable for the lifetime of the job).
 */
export async function skeletonToTier0(
  skeleton: Skeleton,
  jobId: string,
  jobType: string,
): Promise<void> {
  const existing = await getTier(jobId, jobType, 0);
  if (existing) return; // Tier 0 is immutable

  const nodes: TreeNode[] = [];
  let counter = 1;

  const addNode = (tag: NodeTag, text: string) => {
    nodes.push({ k: `${counter}.0`, tag, text });
    counter++;
  };

  // Thesis
  addNode("ASSERTS", `[THESIS] ${skeleton.thesis}`);

  // Outline arcs
  for (const item of skeleton.outline) {
    addNode("ASSERTS", `[ARC] ${item}`);
  }

  // Key terms
  for (const kt of skeleton.keyTerms) {
    addNode("KEY_TERM", `"${kt.term}" = ${kt.definition}`);
  }

  // Commitment ledger — asserts
  for (const a of skeleton.commitmentLedger.asserts) {
    addNode("ASSERTS", a);
  }

  // Commitment ledger — rejects (load-bearing, never dropped)
  for (const r of skeleton.commitmentLedger.rejects) {
    addNode("REJECTS", r);
  }

  // Commitment ledger — assumes
  for (const a of skeleton.commitmentLedger.assumes) {
    addNode("ASSUMES", a);
  }

  // Entities
  for (const e of skeleton.entities) {
    addNode("ENTITY", e);
  }

  // Audience / rigor metadata
  if (skeleton.audienceParams) addNode("ASSUMES", `[AUDIENCE] ${skeleton.audienceParams}`);
  if (skeleton.rigorLevel) addNode("ASSUMES", `[RIGOR] ${skeleton.rigorLevel}`);

  await db.insert(tractatusTiersTable).values({
    id: randomUUID(),
    jobId,
    jobType,
    tier: 0,
    tree: { nodes } as unknown as Record<string, unknown>,
    nodeCount: nodes.length,
    compressionCount: 0,
  });
}

/**
 * Append delta nodes to Tier 1 (live tier).
 * Creates Tier 1 if it does not exist.
 * Triggers compression if node count exceeds threshold.
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
  const newNodes: TreeNode[] = delta.map((d, i) => ({
    k: keys[i],
    tag: d.tag,
    text: d.text,
  }));
  const allNodes = [...currentNodes, ...newNodes];
  const nodeCount = allNodes.length;

  if (existing) {
    await db
      .update(tractatusTiersTable)
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
    }
  }

  return { nodeCount, compressed };
}

/**
 * Compress sourceTier into sourceTier+1 using Claude.
 * Always archives first. Aborts if archive fails.
 * After compression, trims source tier to its 30 most recent nodes
 * (REJECTS and CONFLICT_FLAG are never trimmed).
 */
export async function compressTier(
  jobId: string,
  jobType: string,
  sourceTier: number,
): Promise<void> {
  const tier = await getTier(jobId, jobType, sourceTier);
  if (!tier) throw new Error(`compressTier: Tier ${sourceTier} not found for job ${jobId}`);

  // Archive first — abort if this fails
  await archiveTier(jobId, jobType, tier, "pre_compression");

  const flatSource = renderNodes(treeNodes(tier));

  const compressionPrompt = `You are compressing a Tractatus memory tier. Synthesize the nodes below into a smaller, coherent set of nodes that preserves all essential knowledge.

${ANTI_SYCOPHANCY_CLAUSES}

SOURCE TIER ${sourceTier} NODES:
${flatSource}

OUTPUT REQUIREMENTS:
- Return ONLY a JSON array of objects: [{"tag":"ASSERTS","text":"..."},...]
- Allowed tags: ASSERTS, REJECTS, ASSUMES, OPEN, KEY_TERM, ENTITY, CROSS_REF, CONFLICT_FLAG
- Preserve 100% of REJECTS and CONFLICT_FLAG entries verbatim
- Preserve all dates, proper names, numerical values exactly
- Merge or summarize ASSERTS and ASSUMES intelligently
- Output no prose, no explanation — only the JSON array`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: compressionPrompt }],
  });

  const raw = response.content[0]?.type === "text" ? response.content[0].text : "";

  let compressedDelta: DeltaNode[] = [];
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      compressedDelta = JSON.parse(jsonMatch[0]) as DeltaNode[];
    }
  } catch {
    throw new Error(`compressTier: Failed to parse Claude compression output: ${raw.slice(0, 200)}`);
  }

  // Verify REJECTS preservation — abort if any are missing
  const sourceRejects = treeNodes(tier).filter((n) => n.tag === "REJECTS").map((n) => n.text);
  const compressedRejects = compressedDelta.filter((d) => d.tag === "REJECTS").map((d) => d.text);
  for (const r of sourceRejects) {
    if (!compressedRejects.some((cr) => cr.trim() === r.trim())) {
      // Force include any missing REJECTS
      compressedDelta.push({ tag: "REJECTS", text: r });
    }
  }

  // Also preserve CONFLICT_FLAGs
  const sourceConflicts = treeNodes(tier).filter((n) => n.tag === "CONFLICT_FLAG").map((n) => n.text);
  const compressedConflicts = compressedDelta.filter((d) => d.tag === "CONFLICT_FLAG").map((d) => d.text);
  for (const c of sourceConflicts) {
    if (!compressedConflicts.some((cc) => cc.trim() === c.trim())) {
      compressedDelta.push({ tag: "CONFLICT_FLAG", text: c });
    }
  }

  // Build compressed tier nodes
  const compressedNodes: TreeNode[] = compressedDelta.map((d, i) => ({
    k: `${i + 1}.0`,
    tag: d.tag,
    text: d.text,
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
    await db
      .update(tractatusTiersTable)
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

  // Trim source tier: keep load-bearing nodes + most recent non-load-bearing up to POST_COMPRESS_KEEP
  const sourceNodes = treeNodes(tier);
  const loadBearing = sourceNodes.filter((n) => isLoadBearing(n.tag));
  const trimable = sourceNodes.filter((n) => !isLoadBearing(n.tag));
  const kept = trimable.slice(-Math.max(0, POST_COMPRESS_KEEP - loadBearing.length));
  const trimmed = [...loadBearing, ...kept];

  await db
    .update(tractatusTiersTable)
    .set({
      tree: { nodes: trimmed } as unknown as Record<string, unknown>,
      nodeCount: trimmed.length,
      lastUpdate: new Date(),
    })
    .where(eq(tractatusTiersTable.id, tier.id));

  // Recursively compress higher tier if it also exceeds threshold
  const destTierRow = await getTier(jobId, jobType, destTier);
  const destThreshold = TIER_THRESHOLDS[destTier] ?? DEFAULT_THRESHOLD;
  if (destTierRow && destTierRow.nodeCount >= destThreshold) {
    await compressTier(jobId, jobType, destTier);
  }
}

/**
 * Build the tiered prompt context string for injection into the system prompt.
 * Total budget: ≤ 15 000 characters.
 * Tier budgets: T0=6000, T1=5000, T2=2500, T3+=1500 total.
 * REJECTS and CONFLICT_FLAG are never truncated even if budget is exceeded.
 */
export async function buildTieredPromptContext(
  jobId: string,
  jobType: string,
): Promise<string> {
  const tiers = await loadAllTiers(jobId, jobType);
  if (!tiers.length) return "";

  const BUDGETS: Record<number, number> = { 0: 6000, 1: 5000, 2: 2500 };
  const BUDGET_3PLUS = 1500;

  const parts: string[] = [];

  // Group tiers 3+ together
  const tier3Plus = tiers.filter((t) => t.tier >= 3);

  for (const t of tiers.filter((t) => t.tier <= 2)) {
    const budget = BUDGETS[t.tier] ?? 2500;
    const nodes = treeNodes(t);
    const loadBearingNodes = nodes.filter((n) => isLoadBearing(n.tag));
    const normalNodes = nodes.filter((n) => !isLoadBearing(n.tag));

    // For T1 (live), show newest first by reversing
    const orderedNormal = t.tier === 1 ? [...normalNodes].reverse() : normalNodes;

    let text = "";
    let overBudget = false;

    // Always include load-bearing nodes
    const lbText = renderNodes(loadBearingNodes);

    // Fill remaining budget with normal nodes
    let remaining = budget - lbText.length - 30; // 30 chars for headers
    const normalLines: string[] = [];
    for (const n of orderedNormal) {
      const line = `${n.k}: ${n.tag}: ${n.text}`;
      if (remaining - line.length < 0) {
        overBudget = true;
        break;
      }
      normalLines.push(line);
      remaining -= line.length + 1;
    }

    const allLines = [...normalLines, ...loadBearingNodes.map((n) => `${n.k}: ${n.tag}: ${n.text}`)];
    text = allLines.join("\n");

    if (text.trim()) {
      const label = t.tier === 0
        ? "TIER 0 — SKELETON (immutable, authoritative)"
        : t.tier === 1
        ? "TIER 1 — LIVE MEMORY (recent, newest first)"
        : `TIER ${t.tier} — COMPRESSED`;
      parts.push(`=== ${label} ===\n${text}`);
      if (overBudget) {
        console.warn(`[tractatusMemory] buildTieredPromptContext: T${t.tier} exceeded budget for job ${jobId}`);
      }
    }
  }

  if (tier3Plus.length) {
    const allT3Nodes = tier3Plus.flatMap((t) => treeNodes(t));
    const lbNodes = allT3Nodes.filter((n) => isLoadBearing(n.tag));
    const normalNodes = allT3Nodes.filter((n) => !isLoadBearing(n.tag));
    let remaining = BUDGET_3PLUS - renderNodes(lbNodes).length;
    const normalLines: string[] = [];
    for (const n of normalNodes) {
      const line = `${n.k}: ${n.tag}: ${n.text}`;
      if (remaining - line.length < 0) break;
      normalLines.push(line);
      remaining -= line.length + 1;
    }
    const t3Text = [...normalLines, ...lbNodes.map((n) => `${n.k}: ${n.tag}: ${n.text}`)].join("\n");
    if (t3Text.trim()) {
      parts.push(`=== TIER 3+ — DEEP COMPRESSED ===\n${t3Text}`);
    }
  }

  return parts.join("\n\n");
}

/**
 * Audit a text string against the current Tractatus memory.
 * Returns structured report of verified, contradicted, and unverifiable claims.
 */
export async function auditAgainstMemory(
  text: string,
  jobId: string,
  jobType: string,
): Promise<AuditReport> {
  const memoryContext = await buildTieredPromptContext(jobId, jobType);

  if (!memoryContext) {
    return {
      verified: [],
      contradicted: [],
      unverifiable: ["No Tractatus memory exists yet for this job."],
    };
  }

  const auditPrompt = `You are auditing a text against a Tractatus memory store.

TRACTATUS MEMORY:
${memoryContext}

TEXT TO AUDIT:
${text}

For each factual claim in the TEXT, classify it as:
- VERIFIED: directly supported by a memory node
- CONTRADICTED: directly contradicted by a memory node (quote the node)
- UNVERIFIABLE: cannot be confirmed or denied from the memory

${ANTI_SYCOPHANCY_CLAUSES}

Return ONLY JSON in this format:
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
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as AuditReport;
    }
  } catch { /* fall through */ }

  return {
    verified: [],
    contradicted: [],
    unverifiable: ["Audit parsing failed. Raw output: " + raw.slice(0, 300)],
  };
}

/**
 * Extract a Skeleton from the user's current state + recent messages.
 * Called only when Tier 0 does not yet exist.
 */
export async function extractUserSkeleton(
  userId: string,
  currentState: {
    tasks?: Array<{ title: string; notes?: string | null; timeframe?: string }>;
    rules?: Array<{ text: string }>;
    journal?: Array<{ content?: string; text?: string }>;
  },
  recentMessages: Array<{ role: string; content: string }>,
): Promise<Skeleton> {
  const taskSummary = (currentState.tasks ?? [])
    .slice(0, 40)
    .map((t) => `- ${t.title}${t.notes ? `: ${t.notes.slice(0, 100)}` : ""}`)
    .join("\n");

  const rulesSummary = (currentState.rules ?? [])
    .map((r) => `- ${r.text}`)
    .join("\n");

  const journalSummary = (currentState.journal ?? [])
    .slice(0, 10)
    .map((j) => (j.content ?? j.text ?? "").slice(0, 200))
    .join("\n---\n");

  const msgSummary = recentMessages
    .slice(-20)
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 300)}`)
    .join("\n");

  const skeletonPrompt = `You are extracting a Tractatus Skeleton from a user's goal tracker data and recent AI conversations. The skeleton is the immutable foundation of their memory system.

USER TASKS:
${taskSummary || "(none)"}

STANDING RULES:
${rulesSummary || "(none)"}

JOURNAL:
${journalSummary || "(none)"}

RECENT CONVERSATION:
${msgSummary || "(none)"}

Extract a Skeleton JSON object. Be precise and concrete — no generalities.

Return ONLY valid JSON matching this exact structure:
{
  "thesis": "1-3 sentences: the user's core life/goal commitment based on their data",
  "outline": ["8-20 high-level goal/project arcs observed in their data"],
  "keyTerms": [{"term": "...", "definition": "..."}],
  "commitmentLedger": {
    "asserts": ["concrete things they affirm or pursue"],
    "rejects": ["things they explicitly reject, avoid, or oppose"],
    "assumes": ["load-bearing assumptions underlying their goals"]
  },
  "entities": ["Name/Institution — role/relationship"],
  "audienceParams": "who this user is writing/working for, if evident",
  "rigorLevel": "the level of rigor/standards they hold themselves to"
}

Output ONLY the JSON. No prose. No explanation. Max 2000 output tokens.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: skeletonPrompt }],
  });

  const raw = response.content[0]?.type === "text" ? response.content[0].text : "{}";

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as Skeleton;
    }
  } catch { /* fall through */ }

  // Minimal fallback skeleton
  return {
    thesis: "User is tracking goals and engaging in ongoing work.",
    outline: ["Goal tracking", "Productivity"],
    keyTerms: [],
    commitmentLedger: { asserts: [], rejects: [], assumes: [] },
    entities: [],
  };
}

/**
 * Extract a delta from a user message + assistant reply pair.
 * Returns delta nodes to be written into Tier 1.
 */
export async function extractDeltaFromTurn(
  userMessage: string,
  assistantReply: string,
  jobId: string,
  jobType: string,
): Promise<DeltaNode[]> {
  // Load tier 0 for context
  const tier0 = await getTier(jobId, jobType, 0);
  const memoryHint = tier0
    ? `EXISTING TIER 0 SKELETON (for context):\n${renderNodes(treeNodes(tier0).slice(0, 20))}`
    : "";

  const deltaPrompt = `You are extracting a delta update for a Tractatus memory tier from one conversation turn.

${memoryHint}

USER MESSAGE:
${userMessage.slice(0, 2000)}

ASSISTANT REPLY:
${assistantReply.slice(0, 3000)}

${ANTI_SYCOPHANCY_CLAUSES}

Extract ONLY genuinely new or updated facts, commitments, entities, and open questions that are worth persisting across sessions. Do not extract obvious, generic, or already-known information.

Return ONLY a JSON array:
[{"tag":"ASSERTS","text":"..."}, {"tag":"REJECTS","text":"..."}, ...]

Allowed tags: ASSERTS, REJECTS, ASSUMES, OPEN, KEY_TERM, ENTITY, CROSS_REF, CONFLICT_FLAG
If nothing new and durable emerged from this turn, return an empty array: []
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
      // Validate structure
      return parsed.filter(
        (d) =>
          typeof d.tag === "string" &&
          typeof d.text === "string" &&
          d.text.trim().length > 0,
      );
    }
  } catch { /* fall through */ }

  return [];
}
