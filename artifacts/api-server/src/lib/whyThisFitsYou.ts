/**
 * PHASE Z1 — "Why this fits you" trust-line composer.
 *
 * Pure deterministic string template — NO Claude, NO DB. One
 * sentence per idea explaining (in plain language) why the system
 * surfaced this candidate as a good fit for the creator. The trust
 * line is the central UX bet of the picker shift: the doc explicitly
 * says "the creator needs to feel: Lumia understands my taste",
 * and this is the line that does it.
 *
 * Templates are bucketed by `voiceClusterId` (4 clusters, ~4 shapes
 * each) and rotated deterministically by `djb2(scenarioFingerprint
 * ?? hook)` so the same idea always gets the same line (cache-stable)
 * but the creator never sees the same phrasing twice in a row across
 * a batch.
 *
 * Anti-boring guarantee — none of the templates use the word "safe"
 * or "easy". The doc's "safest fit / slightly bolder" picker framing
 * is explicitly avoided. Lines lean on personality markers
 * (`dry deadpan`, `confessional`, `quiet noticing`, `overdramatic`)
 * and on what the system observed about the creator's taste, never
 * on comfort.
 */

import type { VoiceClusterId } from "./voiceClusters.js";

export type WhyThisFitsYouInput = {
  voiceClusterId?: VoiceClusterId;
  ideaCoreFamily?: string;
  scenarioFingerprint?: string;
  hook: string;
};

const TEMPLATES_BY_CLUSTER: Readonly<
  Record<VoiceClusterId, readonly string[]>
> = {
  dry_deadpan: [
    "Fits you because your taste leans flat-declarative — the joke is the lack of reaction.",
    "This one's deadpan with a clean period beat, which is the shape your sharpest hooks have taken.",
    "Picked for you because it lands the punch in the silence after, not in the words.",
    "Your voice does dry-collapse really well — this hook is built around that exact restraint.",
  ],
  chaotic_confession: [
    "Fits you because confessional-in-real-time admissions are where your voice clicks.",
    "Picked for you — this is the kind of out-loud admission your taste keeps gravitating to.",
    "Your hooks tend to say the embarrassing part first; this one does that.",
    "This leans into the confession-as-hook shape your batches have been favoring.",
  ],
  quiet_realization: [
    "Fits you because quiet noticing — the small thing you only catch on rewatch — is your register.",
    "Picked for you because the realization lands on the viewer, not on the speaker.",
    "Your taste favors the late-arriving 'wait, oh' moment; this hook builds toward it.",
    "This one's a quiet observation, which has been the shape of your better picks.",
  ],
  overdramatic_reframe: [
    "Fits you because catastrophic reframes of small things are exactly your tone.",
    "Picked for you — your hooks treat the mundane as a five-alarm event, and this is that.",
    "Your voice does overdramatic-but-honest really well, and this hook is built for it.",
    "This leans into the reframe-the-trivial-as-tragedy shape your taste keeps picking.",
  ],
  // PHASE Z5a — fifth voice cluster trust-line pool. Same anti-boring
  // discipline (no `safe` / `easy`); leans on the cadence personality
  // marker (`panic-volume`, `run-on`, `manic`, `unhinged`) to mirror
  // the cluster's tonal signature without quoting the cluster id.
  high_energy_rant: [
    "Fits you because the panic-volume rant cadence — caps, repetition, run-on — is the register your hooks land in.",
    "Picked for you because the manic-confession shape, said too loud, is exactly your taste.",
    "Your voice does unhinged-monologue really well, and this hook is built around that delivery.",
    "This leans into the breathless-rant cadence your sharpest hooks have used.",
  ],
};

const FALLBACK_TEMPLATES: readonly string[] = [
  "Fits you because the hook earns attention without leaning on a cliché.",
  "Picked for you — short, specific, and built around a real contradiction.",
  "This one matches the punch shape your better picks have been landing on.",
  "Your taste tends to reward concrete + tight + a small twist; this has all three.",
];

/** djb2 — same hash family used elsewhere in the codebase for
 *  deterministic rotation. Returns a non-negative 32-bit integer. */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export function composeWhyThisFitsYou(input: WhyThisFitsYouInput): string {
  const cluster = input.voiceClusterId;
  const pool =
    cluster && TEMPLATES_BY_CLUSTER[cluster]
      ? TEMPLATES_BY_CLUSTER[cluster]
      : FALLBACK_TEMPLATES;
  const seedStr = input.scenarioFingerprint ?? input.hook ?? "";
  const idx = djb2(seedStr) % pool.length;
  return pool[idx]!;
}
