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
  | "overdramatic_reframe";

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
    ],
  seedHookExemplars: [
      "a small task became my villain origin",
      "this absolutely demolished my whole vibe",
      "scientists could write entire papers about my chaos",
      "a single notification flatlined my entire week",
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
