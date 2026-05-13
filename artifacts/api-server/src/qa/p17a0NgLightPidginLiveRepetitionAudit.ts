/**
 * P17-A0 — NG light_pidgin live repetition audit.
 *
 * Audit-only. Drives the REAL `POST /api/ideator/generate` route on the
 * running api-server (port 8080) for 10 consecutive batches × 5 ideas
 * against the seeded demo creator (the row `resolveCreator` falls back
 * to when no Clerk session is present), with body
 * `{region:"nigeria", languageStyle:"light_pidgin", count:5,
 * regenerate:i>0}`. Memory is reset ONCE at the start; 10 batches share
 * one growing `nigerian_pack_seen_entry_ids_json` column.
 *
 * Diagnoses whether the user-visible repetition is:
 *   • within-batch (entryIds/hooks duplicated inside one batch of 5)
 *   • across-batch (same entryIds shipped on consecutive regenerates)
 *   • repeated anchors / domains
 *   • memory not being read/written
 *   • or score-collapse despite memory
 *
 * Run (api-server workflow must be up):
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/qa/p17a0NgLightPidginLiveRepetitionAudit.ts
 *
 * Writes:
 *   .local/P17_A0_NG_LIGHT_PIDGIN_LIVE_REPETITION_AUDIT.md
 *   .local/P17_A0_NG_LIGHT_PIDGIN_LIVE_REPETITION_AUDIT.json
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import {
  NIGERIAN_HOOK_PACK,
  type NigerianPackEntry,
} from "../lib/nigerianHookPack.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.resolve(__dirname, "..", "..", "..", "..", ".local");
fs.mkdirSync(OUT_DIR, { recursive: true });

const API_URL =
  process.env.P17_LIVE_API_URL ?? "http://localhost:8080/api/ideator/generate";
const PER_BATCH_TIMEOUT_MS = 75_000;
const N_BATCHES = 10;
const COUNT = 5;

// ---------- pack id derivation (mirrors nigerianPackAuthor.ts djb2) ---
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}
const packEntryIdFor = (hook: string, anchor: string) =>
  `ng_${djb2(`${hook}|${anchor}`).toString(16)}`;
const PACK_BY_ID = new Map<string, NigerianPackEntry>();
for (const e of NIGERIAN_HOOK_PACK) PACK_BY_ID.set(packEntryIdFor(e.hook, e.anchor), e);

// ---------- response shape ---------------------------------------------
type QaPerIdea = {
  source?: string;
  nigerianPackEntryId?: string;
  hookQualityScore?: number;
  anchor?: string;
  premiseCoreId?: string;
};
type GenResp = {
  region: string;
  count: number;
  regenerate: boolean;
  ideas: Array<{ hook: string; whatToShow: string; caption: string; anchor?: string }>;
  qaTelemetry?: { perIdea: QaPerIdea[]; fallbackDecision?: { needFallback: boolean; reason: string } };
  usedFallback?: boolean;
  counts?: { localKept: number; fallbackKept: number };
};

// ---------- helpers ----------------------------------------------------
async function getDemoCreatorId(): Promise<string> {
  const row = (
    await db.select({ id: schema.creators.id }).from(schema.creators).where(eq(schema.creators.isDemo, true)).limit(1)
  )[0];
  if (!row) throw new Error("no is_demo=true creator row found");
  return row.id;
}

type SeenEntry = { entryId: string; lastSeenAt: string };
async function readPackMemory(creatorId: string): Promise<SeenEntry[]> {
  const row = (
    await db
      .select({ memory: schema.creators.nigerianPackSeenEntryIdsJson })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1)
  )[0];
  const raw = row?.memory;
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((x): x is SeenEntry => typeof x === "object" && x !== null && "entryId" in x);
}
async function resetPackMemory(creatorId: string): Promise<void> {
  await db
    .update(schema.creators)
    .set({ nigerianPackSeenEntryIdsJson: [], catalogTemplateSeenIdsJson: [], lastIdeaBatchJson: null, lastIdeaBatchDate: null })
    .where(eq(schema.creators.id, creatorId));
}

async function callApi(args: {
  count: number;
  regenerate: boolean;
  excludeHooks: string[];
}) {
  const body: Record<string, unknown> = {
    region: "nigeria",
    languageStyle: "light_pidgin",
    count: args.count,
    regenerate: args.regenerate,
  };
  if (args.excludeHooks.length > 0) body.excludeHooks = args.excludeHooks.slice(0, 20);
  const t0 = Date.now();
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lumina-qa-expose-meta": "1" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PER_BATCH_TIMEOUT_MS),
    });
    const durationMs = Date.now() - t0;
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return { resp: null as GenResp | null, status: r.status, durationMs, err: `HTTP ${r.status}: ${text.slice(0, 200)}` };
    }
    return { resp: (await r.json()) as GenResp, status: r.status, durationMs, err: null as string | null };
  } catch (e) {
    return { resp: null as GenResp | null, status: 0, durationMs: Date.now() - t0, err: String((e as Error).message ?? e) };
  }
}

// ---------- per-batch capture ------------------------------------------
type CardRec = {
  batchIdx: number;
  positionInBatch: number;
  hook: string;
  anchor: string | null;
  domain: string | null;
  premiseCoreId: string | null;
  source: string | null;
  nigerianPackEntryId: string | null;
  isPackEntry: boolean;
  hookQualityScore: number | null;
  inMemoryBeforeGeneration: boolean;
};
type BatchRec = {
  batchIdx: number;
  isRefresh: boolean;
  status: number;
  durationMs: number;
  errored: boolean;
  errorMsg: string | null;
  ideaCount: number;
  underfill: boolean;
  usedFallback: boolean | null;
  fallbackReason: string | null;
  packMemoryBefore: string[]; // entryIds, most-recent first
  packMemoryAfter: string[];
  packMemoryGrew: number; // after.size - before.size
  packShippedCount: number; // cards with non-null entryId
  inBatchDupEntryIds: string[];
  inBatchDupHooks: string[];
  inBatchDupAnchors: string[];
  inBatchDupDomains: string[];
  overlapWithImmediatelyPrev: string[]; // entryIds shared with batchIdx-1
  overlapWithAllPrev: string[]; // entryIds shared with any prior batch
  shippedEntryIdsAlreadyInMemoryBefore: string[];
};

const STATE_FILE = path.join(OUT_DIR, "_p17a0_partial.json");

type PartialState = {
  creatorId: string;
  batches: BatchRec[];
  cards: CardRec[];
  lastHooks: string[];
  allPriorEntryIds: string[];
  prevEntryIds: string[];
};

async function main() {
  let creatorId: string;
  let batches: BatchRec[] = [];
  let cards: CardRec[] = [];
  let lastHooks: string[] = [];
  let allPriorEntryIds = new Set<string>();
  let prevEntryIds = new Set<string>();
  const startBatch = Number(process.env.P17_START_BATCH ?? "0");
  const stopBatch = Number(process.env.P17_STOP_BATCH ?? String(N_BATCHES));

  if (startBatch === 0) {
    creatorId = await getDemoCreatorId();
    console.log(`[p17a0] using demo creator id=${creatorId}`);
    await resetPackMemory(creatorId);
    console.log(`[p17a0] reset pack memory to []`);
  } else if (fs.existsSync(STATE_FILE)) {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as PartialState;
    creatorId = s.creatorId;
    batches = s.batches;
    cards = s.cards;
    lastHooks = s.lastHooks;
    allPriorEntryIds = new Set(s.allPriorEntryIds);
    prevEntryIds = new Set(s.prevEntryIds);
    console.log(`[p17a0] resumed from ${STATE_FILE} priorBatches=${batches.length} priorCards=${cards.length}`);
  } else {
    throw new Error(`startBatch=${startBatch} but no state file at ${STATE_FILE}`);
  }

  for (let batchIdx = startBatch; batchIdx < stopBatch; batchIdx++) {
    const memBefore = await readPackMemory(creatorId);
    const memBeforeIds = memBefore.map((m) => m.entryId);
    const memBeforeSet = new Set(memBeforeIds);

    const isRefresh = batchIdx > 0;
    const r = await callApi({ count: COUNT, regenerate: isRefresh, excludeHooks: lastHooks });

    const memAfter = await readPackMemory(creatorId);
    const memAfterIds = memAfter.map((m) => m.entryId);

    const ideaCount = r.resp?.ideas.length ?? 0;
    const thisBatchEntryIds: string[] = [];
    const thisBatchHooks: string[] = [];
    const thisBatchAnchors: string[] = [];
    const thisBatchDomains: string[] = [];

    if (r.resp) {
      for (let i = 0; i < r.resp.ideas.length; i++) {
        const idea = r.resp.ideas[i];
        const qa = r.resp.qaTelemetry?.perIdea?.[i];
        const packId = qa?.nigerianPackEntryId ?? null;
        const packEntry = packId !== null ? (PACK_BY_ID.get(packId) ?? null) : null;
        const anchor = qa?.anchor ?? idea.anchor ?? packEntry?.anchor ?? null;
        const domain = packEntry?.domain ?? null;
        cards.push({
          batchIdx,
          positionInBatch: i,
          hook: idea.hook,
          anchor,
          domain,
          premiseCoreId: qa?.premiseCoreId ?? null,
          source: qa?.source ?? null,
          nigerianPackEntryId: packId,
          isPackEntry: packEntry !== null,
          hookQualityScore: qa?.hookQualityScore ?? null,
          inMemoryBeforeGeneration: packId !== null && memBeforeSet.has(packId),
        });
        if (packId !== null) thisBatchEntryIds.push(packId);
        thisBatchHooks.push(idea.hook);
        if (anchor) thisBatchAnchors.push(anchor);
        if (domain) thisBatchDomains.push(domain);
      }
      lastHooks = r.resp.ideas.map((x) => x.hook);
    } else {
      lastHooks = [];
    }

    // dup helpers
    const dups = <T,>(arr: T[]): T[] => {
      const seen = new Set<T>();
      const dup = new Set<T>();
      for (const x of arr) {
        if (seen.has(x)) dup.add(x);
        else seen.add(x);
      }
      return [...dup];
    };
    const inBatchDupEntryIds = dups(thisBatchEntryIds);
    const inBatchDupHooks = dups(thisBatchHooks);
    const inBatchDupAnchors = dups(thisBatchAnchors);
    const inBatchDupDomains = dups(thisBatchDomains);
    const thisBatchEntryIdSet = new Set(thisBatchEntryIds);
    const overlapPrev = [...thisBatchEntryIdSet].filter((id) => prevEntryIds.has(id));
    const overlapAll = [...thisBatchEntryIdSet].filter((id) => allPriorEntryIds.has(id));
    const alreadySeen = thisBatchEntryIds.filter((id) => memBeforeSet.has(id));

    batches.push({
      batchIdx,
      isRefresh,
      status: r.status,
      durationMs: r.durationMs,
      errored: r.err !== null,
      errorMsg: r.err,
      ideaCount,
      underfill: r.status === 200 && ideaCount < COUNT,
      usedFallback: r.resp?.usedFallback ?? null,
      fallbackReason: r.resp?.qaTelemetry?.fallbackDecision?.reason ?? null,
      packMemoryBefore: memBeforeIds,
      packMemoryAfter: memAfterIds,
      packMemoryGrew: memAfterIds.length - memBeforeIds.length,
      packShippedCount: thisBatchEntryIds.length,
      inBatchDupEntryIds,
      inBatchDupHooks,
      inBatchDupAnchors,
      inBatchDupDomains,
      overlapWithImmediatelyPrev: overlapPrev,
      overlapWithAllPrev: overlapAll,
      shippedEntryIdsAlreadyInMemoryBefore: alreadySeen,
    });

    for (const id of thisBatchEntryIds) allPriorEntryIds.add(id);
    prevEntryIds = thisBatchEntryIdSet;

    // Persist state after every batch so the run can resume across
    // bash-tool invocations (background processes get reaped when the
    // tool returns).
    const partial: PartialState = {
      creatorId,
      batches,
      cards,
      lastHooks,
      allPriorEntryIds: [...allPriorEntryIds],
      prevEntryIds: [...prevEntryIds],
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(partial));

    console.log(
      `[p17a0] batch=${batchIdx + 1}/${N_BATCHES} regen=${isRefresh} status=${r.status} ms=${r.durationMs} ideas=${ideaCount} pack=${thisBatchEntryIds.length}/${COUNT} fb=${r.resp?.usedFallback ?? "?"} memBefore=${memBeforeIds.length} memAfter=${memAfterIds.length} grew=${memAfterIds.length - memBeforeIds.length} dupE=${inBatchDupEntryIds.length} dupH=${inBatchDupHooks.length} olapPrev=${overlapPrev.length} olapAll=${overlapAll.length}${r.err ? ` err=${r.err.slice(0, 80)}` : ""}`,
    );
  }

  if (stopBatch < N_BATCHES) {
    console.log(`[p17a0] partial run complete; resume with P17_START_BATCH=${stopBatch}`);
    return;
  }

  // ---------- aggregate ------------------------------------------------
  const allShippedEntryIds = cards.map((c) => c.nigerianPackEntryId).filter((x): x is string => x !== null);
  const distinctShipped = new Set(allShippedEntryIds).size;
  const totalShipped = allShippedEntryIds.length;

  const entryIdCounts = new Map<string, number>();
  for (const id of allShippedEntryIds) entryIdCounts.set(id, (entryIdCounts.get(id) ?? 0) + 1);
  const topEntryIds = [...entryIdCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const allAnchors = cards.map((c) => c.anchor).filter((x): x is string => x !== null);
  const anchorCounts = new Map<string, number>();
  for (const a of allAnchors) anchorCounts.set(a, (anchorCounts.get(a) ?? 0) + 1);
  const topAnchors = [...anchorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const allDomains = cards.map((c) => c.domain).filter((x): x is string => x !== null);
  const domainCounts = new Map<string, number>();
  for (const d of allDomains) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  const topDomains = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);

  const memoryGrowthPerBatch = batches.map((b) => b.packMemoryGrew);
  const totalCardsAlreadyInMemBefore = cards.filter((c) => c.inMemoryBeforeGeneration).length;
  const totalAcrossBatchOverlap = batches.slice(1).reduce((s, b) => s + b.overlapWithImmediatelyPrev.length, 0);
  const totalAllPriorOverlap = batches.slice(1).reduce((s, b) => s + b.overlapWithAllPrev.length, 0);
  const totalInBatchDupEntryIds = batches.reduce((s, b) => s + b.inBatchDupEntryIds.length, 0);
  const totalInBatchDupHooks = batches.reduce((s, b) => s + b.inBatchDupHooks.length, 0);
  const totalInBatchDupAnchors = batches.reduce((s, b) => s + b.inBatchDupAnchors.length, 0);

  // ---------- decide PASS / HOLD / FAIL --------------------------------
  const errored = batches.some((b) => b.errored);
  const anyUnderfill = batches.some((b) => b.underfill);
  const anyFallback = batches.some((b) => b.usedFallback === true);
  const anyNonNgPack = cards.some((c) => c.isPackEntry === false && c.source !== null && c.source.includes("western"));
  const memoryNeverWrote = batches.every((b) => b.packMemoryGrew === 0);
  const cohortGateOk = !anyNonNgPack;
  const fivePackOk = batches.every((b) => b.packShippedCount === COUNT);
  const noFallback = !anyFallback;

  let recommendation: "PASS" | "HOLD" | "FAIL";
  const failReasons: string[] = [];
  if (errored) failReasons.push("one or more batches errored");
  if (!cohortGateOk) failReasons.push("non-NG pack source observed (cohort gate broken)");
  if (!fivePackOk) failReasons.push("5/5 NG pack output broken on at least one batch");
  if (anyFallback) failReasons.push("Claude fallback fired");
  if (memoryNeverWrote) failReasons.push("pack memory never grew across 10 batches");
  if (failReasons.length > 0) recommendation = "FAIL";
  else recommendation = "PASS";

  // diagnostic next-step suggestion
  const acrossBatchPressure = totalAllPriorOverlap;
  const withinBatchPressure = totalInBatchDupEntryIds + totalInBatchDupHooks;
  const memoryWorking = !memoryNeverWrote && totalCardsAlreadyInMemBefore < totalShipped * 0.25;
  let nextImpl = "";
  if (!memoryWorking) {
    nextImpl = "memory_suppression_fix — pack memory write or read appears broken / weakly enforced";
  } else if (acrossBatchPressure > withinBatchPressure * 2) {
    nextImpl = "combined_memory_first_diversity_picker — across-batch pressure dominates; cross-core diversity selection consulting memory snapshot";
  } else if (withinBatchPressure > 0) {
    nextImpl = "final_pack_diversity_picker — within-batch duplicates present; selection-stage diversity pass";
  } else if (acrossBatchPressure === 0 && withinBatchPressure === 0) {
    nextImpl = "no_action — repetition not reproduced in this 10-batch window";
  } else {
    nextImpl = "final_pack_diversity_picker — modest cross-core concentration; selection-stage diversity pass with score-tie-break";
  }

  // ---------- emit JSON + Markdown -------------------------------------
  const json = {
    creatorId,
    nBatches: N_BATCHES,
    count: COUNT,
    region: "nigeria",
    languageStyle: "light_pidgin",
    flagsObserved: {
      LUMINA_NG_PACK_ENABLED: process.env.LUMINA_NG_PACK_ENABLED ?? "(api-server process env)",
      LUMINA_NG_PACK_AWARE_RETENTION_ENABLED: process.env.LUMINA_NG_PACK_AWARE_RETENTION_ENABLED ?? "(api-server process env)",
      LUMINA_NG_PACK_PROJECTION_T2_ENABLED: process.env.LUMINA_NG_PACK_PROJECTION_T2_ENABLED ?? "(api-server process env)",
    },
    summary: {
      totalShippedPackCards: totalShipped,
      distinctShippedEntryIds: distinctShipped,
      distinctRatio: totalShipped === 0 ? null : Math.round((distinctShipped / totalShipped) * 1000) / 1000,
      memoryGrowthPerBatch,
      totalCardsAlreadyInMemBefore,
      totalAcrossBatchOverlap_immediatelyPrev: totalAcrossBatchOverlap,
      totalAcrossBatchOverlap_allPrior: totalAllPriorOverlap,
      totalInBatchDupEntryIds,
      totalInBatchDupHooks,
      totalInBatchDupAnchors,
      anyError: errored,
      anyUnderfill,
      anyFallback,
      memoryNeverWrote,
      cohortGateOk,
      fivePackOk,
      noFallback,
      recommendation,
      failReasons,
      nextImpl,
    },
    topEntryIds,
    topAnchors,
    topDomains,
    batches,
    cards,
  };
  fs.writeFileSync(path.join(OUT_DIR, "P17_A0_NG_LIGHT_PIDGIN_LIVE_REPETITION_AUDIT.json"), JSON.stringify(json, null, 2));

  const md: string[] = [];
  md.push("# P17-A0 — NG light_pidgin live repetition audit");
  md.push("");
  md.push(`**Date:** ${new Date().toISOString().slice(0, 10)}`);
  md.push(`**Creator:** \`${creatorId}\` (demo, region overridden via body)`);
  md.push(`**Cohort:** region=nigeria, languageStyle=light_pidgin`);
  md.push(`**Sizing:** ${N_BATCHES} consecutive batches × ${COUNT} ideas (batch 0 normal, batches 1-${N_BATCHES - 1} regenerate=true)`);
  md.push(`**Memory:** reset ONCE at start; shared/accumulating across all 10 batches`);
  md.push("");
  md.push(`## TL;DR — recommendation: **${recommendation}**`);
  md.push("");
  if (failReasons.length > 0) {
    md.push(`**Fail reasons:**`);
    for (const r of failReasons) md.push(`- ${r}`);
    md.push("");
  }
  md.push(`**Next implementation suggested:** ${nextImpl}`);
  md.push("");
  md.push(`- shipped pack cards: ${totalShipped} / ${cards.length} (${cards.length === 0 ? 0 : Math.round((totalShipped / cards.length) * 100)}%)`);
  md.push(`- distinct shipped entryIds: ${distinctShipped} / ${totalShipped} (${totalShipped === 0 ? 0 : Math.round((distinctShipped / totalShipped) * 100)}% refresh)`);
  md.push(`- in-batch duplicate entryIds (sum across batches): ${totalInBatchDupEntryIds}`);
  md.push(`- in-batch duplicate hooks (sum across batches): ${totalInBatchDupHooks}`);
  md.push(`- in-batch duplicate anchors (sum across batches): ${totalInBatchDupAnchors}`);
  md.push(`- across-batch entryId overlap (vs immediately previous, summed): ${totalAcrossBatchOverlap}`);
  md.push(`- across-batch entryId overlap (vs all prior, summed): ${totalAllPriorOverlap}`);
  md.push(`- shipped entryIds that were ALREADY in memory before generation: ${totalCardsAlreadyInMemBefore} / ${totalShipped}`);
  md.push(`- memory grew per batch: [${memoryGrowthPerBatch.join(", ")}]`);
  md.push(`- any error: ${errored} | any underfill: ${anyUnderfill} | any fallback: ${anyFallback}`);
  md.push("");
  md.push(`## Answers to the 8 audit questions`);
  md.push("");
  md.push(`### Q1 — Are the 5 cards within each batch distinct by entryId and hook?`);
  md.push(`- distinct entryId in every batch: ${batches.every((b) => b.inBatchDupEntryIds.length === 0) ? "YES" : "NO"}`);
  md.push(`- distinct hook in every batch: ${batches.every((b) => b.inBatchDupHooks.length === 0) ? "YES" : "NO"}`);
  md.push(`- batches with in-batch entryId dup: ${batches.filter((b) => b.inBatchDupEntryIds.length > 0).map((b) => b.batchIdx).join(", ") || "(none)"}`);
  md.push(`- batches with in-batch hook dup: ${batches.filter((b) => b.inBatchDupHooks.length > 0).map((b) => b.batchIdx).join(", ") || "(none)"}`);
  md.push("");
  md.push(`### Q2 — Are the same entryIds repeating across regenerates?`);
  md.push(`- total cross-batch entryId overlap (vs all prior batches): ${totalAllPriorOverlap}`);
  md.push(`- distinct entryIds shipped: ${distinctShipped} / ${totalShipped} possible — ${totalShipped === 0 ? "n/a" : `${Math.round((distinctShipped / totalShipped) * 100)}% novelty`}`);
  md.push(`- top repeated entryIds (count across all 10 batches):`);
  md.push("");
  md.push(`| entryId | count | hook | anchor | domain |`);
  md.push(`|---|---|---|---|---|`);
  for (const [id, n] of topEntryIds) {
    const e = PACK_BY_ID.get(id);
    md.push(`| \`${id}\` | ${n} | ${e?.hook ?? "?"} | ${e?.anchor ?? "?"} | ${e?.domain ?? "?"} |`);
  }
  md.push("");
  md.push(`### Q3 — Are the same anchors/domains repeating across regenerates?`);
  md.push(`- top anchors (count across 50 cards):`);
  md.push("");
  md.push(`| anchor | count |`);
  md.push(`|---|---|`);
  for (const [a, n] of topAnchors) md.push(`| ${a} | ${n} |`);
  md.push("");
  md.push(`- domain distribution:`);
  md.push("");
  md.push(`| domain | count |`);
  md.push(`|---|---|`);
  for (const [d, n] of topDomains) md.push(`| ${d} | ${n} |`);
  md.push("");
  md.push(`### Q4 — Is recentNigerianPackEntryIds being read before selection?`);
  md.push(`The hoist site (\`hybridIdeator.ts\` L4263-4265) calls \`getRecentSeenEntryIds(creator.id)\` once per request whenever \`region===nigeria + languageStyle ∈ {pidgin,light_pidgin} + LUMINA_NG_PACK_ENABLED===true\`. We can't introspect the live process, but the pack-aware-retention path (gated on \`LUMINA_NG_PACK_AWARE_RETENTION_ENABLED\`) excludes those ids from top-K retention and the slot-reservation site uses the same Set as \`excludeEntryIds\`. Indirect proof: batch N+1's "shippedEntryIdsAlreadyInMemoryBefore" should drop near zero IF memory suppression is active.`);
  md.push("");
  md.push(`- shipped entryIds that were ALREADY in memory at generation time: ${totalCardsAlreadyInMemBefore} / ${totalShipped} (${totalShipped === 0 ? 0 : Math.round((totalCardsAlreadyInMemBefore / totalShipped) * 100)}%)`);
  md.push(`- per-batch breakdown:`);
  md.push("");
  md.push(`| batch | memBefore | memAfter | grew | shipped | alreadyInMem | overlapPrev | overlapAll |`);
  md.push(`|---|---|---|---|---|---|---|---|`);
  for (const b of batches) {
    md.push(`| ${b.batchIdx} | ${b.packMemoryBefore.length} | ${b.packMemoryAfter.length} | ${b.packMemoryGrew} | ${b.packShippedCount} | ${b.shippedEntryIdsAlreadyInMemoryBefore.length} | ${b.overlapWithImmediatelyPrev.length} | ${b.overlapWithAllPrev.length} |`);
  }
  md.push("");
  md.push(`### Q5 — Is pack_seen memory growing by about 5 after each successful batch?`);
  md.push(`- memory growth per batch: [${memoryGrowthPerBatch.join(", ")}]`);
  md.push(`- batches where memory grew by 5: ${batches.filter((b) => b.packMemoryGrew === 5).length} / ${N_BATCHES}`);
  md.push(`- batches where memory grew by 0: ${batches.filter((b) => b.packMemoryGrew === 0).length} / ${N_BATCHES}`);
  md.push("");
  md.push(`### Q6 — Are recently seen entries being suppressed or still winning?`);
  if (totalShipped > 0) {
    const pct = Math.round((totalCardsAlreadyInMemBefore / totalShipped) * 100);
    md.push(`- ${totalCardsAlreadyInMemBefore} / ${totalShipped} (${pct}%) shipped pack cards had their entryId in memory at generation time.`);
    if (pct < 10) md.push(`- → memory suppression appears **EFFECTIVE** (< 10% of shipped cards were already-seen).`);
    else if (pct < 33) md.push(`- → memory suppression appears **PARTIAL** (10-33% leak through).`);
    else md.push(`- → memory suppression appears **WEAK or BYPASSED** (≥ 33% of shipped cards were already-seen).`);
  }
  md.push("");
  md.push(`### Q7 — Is the issue within-batch diversity or across-batch memory/selection?`);
  md.push(`- within-batch pressure (dup entryIds + dup hooks across batches): ${withinBatchPressure}`);
  md.push(`- across-batch pressure (entryId overlap vs all prior): ${acrossBatchPressure}`);
  if (withinBatchPressure === 0 && acrossBatchPressure === 0) md.push(`- → **no repetition reproduced** in this 10-batch window.`);
  else if (acrossBatchPressure > withinBatchPressure * 2) md.push(`- → **across-batch dominates**. Same entryIds keep winning despite memory growing — memory snapshot is being read but the picker (or scorer) lets known-seen entries through.`);
  else if (withinBatchPressure > acrossBatchPressure * 2) md.push(`- → **within-batch dominates**. Slot reservation is letting duplicate entryIds/hooks into the same batch of 5.`);
  else md.push(`- → **mixed**. Both within-batch and across-batch repetition contribute.`);
  md.push("");
  md.push(`### Q8 — Which implementation should come next?`);
  md.push(`**${nextImpl}**`);
  md.push("");
  md.push(`Reasoning: ${memoryWorking ? "memory is being written (grew across batches) and < 25% of shipped cards were already-seen" : "memory is NOT being suppressed effectively — fix memory read/write before adding any picker"}, within-batch pressure = ${withinBatchPressure}, across-batch pressure = ${acrossBatchPressure}.`);
  md.push("");
  md.push(`## Per-batch detail`);
  md.push("");
  for (const b of batches) {
    md.push(`### Batch ${b.batchIdx} (${b.isRefresh ? "regenerate" : "normal"}) — status=${b.status}, ms=${b.durationMs}, ideas=${b.ideaCount}, fb=${b.usedFallback ?? "?"}${b.fallbackReason ? `/${b.fallbackReason}` : ""}`);
    md.push(`- packMemoryBefore (${b.packMemoryBefore.length}): \`${b.packMemoryBefore.slice(0, 12).join("`, `")}\`${b.packMemoryBefore.length > 12 ? ` ... +${b.packMemoryBefore.length - 12} more` : ""}`);
    md.push(`- packMemoryAfter (${b.packMemoryAfter.length}): \`${b.packMemoryAfter.slice(0, 12).join("`, `")}\`${b.packMemoryAfter.length > 12 ? ` ... +${b.packMemoryAfter.length - 12} more` : ""}`);
    md.push(`- in-batch dup entryIds: ${b.inBatchDupEntryIds.join(", ") || "(none)"} | dup hooks: ${b.inBatchDupHooks.length} | dup anchors: ${b.inBatchDupAnchors.join(", ") || "(none)"} | dup domains: ${b.inBatchDupDomains.join(", ") || "(none)"}`);
    md.push(`- overlap vs immediately previous: ${b.overlapWithImmediatelyPrev.join(", ") || "(none)"}`);
    md.push(`- overlap vs all prior: ${b.overlapWithAllPrev.join(", ") || "(none)"}`);
    md.push(`- shipped entryIds already in memory before generation: ${b.shippedEntryIdsAlreadyInMemoryBefore.join(", ") || "(none)"}`);
    md.push("");
    md.push(`| pos | hook | anchor | domain | entryId | source | score | inMemBefore? |`);
    md.push(`|---|---|---|---|---|---|---|---|`);
    for (const c of cards.filter((c) => c.batchIdx === b.batchIdx)) {
      md.push(`| ${c.positionInBatch} | ${c.hook.slice(0, 70)} | ${c.anchor ?? ""} | ${c.domain ?? ""} | \`${c.nigerianPackEntryId ?? "—"}\` | ${c.source ?? ""} | ${c.hookQualityScore ?? ""} | ${c.inMemoryBeforeGeneration ? "YES" : "no"} |`);
    }
    md.push("");
  }

  fs.writeFileSync(path.join(OUT_DIR, "P17_A0_NG_LIGHT_PIDGIN_LIVE_REPETITION_AUDIT.md"), md.join("\n"));
  console.log(`[p17a0] wrote ${path.join(OUT_DIR, "P17_A0_NG_LIGHT_PIDGIN_LIVE_REPETITION_AUDIT.md")}`);
  console.log(`[p17a0] wrote ${path.join(OUT_DIR, "P17_A0_NG_LIGHT_PIDGIN_LIVE_REPETITION_AUDIT.json")}`);
  console.log(`[p17a0] recommendation=${recommendation} nextImpl=${nextImpl}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
