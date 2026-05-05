/**
 * PHASE Y6 — VOICE CLUSTERS  (Y8 hook-template curation pass)
 *
 * Four frozen voice clusters for the cohesive single-pass core-
 * native generator. Each cluster bundles:
 *
 *   - `tonalSignature`   one-line voice description
 *   - `hookTemplates`    8-12 ${anchor}/${action}/${actionPast}/
 *                        ${ingForm}/${mechanism}/${contradiction}
 *                        placeholder strings the author renders
 *   - `lengthTargetWords` [min, max] target — author caps at max
 *   - `softnessCeiling`  0-1, advisory (Y7 will use it for taste)
 *   - `seedHookExemplars` 3-4 of the existing 150 PREMISE_STYLE_DEFS
 *                        seed hooks bucketed into this voice as
 *                        VOICE TRAINING REFERENCE (NOT anti-copy
 *                        seeds — Y6 flips the seed-hook gate from
 *                        exact-fingerprint match to Jaccard ≥ 0.85
 *                        in `comedyValidation.validateAntiCopy`,
 *                        so these read as voice exemplars instead)
 *
 * Boot-time assertion: every cluster has ≥8 templates AND every
 * template renders to a `scoreHookQuality` ≥ 40 against a
 * representative test fill (mid-tier family action `abandoned` +
 * concrete anchor `list`). A misconfigured catalog or a bland
 * template throws at module load — we never want a generation
 * pipeline silently running with a degraded voice taxonomy or
 * with a template that scores so low it can't possibly be the
 * highest-quality recipe in any per-core collect-then-pick batch.
 *
 * Pure / deterministic / frozen at load. NO Claude. NO DB. NO new
 * cost. Same discipline as `premiseCoreLibrary.ts`.
 */

export type VoiceClusterId =
  | "dry_deadpan"
  | "chaotic_confession"
  | "quiet_realization"
  | "overdramatic_reframe"
  // PHASE Z5a — fifth voice cluster. INTERNAL-FIRST exposure: not
  // wired into FAMILY_VOICE (no family defaults to it) and not wired
  // into TONE_TO_VOICE_CLUSTER (no Quick Tune `preferredTone` enum
  // value maps to it — the calibration enum stays at 4 tones, no
  // schema migration). It surfaces ONLY through the cold-start salt-
  // rotation arm of `resolveVoiceCluster` (≈18% of cold-start picks
  // for any family, dropping to ≈12.5% when the creator has pinned a
  // tone). All Y8 boot-floor invariants apply unchanged: ≥8 templates
  // each scoring ≥40 against TEST_FILL, ≥3 seedHookExemplars,
  // lengthTargetWords ⊂ [2, 10].
  | "high_energy_rant";

export type VoiceCluster = {
  readonly id: VoiceClusterId;
  readonly tonalSignature: string;
  readonly hookTemplates: readonly string[];
  readonly lengthTargetWords: readonly [number, number];
  readonly softnessCeiling: number;
  readonly seedHookExemplars: readonly string[];
};

const RAW_CLUSTERS: readonly VoiceCluster[] = [
  {
    id: "dry_deadpan",
    tonalSignature:
      "flat declarative collapse — minimal verbs, the joke is the lack of reaction",
    lengthTargetWords: [4, 9],
    softnessCeiling: 0.35,
    hookTemplates: [
      "i ${actionPast} my own ${anchor}",
      "the ${anchor} won again",
      "i specialize in ${ingForm} the ${anchor}",
      // Y8 curation: was "this is my ${anchor} pattern now" —
      // bland-verb / no-anthropomorph / no-contradiction template
      // scored 35 on `scoreHookQuality`. Replace with a deadpan
      // period-beat construction that retains voice + clears the
      // ≥40 floor (now ~67 with anchor='list'/action='abandoned').
      "the ${anchor} won. obviously.",
      "i ${actionPast} the ${anchor} on schedule",
      // Y8 curation: was "the ${anchor} situation is fine probably"
      // — bland-verb / no-marker template scored 30. Replace with
      // an X-as-actor construction that triggers implicit
      // anthropomorph + a comma beat (now ~72).
      "the ${anchor} ${actionPast} me first",
      "i checked the ${anchor}. mistake.",
      // Y8 curation: was "this ${anchor} thing keeps happening" —
      // bland-verb / no-marker template scored 35. Replace with an
      // explicit `itself` construction that uses the family ing-
      // form for visceral verb credit (now ~73).
      "the ${anchor} keeps ${ingForm} itself",
      "the ${anchor} and i had a moment",
      "i ${actionPast} the ${anchor} like a stranger",
      // PHASE D3 — distilled from user-blessed corpus pattern
      // `"i'll reply later" ... it's been 3 weeks` (quoted-promise
      // → ellipsis → time-jump). Period beat + quote + concrete
      // anchor + contradiction marker (`later` vs `still pending`).
      "\"i'll ${action} the ${anchor} later\"... still pending",
      // PHASE D3 — distilled from corpus pattern `i ghosted my own
      // to-do list... it deserved it` (deadpan-action + period-beat
      // verdict). Anchor as receiver + period beat + obviously-
      // marker.
      "${actionPast} the ${anchor} on the first try. obviously.",
      // PHASE D15 — distilled from D14 corpus pattern `the dishes
      // won, i lost, status quo` (X-and-i + still-here + period-
      // beat verdict). Explicit anthropomorph (`the X and i`) +
      // contradiction (`still`) + period beat. Renders ~67.
      "the ${anchor} and i are still here. barely.",
      // PHASE D15 — distilled from D14 corpus pattern `i ghosted
      // my own discipline. it filed a missing person report.`
      // (action + period-beat noticing of object reaction).
      // Period beat + bland-but-tonal "it didn't notice" coda;
      // earns its score from MID verb + brevity + period beat.
      // Renders ~58.
      "i ${actionPast} the ${anchor}. it didn't notice.",
      // PHASE D15 — distilled from D14 corpus pattern `my "just
      // one thing" store run just cost me $92` (mundane action
      // reframed as the only routine). MID verb (ing-form
      // family verb) + concrete anchor + `still` contradiction.
      // Renders ~55.
      "${ingForm} the ${anchor} is my only hobby still",
    ],
    seedHookExemplars: [
      "i ghosted my own to-do list",
      "this did not go well at all",
      "the dishes won again",
      "i specialize in disappointing myself",
    ],
  },
  {
    id: "chaotic_confession",
    tonalSignature:
      "self-aware admission — saying the embarrassing thing out loud, in real time",
    lengthTargetWords: [5, 10],
    softnessCeiling: 0.55,
    hookTemplates: [
      "okay i ${actionPast} the ${anchor} again",
      "watched myself ${action} the ${anchor} live",
      "i ${actionPast} the ${anchor} and pretended that counted",
      "the ${anchor} and i are co-conspirators now",
      "honestly i ${actionPast} the ${anchor} on purpose",
      "i opened the ${anchor} and immediately ${actionPast} it",
      "still ${ingForm} the ${anchor} at this hour",
      "my ${anchor} discipline expired instantly",
      "one ${anchor} and the whole plan ended",
      "i ${actionPast} the ${anchor} in record time",
      // PHASE D3 — distilled from corpus pattern `"i'm not into him"
      // ... checks his story again` (verbal denial → contradicting
      // action). Quote + period beat + repeated anchor + contradiction
      // marker (`again`).
      "\"i'm not into the ${anchor}\"... checks the ${anchor} again",
      // PHASE D3 — distilled from corpus pattern `tried to quit
      // sugar... ate cake within the hour` (quit-attempt + immediate
      // failure). Period beat + concrete anchor + contradiction
      // (`quit` vs `${actionPast} ... within the hour`).
      "tried to quit the ${anchor}. ${actionPast} it within the hour.",
      // PHASE D15 — distilled from D14 corpus pattern `i told my
      // therapist everything... then never went back` (over-share
      // confession → quiet retreat). Period beat + "then" pivot +
      // concrete anchor. Renders ~55.
      "i told the ${anchor} everything. then ${actionPast} it.",
      // PHASE UX3.3 (rev-4) — DELETED: "i confessed to the ${anchor}.
      // then ${actionPast} myself." 20-idea live sweep showed this
      // template ships across families with raw stiff `actionPast`
      // ("performed myself" / "abandoned myself" / "ghosted myself")
      // — ungrammatical first-person construction that bypassed the
      // hook-exemption-from-leak-rule because hooks are intentionally
      // exempt. Removed at the source instead.
      // PHASE D15 — distilled from D14 corpus pattern `still
      // doomscrolling at 2am again` (still-ing + time-stamp +
      // again loop confession). MID verb + brevity sweet spot +
      // double contradiction (`still` + `again`). Renders ~58.
      "still ${ingForm} the ${anchor} at midnight again",
    ],
    seedHookExemplars: [
      "i checked one thing. ruined my day",
      "i opened it and immediately closed it",
      "watched myself avoid it in real time",
      "my brain chose violence at midnight",
    ],
  },
  {
    id: "quiet_realization",
    tonalSignature:
      "small noticing — the moment you catch yourself, said softly to camera",
    lengthTargetWords: [4, 9],
    softnessCeiling: 0.5,
    hookTemplates: [
      "this is where the ${anchor} broke me",
      // Y8 curation: was "i think the ${anchor} is the personality
      // now" — bland-verb / no-marker template scored 27. Replace
      // with an explicit `itself` construction that holds the
      // quiet voice register but earns the anthropomorph points
      // (now ~60).
      "the ${anchor} itself is the personality",
      "the ${anchor} thing hit a little close",
      // Y8 curation: was "i need to be studied about the ${anchor}"
      // — no-marker template scored 32. Add `my own` to land the
      // explicit anthropomorph axis without changing the noticing
      // voice (now ~53).
      "i need to be studied about my own ${anchor}",
      "the ${anchor} keeps revealing itself",
      "i noticed i ${actionPast} the ${anchor} again",
      // Y8 curation: was "the ${anchor} is doing all the work
      // apparently" — bland-verb / no-marker template scored 27.
      // Replace with an X-as-actor `again` construction that
      // triggers a contradiction beat without losing the soft
      // realization tone (now ~45).
      "i think the ${anchor} is alive again",
      "this is not normal ${anchor} behavior anymore",
      // Y8 curation: was "i looked at the ${anchor} and got quiet"
      // — bland-verb / no-marker template scored 35. Add `my own`
      // for the explicit anthropomorph axis (now ~56).
      "i looked at my own ${anchor} and got quiet",
      // Y8 curation: was "the ${anchor} is the entire pattern" —
      // bland-verb / no-marker / very-short template scored 30.
      // Add `itself` for explicit anthropomorph (now ~60).
      "the ${anchor} itself is the entire pattern",
      // PHASE D3 — distilled from corpus pattern `the panic isn't
      // the problem. i am.` (truism-reframe with period-beat
      // self-indictment). Period beat + `itself` anthropomorph +
      // contradiction (`isn't` vs `i am`).
      "the ${anchor} itself isn't the problem. i am.",
      // PHASE D3 — distilled from corpus pattern `breathing isn't
      // recovery. it's panic with better lighting.` (truism-reframe
      // shape: X isn't Y, it's Z). Period beat + contradiction
      // (`isn't` vs `it's`).
      "${ingForm} the ${anchor} isn't recovery. it's panic.",
      // PHASE D15 — distilled from D14 corpus pattern `i quietly
      // realized i'm the stable friend now... rip` (soft self-
      // identification noticing). `itself` explicit anthropomorph
      // + concrete anchor + brevity sweet spot. Renders ~57.
      "quietly realized the ${anchor} itself is the personality",
      // PHASE D15 — distilled from D14 corpus pattern `my dream
      // job became "at least i have benefits"` (aspirational
      // reframe → resigned consolation; quoted-coda shape).
      // `itself` explicit anthropomorph + concrete anchor +
      // `again` contradiction. Renders ~66.
      "the ${anchor} itself became \"at least i tried\" again",
      // PHASE D15 — distilled from D14 corpus pattern `quiet
      // realization my chill is actually anxiety wearing a hat`
      // (truism reframe: X is actually Y). `itself` explicit
      // anthropomorph + concrete anchor. Renders ~57.
      "quiet realization: the ${anchor} itself is anxiety now",
    ],
    seedHookExemplars: [
      "this is where my life collapsed",
      "this is my entire pattern",
      "i need to be studied",
      "this hit a little too close",
    ],
  },
  {
    id: "overdramatic_reframe",
    tonalSignature:
      "tiny inconvenience escalated to identity-level catastrophe — straight-faced",
    lengthTargetWords: [5, 10],
    softnessCeiling: 0.7,
    hookTemplates: [
      // Y8 verified: "villain" + "origin" trigger DRAMATIC_NOUNS
      // tension marker, lifting score to ~45 (was 35 pre-Y8 with
      // bland `became` and no dramatic-noun credit).
      "the ${anchor} became my villain origin",
      "this ${anchor} flatlined my whole week",
      // Y8 verified: "scientists" + "papers" both in DRAMATIC_NOUNS,
      // template scores ~42.
      "scientists could write papers about my ${anchor}",
      "the ${anchor} demolished my entire vibe",
      // Y8 curation: was "one ${anchor} aged me visibly" — no-marker
      // template scored 35. Add "10 years" numeric for contradiction
      // beat (now ~45).
      "one ${anchor} aged me 10 years visibly",
      "the ${anchor} drained the whole battery",
      // Y8 curation: was "my body left the ${anchor} situation
      // entirely" — no-marker template scored 38. Add a period
      // beat for contradiction credit (now ~48).
      "my body left the ${anchor} entirely. without me.",
      "the ${anchor} ruined my villain arc",
      "i had to break up with the ${anchor}",
      // Y8 verified: "apocalypse" in DRAMATIC_NOUNS, template
      // scores ~45.
      "the ${anchor} is a personal apocalypse now",
      // PHASE D3 — distilled from corpus pattern `my fridge hired a
      // lawyer about my snacking` (mundane object → bureaucratic
      // personification). Anchor as actor + dramatic noun (`lawyer`)
      // + `itself` anthropomorph credit.
      "the ${anchor} itself hired a lawyer about my behavior",
      // PHASE D3 — distilled from corpus pattern `said i'd eat clean
      // this week. my fridge filed a restraining order.` (verbal
      // commitment → bureaucratic-absurdity escalation). Period beat
      // + anchor as actor + dramatic noun (`complaint`).
      "said i'd ${action} the ${anchor}. it filed a complaint.",
      // PHASE D15 — distilled from D14 corpus pattern `my phone
      // knows when i'm pretending to be productive` (object-as-
      // omniscient-witness shape, with the cliché-allowlisted
      // "knows i'm lying" phrasing replaced by HIGH-tier verb
      // `faking`). HIGH verb (fake) + concrete anchor + brevity
      // sweet spot. Renders ~60.
      "my ${anchor} knows when i'm faking it",
      // PHASE D15 — distilled from D14 corpus pattern `my rent
      // just ate my whole paycheck alive` (mundane bill →
      // predator-eating-victim escalation). Implicit anthropomorph
      // (`the X ate`) + MID verb + concrete anchor. Renders ~57.
      "the ${anchor} just ate my entire week alive",
      // PHASE UX3.3 (rev-4) — DELETED: "my own ${anchor} knows
      // i'm faking it again". 20-idea live sweep showed this
      // template ships verbatim 3× per batch (low diversity), with
      // grammatically broken subject-verb agreement on plural
      // anchors ("my own slippers KNOWS"), AND embeds the family
      // verb "faking" as an idiom that the leak regex cannot
      // catch (no determiner before noun). Removed at source.
    ],
  seedHookExemplars: [
      "a small task became my villain origin",
      "this absolutely demolished my whole vibe",
      "scientists could write entire papers about my chaos",
      "a single notification flatlined my entire week",
    ],
  },
  {
    // PHASE Z5a — fifth voice cluster. Manic-exclamation cadence:
    // panic-volume, run-on, repetition-coded confession. The joke is
    // the energy, not the words. Distinct from `chaotic_confession`
    // (which is a self-aware admission, conversational register) by
    // its loud / interrupted / capitalised cadence and its reliance
    // on shouted contradictions (`AGAIN`, `BUT`, `STILL`) over
    // narrative confession beats. All templates verified to render
    // ≥40 on `scoreHookQuality` against TEST_FILL (action='abandon',
    // anchor='list'). Internal-first: no FAMILY_VOICE entry, no
    // TONE_TO_VOICE_CLUSTER entry — surfaces via cold-start
    // salt-rotation only.
    id: "high_energy_rant",
    tonalSignature:
      "manic exclamation cadence — panic-volume, run-on confession with shouted contradictions; the joke is the energy, not the words",
    lengthTargetWords: [5, 10],
    softnessCeiling: 0.85,
    hookTemplates: [
      // explicit `itself` + family ing-form → ~73
      "WHY does the ${anchor} keep ${ingForm} itself",
      // mid-sentence period beat (". i") + concrete + MID verb → ~55
      "i CANNOT stop ${ingForm} the ${anchor}. i CANNOT",
      // double `again` repetition + period beat + MID verb → ~58
      "i ${actionPast} the ${anchor} AGAIN. AGAIN!!!",
      // explicit `to me` + period-into-lowercase + concrete → ~70
      "someone explain the ${anchor} to me. NOW",
      // family ing-form + `again` + period beat + concrete → ~58
      "the ${anchor} is ${ingForm} me. AGAIN.",
      // `but` contradiction + ing-form + concrete → ~51
      "i can't keep ${ingForm} the ${anchor}!! BUT I WILL",
      // implicit anthropomorph (`the X broke me`) + MID verb → ~57
      "the ${anchor} broke me!! and I'M NOT FINE",
      // explicit `my own` + family ing-form + concrete → ~73
      "my own ${anchor} is ${ingForm} me back!!",
      // `but` contradiction + family bare verb + concrete → ~55
      "i SAID i'd ${action} the ${anchor} but NO",
      // triple-anchor repetition + `again` + period beat → ~50
      "the ${anchor}. the ${anchor}!! AGAIN the ${anchor}",
    ],
    seedHookExemplars: [
      "WAIT i did it AGAIN are you kidding me",
      "why am i like this WHY am i LIKE THIS",
      "the dishes? AGAIN the dishes?? are you serious",
      "i'm SO not okay about this and i just realized",
    ],
  },
] as const;

// Boot-time assertion. Throws at module load on misconfiguration —
// we never want a generation pipeline silently running with a
// degraded voice taxonomy.
for (const c of RAW_CLUSTERS) {
  if (c.hookTemplates.length < 8) {
    throw new Error(
      `[voiceClusters] cluster '${c.id}' has only ${c.hookTemplates.length} templates (require ≥8)`,
    );
  }
  if (c.seedHookExemplars.length < 3) {
    throw new Error(
      `[voiceClusters] cluster '${c.id}' has only ${c.seedHookExemplars.length} seed exemplars (require ≥3)`,
    );
  }
  if (c.lengthTargetWords[0] < 2 || c.lengthTargetWords[1] > 10) {
    throw new Error(
      `[voiceClusters] cluster '${c.id}' lengthTargetWords ${c.lengthTargetWords} out of [2,10]`,
    );
  }
}

// PHASE Y8 — captivating-hook boot assert. Render every template
// against a representative test fill (mid-tier family action
// `abandoned` + concrete anchor `list`) and verify the score lands
// above the floor that lets it survive `coreCandidateGenerator`'s
// new collect-then-pick comparison. Catches catalog drift (a future
// curator-friendly template edit that accidentally removes the
// punch element) at module load instead of in production where the
// degraded template might still be the highest-scoring recipe in
// some unlucky core's 8-recipe queue.
//
// The fill uses the BLANDEST family action verb (`abandoned` is
// mid-tier 18; the only weaker option in FAMILY_ACTIONS is none —
// every family action is at least mid). If a template clears the
// floor under this fill, it'll clear under any HIGH-tier family
// action (ghost / fake / expose etc.) too. Done as a static import
// here (no circular dep — `hookQuality.ts` has no imports from
// `voiceClusters.ts`).
import { scoreHookQuality } from "./hookQuality.js";

const HOOK_QUALITY_FLOOR = 40;
const TEST_FILL: Readonly<Record<string, string>> = {
  anchor: "list",
  action: "abandon",
  actionPast: "abandoned",
  ingForm: "abandoning",
  mechanism: "self betrayal",
  contradiction: "abandoned the list",
};

function renderTemplate(tpl: string): string {
  return tpl.replace(/\$\{(\w+)\}/g, (_, key: string) => {
    const v = TEST_FILL[key];
    return typeof v === "string" ? v : `\${${key}}`;
  });
}

for (const c of RAW_CLUSTERS) {
  for (const tpl of c.hookTemplates) {
    const rendered = renderTemplate(tpl);
    // Family is `self_betrayal` to match the test fill verb. The
    // scorer is family-agnostic in Y8 (the family arg is reserved
    // for future per-family weighting), so any family value works.
    const score = scoreHookQuality(rendered, "self_betrayal");
    if (score < HOOK_QUALITY_FLOOR) {
      throw new Error(
        `[voiceClusters] template in cluster '${c.id}' renders to a hookQualityScore of ${score} (require ≥${HOOK_QUALITY_FLOOR}): "${rendered}" (template: "${tpl}")`,
      );
    }
  }
}

export const VOICE_CLUSTERS: readonly VoiceCluster[] = Object.freeze(
  RAW_CLUSTERS.map((c) =>
    Object.freeze({
      ...c,
      hookTemplates: Object.freeze([...c.hookTemplates]),
      seedHookExemplars: Object.freeze([...c.seedHookExemplars]),
      lengthTargetWords: Object.freeze([...c.lengthTargetWords]) as readonly [
        number,
        number,
      ],
    }),
  ),
);

const _byId = new Map<VoiceClusterId, VoiceCluster>();
for (const c of VOICE_CLUSTERS) _byId.set(c.id, c);

export function getVoiceCluster(id: VoiceClusterId): VoiceCluster {
  const c = _byId.get(id);
  if (!c) {
    throw new Error(`[voiceClusters] unknown voice cluster id '${id}'`);
  }
  return c;
}

/** PHASE Y10 — single source of truth for the 4-cluster taxonomy
 *  membership check. Reads off the same `VOICE_CLUSTERS` registry
 *  the rest of the module is built from, so a future taxonomy
 *  addition (5th cluster) automatically widens this guard with no
 *  duplicated tuple to maintain. Used by `hybridIdeator` to drop
 *  legacy / corrupt voiceClusterId strings on the way INTO the
 *  cross-batch histogram (cache parse) AND on the way OUT (cache
 *  write) so the recent-voice channel can never be poisoned by a
 *  non-cluster string. */
export function isVoiceClusterId(s: string): s is VoiceClusterId {
  return _byId.has(s as VoiceClusterId);
}
