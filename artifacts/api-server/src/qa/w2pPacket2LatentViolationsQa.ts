// W2-P helper: enumerate ALL latent test violations across the 3 failing
// invariants so a single editor packet can resolve them in one pass.
// Mirrors the per-test logic in westernHookPackApproved.test.ts verbatim.

import { APPROVED_WESTERN_PROMOTION_CANDIDATES } from "../lib/westernHookPackApproved";
import { WESTERN_HOOK_PACK_BATCH_NEXT } from "../lib/westernHookPackBatchNext";
import { WESTERN_HOOK_PACK_BATCH_NEXT2 } from "../lib/westernHookPackBatchNext2";

const STOP = new Set([
  "with", "from", "into", "that", "this", "your", "they", "them",
  "have", "been", "then", "than", "like", "just", "shot", "take",
  "framed", "static", "single", "phone", "tripod", "locked",
  "instructions", "filming",
]);

function substTokens(s: string): Set<string> {
  return new Set(
    (s.toLowerCase().match(/[a-z]+/g) ?? []).filter(
      (t) => t.length >= 4 && !STOP.has(t),
    ),
  );
}

console.log("\n=== Triplet collisions on (comedyFamily | emotionalSpike | anchor) ===");
const tripletGroups = new Map<string, string[]>();
for (const e of APPROVED_WESTERN_PROMOTION_CANDIDATES) {
  const k = `${e.comedyFamily}|${e.emotionalSpike}|${e.anchor}`;
  const arr = tripletGroups.get(k) ?? [];
  arr.push(e.id);
  tripletGroups.set(k, arr);
}
const tripletCollisions = [...tripletGroups.entries()].filter(([, ids]) => ids.length > 1);
for (const [k, ids] of tripletCollisions) console.log(`  ${k}  →  ${ids.join(", ")}`);
console.log(`  total collision groups: ${tripletCollisions.length}`);

console.log("\n=== Anchor token missing from whatToShow ===");
let anchorMisses = 0;
for (const e of APPROVED_WESTERN_PROMOTION_CANDIDATES) {
  if (!e.whatToShow.toLowerCase().includes(e.anchor.toLowerCase())) {
    console.log(`  ${e.id}  anchor="${e.anchor}"  whatToShow="${e.whatToShow.slice(0, 100)}…"`);
    anchorMisses++;
  }
}
console.log(`  total anchor misses: ${anchorMisses}`);

console.log("\n=== W2-L howToFilm <→ whatToShow substantive token overlap < 3 ===");
let lOver = 0;
for (const e of WESTERN_HOOK_PACK_BATCH_NEXT) {
  const wts = substTokens(e.whatToShow);
  const hf = substTokens(e.howToFilm);
  let shared = 0;
  for (const t of hf) if (wts.has(t)) shared++;
  if (shared < 3) {
    const overlap = [...hf].filter((t) => wts.has(t));
    console.log(`  ${e.id}  shared=${shared}  overlap=[${overlap.join(", ")}]  anchor="${e.anchor}"`);
    lOver++;
  }
}
console.log(`  total W2-L violations: ${lOver}`);

console.log("\n=== W2-N howToFilm <→ whatToShow substantive token overlap < 3 ===");
let nOver = 0;
for (const e of WESTERN_HOOK_PACK_BATCH_NEXT2) {
  const wts = substTokens(e.whatToShow);
  const hf = substTokens(e.howToFilm);
  let shared = 0;
  for (const t of hf) if (wts.has(t)) shared++;
  if (shared < 3) {
    const overlap = [...hf].filter((t) => wts.has(t));
    console.log(`  ${e.id}  shared=${shared}  overlap=[${overlap.join(", ")}]  anchor="${e.anchor}"`);
    nOver++;
  }
}
console.log(`  total W2-N violations: ${nOver}`);
