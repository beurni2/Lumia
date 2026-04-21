import type {
  PolicyPack,
  PublishContent,
  RuleHit,
  ShieldVerdict,
} from "./types";
import { MAX_REWRITE_PASSES } from "./types";

/**
 * Evaluate `content` against every supplied pack.
 *
 * Pure & deterministic: rule order is preserved, packs are evaluated in the
 * order supplied, and every hit is reported (the UI may dedupe by ruleId).
 *
 * Returns the raw verdict — no rewriting. Use {@link autoRewrite} for the
 * full Sprint 3 pipeline.
 */
export function evaluate(
  content: PublishContent,
  packs: readonly PolicyPack[],
): readonly RuleHit[] {
  const hits: RuleHit[] = [];
  for (const pack of packs) {
    for (const rule of pack.rules) {
      if (rule.match(content)) {
        hits.push({
          ruleId: rule.id,
          platform: pack.platform,
          severity: rule.severity,
          explanation: rule.humanExplanation,
        });
      }
    }
  }
  return hits;
}

/**
 * Auto-rewrite pipeline.
 *
 *   1. Evaluate against all packs.
 *   2. If any HARD hit → status="blocked"; return original content untouched.
 *   3. Otherwise apply every soft rule's `rewrite()` in pack/rule order.
 *   4. Re-evaluate. Loop until verdict stabilises (no soft hits remain) or
 *      MAX_REWRITE_PASSES is reached.
 *   5. If after the cap there are still soft hits, status="blocked" with all
 *      unresolved hits surfaced — better to refuse than ship something the
 *      Shield can't actually clean.
 *
 * The Sprint 3 ROADMAP audit demands zero false negatives on the red-team
 * corpus; a hard hit ALWAYS short-circuits, even if a soft rewrite would
 * have superficially "fixed" it.
 */
export function autoRewrite(
  content: PublishContent,
  packs: readonly PolicyPack[],
): ShieldVerdict {
  const initialHits = evaluate(content, packs);
  const initialHard = initialHits.filter((h) => h.severity === "hard");
  if (initialHard.length > 0) {
    return {
      status: "blocked",
      hits: initialHits,
      rewritten: content,
      rewritePasses: 0,
    };
  }

  let current = content;
  let passes = 0;
  let lastHits: readonly RuleHit[] = initialHits;
  while (passes < MAX_REWRITE_PASSES) {
    const softHits = lastHits.filter((h) => h.severity === "soft");
    if (softHits.length === 0) break;

    let mutated = current;
    for (const pack of packs) {
      for (const rule of pack.rules) {
        if (rule.severity !== "soft" || !rule.rewrite) continue;
        if (rule.match(mutated)) {
          mutated = rule.rewrite(mutated);
        }
      }
    }
    // Stop if a pass produced no change — protects against ping-pong rules.
    if (sameContent(mutated, current)) break;
    current = mutated;
    passes++;
    lastHits = evaluate(current, packs);
    // A rewrite could expose a hard hit (rare but possible). Block.
    if (lastHits.some((h) => h.severity === "hard")) {
      return {
        status: "blocked",
        hits: lastHits,
        rewritten: current,
        rewritePasses: passes,
      };
    }
  }

  const finalHits = lastHits;
  if (finalHits.length === 0) {
    // Rewritten clean OR was clean to begin with.
    return {
      status: passes === 0 ? "pass" : "rewritten",
      hits: initialHits,
      rewritten: current,
      rewritePasses: passes,
    };
  }
  // Cap exceeded with residual soft hits → block honestly.
  return {
    status: "blocked",
    hits: finalHits,
    rewritten: current,
    rewritePasses: passes,
  };
}

function sameContent(a: PublishContent, b: PublishContent): boolean {
  return (
    a.caption === b.caption &&
    a.hook === b.hook &&
    a.thumbnailLabel === b.thumbnailLabel &&
    a.audioCue === b.audioCue &&
    a.durationSec === b.durationSec &&
    a.hashtags.length === b.hashtags.length &&
    a.hashtags.every((h, i) => h === b.hashtags[i]) &&
    a.regions.length === b.regions.length &&
    a.regions.every((r, i) => r === b.regions[i])
  );
}
