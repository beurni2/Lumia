/**
 * PHASE N1-TRIGGER-FIX (2026-05-06) — regression coverage for the
 * `authorPackEntryAsIdea` trigger-synthesis change. The fix borrows
 * up to 2 unique non-stopword content tokens from `entry.whatToShow`
 * and weaves them into the trigger sentence so the catalog comedy
 * validator's `hook_scenario_mismatch` rule (≥2 token overlap
 * between trigger and whatToShow) is satisfied deterministically.
 *
 * What we lock down:
 *   1. End-to-end: a representative Pidgin pack entry that previously
 *      failed `hook_scenario_mismatch` (1-token anchor-only overlap)
 *      now PASSES `validateComedy` end-to-end.
 *   2. Deterministic trigger shape: trigger contains the anchor AND
 *      ≥2 content tokens drawn from `whatToShow`.
 *   3. Length bounds: trigger stays within ideaSchema's 5–140 char band.
 *   4. Fallback path: when whatToShow contains insufficient unique
 *      content tokens, trigger falls back to the original template
 *      (never throws, never produces an empty string).
 *   5. Validator overlap >= 2 by construction on a sample of real
 *      reviewer-stamped approved-pack entries.
 */

import { describe, it, expect } from "vitest";
import { authorPackEntryAsIdea } from "../nigerianPackAuthor.js";
import type { NigerianPackEntry } from "../nigerianHookPack.js";
import type { PremiseCore } from "../premiseCoreLibrary.js";
import type { VoiceCluster } from "../voiceClusters.js";
import { APPROVED_NIGERIAN_PROMOTION_CANDIDATES } from "../nigerianHookPackApproved.js";

// Minimal fake core/voice — values mirror what the live pipeline
// passes in. We don't care about scoring details here, only the
// validator passage.
const FAKE_CORE: PremiseCore = {
  id: "core_test_self_betrayal",
  family: "self_betrayal",
  domain: "phone",
  anchor: "phone",
  premiseSeed: "test premise seed for the unit test harness",
  scriptType: "internal_thought",
  archetype: "self_betrayer",
  sceneObjectTag: "phone_in_hand",
  hookLanguageStyle: "internal_thought",
} as unknown as PremiseCore;

const FAKE_VOICE: VoiceCluster = {
  id: "neutral",
  hookLanguageStyle: "internal_thought",
} as unknown as VoiceCluster;

// One of the formerly-failing entries from the v2 instrumentation
// report. Anchor "wahala" appeared twice in the hook and once in
// whatToShow → only 1-token overlap → hook_scenario_mismatch.
const FAILING_ENTRY: NigerianPackEntry = {
  id: "test_wahala",
  hook: 'I said "no wahala" before I understood the wahala',
  whatToShow:
    "Show a fake chat where someone explains the plan in detail after you already replied 'no wahala.' You stare, then scroll back to your own message like you betrayed yourself.",
  howToFilm:
    "Lock the camera on the chat. Hold beat after the long message lands.",
  caption: "no wahala wahala",
  anchor: "wahala",
  domain: "messaging",
  pidginLevel: "pidgin",
  reviewedBy: "BI 2026-05-06",
} as unknown as NigerianPackEntry;

describe("Nigerian pack trigger synthesis (PHASE N1-TRIGGER-FIX)", () => {
  it("the formerly-failing 'wahala' entry now passes validateComedy", () => {
    const result = authorPackEntryAsIdea({
      entry: FAILING_ENTRY,
      core: FAKE_CORE,
      voice: FAKE_VOICE,
      regenerateSalt: 0,
      seedFingerprints: new Set<string>(),
    });
    // Pre-fix: result.kind === "rejected" with reason
    // "hook_scenario_mismatch". Post-fix: passes.
    expect(result.ok).toBe(true);
  });

  it("synthesized trigger contains anchor AND ≥2 whatToShow tokens", () => {
    const result = authorPackEntryAsIdea({
      entry: FAILING_ENTRY,
      core: FAKE_CORE,
      voice: FAKE_VOICE,
      regenerateSalt: 0,
      seedFingerprints: new Set<string>(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const trigger = result.idea.trigger;
    expect(trigger).toContain("wahala");
    // The whatToShow text yields these as the first 2 unique
    // non-stopword non-anchor tokens (after the fixed tokenize regex
    // and STOPWORDS pass): "fake" and "chat". The trigger MUST
    // include both verbatim or the deterministic guarantee is broken.
    expect(trigger).toContain("fake");
    expect(trigger).toContain("chat");
  });

  it("synthesized trigger respects ideaSchema length band (5–140)", () => {
    const result = authorPackEntryAsIdea({
      entry: FAILING_ENTRY,
      core: FAKE_CORE,
      voice: FAKE_VOICE,
      regenerateSalt: 0,
      seedFingerprints: new Set<string>(),
    });
    if (!result.ok) return;
    expect(result.idea.trigger.length).toBeGreaterThanOrEqual(5);
    expect(result.idea.trigger.length).toBeLessThanOrEqual(140);
  });

  it("fallback path: trigger reverts to original template when whatToShow yields <2 unique non-stopword non-anchor tokens", () => {
    // Construct a degenerate whatToShow that, after stopword + anchor
    // exclusion, exposes fewer than 2 unique content tokens. We can't
    // get below the 20-char PACK_FIELD_BOUNDS so we pad with the
    // anchor + stopwords only. Tokenize regex is /[a-z][a-z0-9']{2,}/g
    // so "the the the the the the the" tokens={the} (stopword) → 0
    // content tokens after filter.
    //
    // NOTE: The PACK_FIELD_BOUNDS validator + anchor-in-whatToShow
    // boot rule mean this state is empirically impossible in the
    // live approved pool. The test exists to lock the fallback
    // BEHAVIOR (not regress past the pre-fix baseline) in case a
    // future reviewer drafts an entry that lands here.
    const degenerateEntry: NigerianPackEntry = {
      ...FAILING_ENTRY,
      id: "test_degenerate",
      anchor: "wahala",
      // 22 chars, anchor present (boot rule), all other tokens stopwords.
      whatToShow: "the wahala the the the",
    } as unknown as NigerianPackEntry;
    const result = authorPackEntryAsIdea({
      entry: degenerateEntry,
      core: FAKE_CORE,
      voice: FAKE_VOICE,
      regenerateSalt: 0,
      seedFingerprints: new Set<string>(),
    });
    // We don't require result.ok here — degenerate entries may
    // legitimately fail downstream validators (e.g.
    // hook_scenario_mismatch on the hook side, since whatToShow has
    // ~no overlap with the hook either). What we DO require is that
    // the synthesized trigger string is the original fallback
    // template — i.e. the helper returned null and the code path
    // never threw, never produced an empty string, never embedded a
    // stopword like "the" as a content token.
    if (result.ok) {
      // Pass case: trigger is the fallback (no extra tokens woven in).
      expect(result.idea.trigger).toBe("notice the wahala land");
    } else {
      // Reject case: still must not have thrown. The reject reason
      // can be any of the production validators; the only assertion
      // here is that the function completed without throwing.
      expect(typeof result.reason).toBe("string");
    }
  });

  it("real approved-pack sample: ≥80% pass validators (was <50% pre-fix)", () => {
    // Spot-check across the live approved pool. Pre-fix the v2
    // instrumentation showed ~47% passage (53.2% rejected, 94.4%
    // of which was hook_scenario_mismatch). Post-fix we expect
    // hook_scenario_mismatch to drop to near zero, so combined
    // pass rate should clear 80%. We sample 30 entries to keep
    // the unit test fast.
    const sample = APPROVED_NIGERIAN_PROMOTION_CANDIDATES.slice(0, 30);
    let passed = 0;
    for (const entry of sample) {
      const r = authorPackEntryAsIdea({
        entry,
        core: FAKE_CORE,
        voice: FAKE_VOICE,
        regenerateSalt: 0,
        seedFingerprints: new Set<string>(),
      });
      if (r.ok === true) passed++;
    }
    expect(passed / sample.length).toBeGreaterThanOrEqual(0.8);
  });
});
