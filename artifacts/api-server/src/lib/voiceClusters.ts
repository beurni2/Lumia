/**
 * PHASE Y6 — VOICE CLUSTERS
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
 * Boot-time assertion: every cluster has ≥8 templates and ≥3 seed
 * exemplars. A misconfigured catalog throws at module load — we
 * never want a generation pipeline silently running with a degraded
 * voice taxonomy.
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
      "this is my ${anchor} pattern now",
      "i ${actionPast} the ${anchor} on schedule",
      "the ${anchor} situation is fine probably",
      "i checked the ${anchor}. mistake.",
      "this ${anchor} thing keeps happening",
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
      "i think the ${anchor} is the personality now",
      "the ${anchor} thing hit a little close",
      "i need to be studied about the ${anchor}",
      "the ${anchor} keeps revealing itself",
      "i noticed i ${actionPast} the ${anchor} again",
      "the ${anchor} is doing all the work apparently",
      "this is not normal ${anchor} behavior anymore",
      "i looked at the ${anchor} and got quiet",
      "the ${anchor} is the entire pattern",
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
      "the ${anchor} became my villain origin",
      "this ${anchor} flatlined my whole week",
      "scientists could write papers about my ${anchor}",
      "the ${anchor} demolished my entire vibe",
      "one ${anchor} aged me visibly",
      "the ${anchor} drained the whole battery",
      "my body left the ${anchor} situation entirely",
      "the ${anchor} ruined my villain arc",
      "i had to break up with the ${anchor}",
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
