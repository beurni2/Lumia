import { NIGERIAN_HOOK_PACK, type NigerianPackEntry } from "../lib/nigerianHookPack.js";
import { scoreNigerianPackEntryDetailed } from "../lib/nigerianHookQuality.js";
import * as fs from "node:fs";

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return h >>> 0;
}
function entryId(e: NigerianPackEntry): string {
  return `ng_${djb2(`${e.hook}|${e.anchor}`).toString(16)}`;
}

const probe = JSON.parse(
  fs.readFileSync(
    "/home/runner/workspace/.local/qa-runs/p12_t2_live_route_re_audit.json",
    "utf8",
  ),
);
const shippedIds = new Set<string>();
const shipCount = new Map<string, number>();
for (const idea of probe.perCohortIdeas.ng_light_pidgin) {
  if (idea.nigerianPackEntryId) {
    shippedIds.add(idea.nigerianPackEntryId);
    shipCount.set(
      idea.nigerianPackEntryId,
      (shipCount.get(idea.nigerianPackEntryId) || 0) + 1,
    );
  }
}

// Trusted scoring context — must be the live pack reference.
const ctx = { kind: "pool", pool: NIGERIAN_HOOK_PACK } as const;

const widened = NIGERIAN_HOOK_PACK.filter(
  (e) => e.domain === "everyday" || e.domain === "home",
);
const rows: any[] = [];
for (const e of widened) {
  const id = entryId(e);
  let score = 0,
    breakdown: any = {};
  try {
    const b = scoreNigerianPackEntryDetailed(e, ctx);
    score = b.total;
    breakdown = b;
  } catch (err: any) {
    score = -1;
    breakdown = { error: String(err?.message || err) };
  }
  rows.push({
    id,
    src: e.domain,
    anchor: e.anchor,
    level: e.pidginLevel,
    score,
    breakdown,
    hook: e.hook,
    shipCount: shipCount.get(id) || 0,
    shipped: shippedIds.has(id),
  });
}

// FOOD_V2 identification by hook membership (the curated 25)
const FOOD_V2_HOOKS = new Set<string>([
  "fridge light catch me but na water i dey pretend to find",
  "plate small but my hunger no get manners",
  "groceries full counter but who wan cook now",
  "oven beep and my confidence say abeg ask adult",
  "fridge empty but i still bend like food dey hide",
  "fork dey visit my side like rent is cheap",
  "pan hot already but my brain never resume",
  "fridge open and my diet plan just keep quiet",
  "plate nearly empty but i still dey explain small taste",
  "groceries for the week but the house hear today today",
  "oven timer shout but the food still dey learn work",
  "fridge make sound and i confess before anybody ask",
  "plate clean pass my story",
  "pan dey smell correct but taste no follow meeting",
  "fridge get leftover and the house enter court session",
  "plate reach sink and everybody memory just travel",
  "groceries dey counter since morning and i dey greet them like neighbor",
  "pan hear medium heat and still choose wahala",
  "oven dey preheat while i dey pre-confuse",
  "fridge opened for water but my hand carry evidence",
  "plate expose me because small taste no suppose reach corner",
  "fork dey innocent but best piece just disappear",
  "pan carry aroma but food no carry evidence",
  "plate dey wait since but cook keep saying almost done",
  "groceries start as plan and end as everybody sample",
]);

// Anchor → projection bucket (from PACK_DOMAIN_MAP + domain-specific
// coreDomainAnchorCatalog). For everyday, the T2 overlay projects onto
// home / mornings / sleep cores; we approximate the "edge" by inspecting
// anchor membership in the per-core catalogs.
const MORNINGS_ANCHORS = new Set([
  "alarm", "kettle", "mirror", "shower", "toothbrush", "towel",
  "shoes", "slippers", "bed", "reflection", "phone",
]);
const SLEEP_ANCHORS = new Set([
  "bed", "blanket", "pillow", "lamp", "alarm", "phone", "duvet",
]);
const FOOD_ANCHORS = new Set([
  "plate", "fridge", "fork", "groceries", "oven", "pan",
  "spoon", "kettle", "noodles", "rice", "stew", "snack", "akara",
  "bukka", "egusi", "garri", "moimoi", "okra", "pepper", "puff-puff",
  "meat-pie", "stomach", "cooking",
]);
function classifyEdge(r: any): string {
  if (FOOD_V2_HOOKS.has(r.hook)) return "home→food (FOOD_V2)";
  if (r.src === "home") {
    if (FOOD_ANCHORS.has(r.anchor)) return "home→food (legacy)";
    return "home→home (legacy)";
  }
  // r.src === "everyday"
  const tags: string[] = ["everyday→home"]; // legacy bucket
  if (MORNINGS_ANCHORS.has(r.anchor)) tags.push("everyday→mornings");
  if (SLEEP_ANCHORS.has(r.anchor)) tags.push("everyday→sleep");
  if (FOOD_ANCHORS.has(r.anchor)) tags.push("everyday→food");
  return tags.join(" + ");
}

const enriched = rows.map((r) => ({ ...r, edge: classifyEdge(r) }));

const summary: any = {
  totalWidened: enriched.length,
  shippedCount: enriched.filter((r) => r.shipped).length,
  unshippedCount: enriched.filter((r) => !r.shipped).length,
};

// FOOD_V2 detail
const fv2 = enriched.filter((r) => FOOD_V2_HOOKS.has(r.hook));
fv2.sort((a, b) => b.score - a.score);
summary.foodV2 = {
  total: fv2.length,
  shipped: fv2.filter((r) => r.shipped).length,
  scoreMin: Math.min(...fv2.map((r) => r.score)),
  scoreMax: Math.max(...fv2.map((r) => r.score)),
  shippedScores: fv2.filter((r) => r.shipped).map((r) => r.score),
  unshippedScores: fv2.filter((r) => !r.shipped).map((r) => r.score),
};

// Everyday detail
const ev = enriched.filter((r) => r.src === "everyday");
ev.sort((a, b) => b.score - a.score);
summary.everyday = {
  total: ev.length,
  shipped: ev.filter((r) => r.shipped).length,
  scoreMin: Math.min(...ev.map((r) => r.score)),
  scoreMax: Math.max(...ev.map((r) => r.score)),
  byEdgeClass: {
    mornings: ev.filter((r) => r.edge.includes("mornings")).length,
    sleep: ev.filter((r) => r.edge.includes("sleep")).length,
    food: ev.filter((r) => r.edge.includes("food")).length,
  },
  shippedDetail: ev.filter((r) => r.shipped).map((r) => ({
    id: r.id, score: r.score, anchor: r.anchor, edge: r.edge, hook: r.hook,
  })),
  topUnshippedMornings: ev
    .filter((r) => !r.shipped && r.edge.includes("mornings"))
    .slice(0, 5)
    .map((r) => ({ id: r.id, score: r.score, anchor: r.anchor, hook: r.hook })),
  topUnshippedSleep: ev
    .filter((r) => !r.shipped && r.edge.includes("sleep"))
    .slice(0, 5)
    .map((r) => ({ id: r.id, score: r.score, anchor: r.anchor, hook: r.hook })),
};

// Home (non-FOOD_V2) detail
const home = enriched.filter((r) => r.src === "home" && !FOOD_V2_HOOKS.has(r.hook));
home.sort((a, b) => b.score - a.score);
summary.homeLegacy = {
  total: home.length,
  shipped: home.filter((r) => r.shipped).length,
  shippedDetail: home.filter((r) => r.shipped).map((r) => ({
    id: r.id, score: r.score, anchor: r.anchor, hook: r.hook,
  })),
};

const out = { summary, foodV2: fv2, everyday: ev, homeLegacy: home };
fs.writeFileSync(
  "/home/runner/workspace/.local/qa-runs/p12_widened_entry_audit.json",
  JSON.stringify(out, null, 2),
);

console.log("=== SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));
console.log("\n=== FOOD_V2 (sorted by score) ===");
for (const r of fv2) {
  console.log(
    `${r.shipped ? "SHIP×" + r.shipCount : "miss "} sc=${String(r.score).padStart(2)} brev=${r.breakdown.brevity ?? "?"} visc=${r.breakdown.visceral ?? "?"} anch=${r.breakdown.anchorRelevance ?? "?"} contr=${r.breakdown.contradiction ?? "?"} natu=${r.breakdown.naturalness ?? "?"} film=${r.breakdown.filmable ?? "?"} | ${r.id} ${r.anchor.padEnd(10)} ${r.hook}`,
  );
}
console.log("\n=== EVERYDAY (sorted by score) ===");
for (const r of ev) {
  console.log(
    `${r.shipped ? "SHIP×" + r.shipCount : "miss "} sc=${String(r.score).padStart(2)} | ${r.anchor.padEnd(11)} edge=${r.edge.padEnd(45)} ${r.hook}`,
  );
}
