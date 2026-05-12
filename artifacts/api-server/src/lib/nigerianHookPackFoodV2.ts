/**
 * PHASE P10 — FOOD_V2 curated home→food promotion entries.
 *
 * 25 native-reviewer-stamped (BI-LIGHT-PIDGIN 2026-05-11) Nigerian
 * light-pidgin entries with `domain: "home"` whose anchors map to
 * canonical food anchors (plate, fridge, fork, groceries, oven, pan).
 * Imported as a sibling module in the pattern established by W2-N
 * (`westernHookPackBatchNext2.ts`): the 25 entries are frozen at
 * module load, typed as `NigerianPackEntry`, and concatenated into
 * `NIGERIAN_HOOK_PACK` at the tail by `nigerianHookPack.ts` when the
 * `LUMINA_NG_PACK_ENABLED=true` activation flag is set. The existing
 * auto-generated approved pool (`nigerianHookPackApproved.ts`,
 * 231 entries) is NOT modified.
 *
 * INGEST OUTCOME — 25/40 accepted from the V2 curator packet
 * (FOOD_V2_001..040). The agent did NOT author, rewrite, normalize, or
 * substitute any field; the 15 rejected entries were dropped per the
 * "do NOT loosen validators / do NOT creatively repair" P10 standing
 * order and remain available verbatim in `.local/qa-runs/
 * p10_corpus_food_author_import_validation.json` for the next curator
 * pass.
 *
 * REJECTED IDs (kept here for traceability; NOT exported into the
 * live pack — every reason is the production scoreNigerianPackEntry
 * floor of 40 except FOOD_V2_022 which failed validateScenarioCoherence):
 *   • FOOD_V2_003 — score 35 (brevity 13)
 *   • FOOD_V2_005 — score 31 (brevity 9)
 *   • FOOD_V2_008 — score 39 (brevity 17)
 *   • FOOD_V2_010 — score 39 (brevity 17)
 *   • FOOD_V2_012 — score 35 (brevity 13)
 *   • FOOD_V2_015 — score 35 (brevity 13)
 *   • FOOD_V2_017 — score 35 (brevity 13)
 *   • FOOD_V2_021 — score 39 (brevity 17)
 *   • FOOD_V2_022 — validateScenarioCoherence: family_verb_leak_on_scene
 *   • FOOD_V2_024 — score 39 (brevity 17)
 *   • FOOD_V2_027 — score 35 (brevity 9)
 *   • FOOD_V2_034 — score 35 (brevity 13)
 *   • FOOD_V2_036 — score 39 (brevity 17)
 *   • FOOD_V2_037 — score 36 (brevity 9)
 *   • FOOD_V2_040 — score 35 (brevity 13)
 *
 * SAFETY:
 *   • Every accepted entry below was supplied verbatim by the curator
 *     in the P10 V2 packet — the agent did NOT author, rewrite,
 *     improve, normalize, or substitute hook text, anchor, whatToShow,
 *     howToFilm, caption, pidginLevel, or reviewedBy stamp.
 *   • All 25 accepted entries pass the production
 *     `assertNigerianPackIntegrity` rules (reviewedBy non-empty + not
 *     PENDING_NATIVE_REVIEW + not AGENT-PROPOSED, pidginLevel ∈
 *     {light_pidgin,pidgin}, anchor in hook AND whatToShow, length
 *     bands, mocking patterns clear, domain non-empty). The assert
 *     runs at boot against the concatenated `NIGERIAN_HOOK_PACK` so
 *     this module's entries are re-validated each load.
 *   • All 25 accepted entries pass the production
 *     `scoreNigerianPackEntry ≥ 40` ingest floor and
 *     `validateScenarioCoherence` (verified by the P10
 *     import-validation harness in
 *     `.local/scripts/p10CorpusFoodImportValidation.mts`).
 *
 * PURPOSE:
 *   Materially resolves the home→food structural-starvation finding
 *   from the P9 audit (only 1 strict home-domain food-eligible entry
 *   existed). Provides 25 home-domain entries whose anchors map to
 *   canonical food anchors so the T2 projection edge `home → food`
 *   (gated by `LUMINA_NG_PACK_PROJECTION_T2_ENABLED`) has real
 *   surface area.
 *
 * DEACTIVATION:
 *   Same gate as the rest of the pack — set `LUMINA_NG_PACK_ENABLED`
 *   to anything other than `"true"` and the live pack is empty,
 *   making this entire module inert. Production `start` script does
 *   NOT set this flag (staging-only).
 */
import { type NigerianPackEntry } from "./nigerianHookPack.js";

export const FOOD_V2_NIGERIAN_PROMOTION_CANDIDATES: readonly NigerianPackEntry[] =
  Object.freeze([
    Object.freeze({
      // source: FOOD_V2_001 · sourceDomain: home · targetProjection: food
      hook: "fridge light catch me but na water i dey pretend to find",
      whatToShow: "Open the fridge at night, freeze under the fridge light, then pick up water first like that was the plan.",
      howToFilm: "Film beside the fridge door; show the guilty pause, the fake water reach, then the real hand going back in.",
      caption: "na water, allegedly",
      anchor: "fridge",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_002 · sourceDomain: home · targetProjection: food
      hook: "plate small but my hunger no get manners",
      whatToShow: "Hold a small plate like you are being disciplined, then slowly overload the plate while acting innocent.",
      howToFilm: "Use overhead jump cuts as the plate grows; end with your face pretending the portion is still normal.",
      caption: "hunger no hear word",
      anchor: "plate",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_004 · sourceDomain: home · targetProjection: food
      hook: "groceries full counter but who wan cook now",
      whatToShow: "Show groceries sitting fresh on the counter while everybody keeps passing them and asking what to eat.",
      howToFilm: "Keep the camera fixed on the groceries; let people enter, stare, sigh, and walk away.",
      caption: "ingredients no be dinner",
      anchor: "groceries",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_006 · sourceDomain: home · targetProjection: food
      hook: "oven beep and my confidence say abeg ask adult",
      whatToShow: "The oven beeps, and you stand there unsure whether the food is ready or about to disgrace you.",
      howToFilm: "Film the oven display, then your face, then your hand reaching and pulling back twice.",
      caption: "adult needed",
      anchor: "oven",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_007 · sourceDomain: home · targetProjection: food
      hook: "fridge empty but i still bend like food dey hide",
      whatToShow: "Search an empty fridge with full seriousness, moving containers like food may appear by pressure.",
      howToFilm: "Shoot from behind the open fridge door; repeat one shelf check to make the desperation obvious.",
      caption: "maybe e hide",
      anchor: "fridge",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_009 · sourceDomain: home · targetProjection: food
      hook: "fork dey visit my side like rent is cheap",
      whatToShow: "Someone\u2019s fork keeps crossing into your plate while they pretend nothing is happening.",
      howToFilm: "Film table-level; show the fork creeping closer, then your hand slowly building protection.",
      caption: "respect boundary abeg",
      anchor: "fork",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_011 · sourceDomain: home · targetProjection: food
      hook: "pan hot already but my brain never resume",
      whatToShow: "Heat the pan too early, then rush around realizing nothing is prepared.",
      howToFilm: "Film the pan waiting on heat, then quick cuts of you searching and pretending this was planned.",
      caption: "heat came first",
      anchor: "pan",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_013 · sourceDomain: home · targetProjection: food
      hook: "fridge open and my diet plan just keep quiet",
      whatToShow: "Open the fridge after promising discipline, stare for one second, then reach in like the promise never happened.",
      howToFilm: "Start with you looking determined, then use a quick cut to the fridge door opening and your discipline collapsing.",
      caption: "diet no talk",
      anchor: "fridge",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_014 · sourceDomain: home · targetProjection: food
      hook: "plate nearly empty but i still dey explain small taste",
      whatToShow: "Show an almost empty plate while you insist you only tasted a little.",
      howToFilm: "Start close on the plate evidence, then tilt to your face giving a weak explanation.",
      caption: "evidence too loud",
      anchor: "plate",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_016 · sourceDomain: home · targetProjection: food
      hook: "groceries for the week but the house hear today today",
      whatToShow: "Show groceries meant to last the week slowly reducing because everyone keeps taking little pieces.",
      howToFilm: "Use before-and-after counter shots with different hands entering frame and acting innocent.",
      caption: "week plan crashed",
      anchor: "groceries",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_018 · sourceDomain: home · targetProjection: food
      hook: "oven timer shout but the food still dey learn work",
      whatToShow: "The oven timer goes off, but the food still looks unfinished when you check.",
      howToFilm: "Show the timer, peek inside the oven, then cut to your tired disappointed stare.",
      caption: "still on training",
      anchor: "oven",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_019 · sourceDomain: home · targetProjection: food
      // P14-NG-LP-TASTE-V1 packet REJECTED for this entry: the proposed
      // hook ("fridge just make one krr sound, i start explaining
      // myself") scored 34 on `scoreNigerianPackEntry` against the
      // pool ctx — below the 40 ingest/regression floor. Per standing
      // packet rule "Rewritten entries remain validator-safe" + agent
      // rule "do NOT loosen validators / do NOT creatively repair /
      // do NOT substitute", the entry retains its prior (P13) rewrite
      // verbatim (scores 56).
      hook: "fridge just make small sound, i don confess before anybody ask",
      whatToShow: "The fridge makes a normal noise while you are sneaking food, and you immediately start explaining to nobody.",
      howToFilm: "Film at night near the fridge; when the sound happens, freeze and whisper your excuse into the air.",
      caption: "guilty by appliance",
      anchor: "fridge",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_020 · sourceDomain: home · targetProjection: food
      hook: "plate clean pass my story",
      whatToShow: "Hold a spotless plate while trying to deny that you finished the food.",
      howToFilm: "Start on the clean plate, then tilt up to your face trying not to laugh.",
      caption: "story weak",
      anchor: "plate",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_023 · sourceDomain: home · targetProjection: food
      hook: "pan dey smell correct but taste no follow meeting",
      whatToShow: "The pan smells promising, but your first taste makes you pause like something is missing.",
      howToFilm: "Film proud stirring, then the taste test, then one long silent look at the pan.",
      caption: "aroma passed alone",
      anchor: "pan",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_025 · sourceDomain: home · targetProjection: food
      // P14-NG-LP-TASTE-V1 packet REJECTED for this entry: the proposed
      // hook ("fridge get leftover, suddenly everybody remember their
      // ownership") clears the 40-point ingest floor (45) but scores
      // notably lower than the prior P13 form (57). Empirically this
      // tipped the per-core best-pick at the projection-T2 test salt
      // (cores[0..6], salt=17, light_pidgin) so that no pack candidate
      // wins any core — collapsing the projection-T2 "≥1 pack winner"
      // invariant from positive to zero. Per standing packet rule
      // "Rewritten entries remain validator-safe" + agent rule "do
      // NOT loosen validators / do NOT creatively repair / do NOT
      // substitute", the entry retains its prior (P13) rewrite
      // verbatim.
      hook: "fridge get leftover, the house don enter court session",
      whatToShow: "Open the fridge to leftovers and everyone starts arguing ownership, timing, and who saw it first.",
      howToFilm: "Play quick character cuts around the open fridge, with each person giving a serious claim.",
      caption: "leftover court",
      anchor: "fridge",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_026 · sourceDomain: home · targetProjection: food
      hook: "plate reach sink and everybody memory just travel",
      whatToShow: "Show one dirty plate in the sink while everyone denies using it with too much confidence.",
      howToFilm: "Film the plate first, then cut to each person acting shocked like the plate entered by itself.",
      caption: "memory travelled",
      anchor: "plate",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_028 · sourceDomain: home · targetProjection: food
      hook: "groceries dey counter since morning and i dey greet them like neighbor",
      whatToShow: "Walk past groceries you promised to cook and keep acknowledging them without doing anything.",
      howToFilm: "Fixed counter shot; pass by three times with small nods, fake busyness, and no cooking.",
      caption: "good evening ingredients",
      anchor: "groceries",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_029 · sourceDomain: home · targetProjection: food
      hook: "pan hear medium heat and still choose wahala",
      whatToShow: "Set the pan to medium heat but it starts acting too dramatic too quickly.",
      howToFilm: "Show the knob setting, then the pan misbehaving, then your confused face checking the knob again.",
      caption: "medium wahala",
      anchor: "pan",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_030 · sourceDomain: home · targetProjection: food
      hook: "oven dey preheat while i dey pre-confuse",
      whatToShow: "Stand near the preheating oven reading instructions with false confidence.",
      howToFilm: "Cut between the oven display, your confused reading face, and one fake confident nod.",
      caption: "pre-confusion stage",
      anchor: "oven",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_031 · sourceDomain: home · targetProjection: food
      // P14-NG-LP-TASTE-V1 packet REJECTED for this entry: the proposed
      // hook ("fridge open for water, next thing my hand don carry
      // meat") clears the 40-point ingest floor (67) but scores lower
      // than the prior P13 form (77), contributing alongside the
      // FOOD_V2_025 score drop to the projection-T2 invariant
      // collapse (≥1 pack winner across cores[0..6] at salt=17 ON →
      // zero). Per standing packet rule "Rewritten entries remain
      // validator-safe" + agent rule "do NOT loosen validators / do
      // NOT creatively repair / do NOT substitute", the entry retains
      // its prior (P13) rewrite verbatim.
      hook: "fridge open na for water, but my hand don carry evidence",
      whatToShow: "Open the fridge saying you want water, then come back holding extra food.",
      howToFilm: "Film the promise before opening, then cut to your hand coming out with more than water.",
      caption: "water plus agenda",
      anchor: "fridge",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_032 · sourceDomain: home · targetProjection: food
      // P14-NG-LP-TASTE-V1 packet REJECTED for this entry: the proposed
      // hook ("small taste no suppose clear plate like this") scored
      // 37 on `scoreNigerianPackEntry` against the pool ctx — below the
      // 40 ingest/regression floor. Per standing packet rule
      // "Rewritten entries remain validator-safe" + agent rule "do NOT
      // loosen validators / do NOT creatively repair / do NOT
      // substitute", the entry retains its prior (P13) rewrite
      // verbatim.
      hook: "plate don expose me, small taste no suppose reach corner",
      whatToShow: "Show a plate that clearly has been attacked even though you claimed it was only one small taste.",
      howToFilm: "Close-up on the plate marks, then cut to your guilty face trying to defend it.",
      caption: "taste went far",
      anchor: "plate",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_033 · sourceDomain: home · targetProjection: food
      hook: "fork dey innocent but best piece just disappear",
      whatToShow: "The fork sits near the food while the best piece disappears and everyone acts confused.",
      howToFilm: "Film a fake crime scene: the fork, the empty spot, then innocent faces looking away.",
      caption: "no suspect",
      anchor: "fork",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_035 · sourceDomain: home · targetProjection: food
      // P14-NG-LP-TASTE-V1 packet REJECTED for this entry: the proposed
      // hook ("kitchen smell like success, food still dey taste
      // confused") drops the anchor token "pan", which would break the
      // boot-time `anchor in hook` integrity assert. Per standing
      // packet rule "Preserve: anchor" + agent rule "do NOT loosen
      // validators / do NOT creatively repair / do NOT substitute",
      // the entry retains its prior (P13) rewrite verbatim.
      hook: "pan don smell finish, but food no carry evidence",
      whatToShow: "The pan smells good, but the actual food result does not look as impressive.",
      howToFilm: "Film yourself smelling proudly, then reveal the pan result and let your smile reduce slowly.",
      caption: "aroma did PR",
      anchor: "pan",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_038 · sourceDomain: home · targetProjection: food
      hook: "plate dey wait since but cook keep saying almost done",
      whatToShow: "An empty plate waits on the table while the cook keeps promising the food is almost done.",
      howToFilm: "Cut between the lonely plate and the cook doing things that do not look close to finished.",
      caption: "almost has landlord",
      anchor: "plate",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
    Object.freeze({
      // source: FOOD_V2_039 · sourceDomain: home · targetProjection: food
      hook: "groceries start as plan and end as everybody sample",
      whatToShow: "Show groceries slowly reduced by different people taking tiny samples and denying impact.",
      howToFilm: "Use close-ups of hands taking bits; end with the groceries looking attacked and everyone acting normal.",
      caption: "sample committee",
      anchor: "groceries",
      domain: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-11",
    }),
  ]);

/** Stable provenance ids matching each accepted entry's original
 *  curator FOOD_V2_NNN id (in source-order). The 15 rejected ids
 *  (003, 005, 008, 010, 012, 015, 017, 021, 022, 024, 027, 034, 036,
 *  037, 040) are documented in the leading file comment and kept in
 *  the QA artifact at `.local/qa-runs/p10_corpus_food_author_import_validation.json`.
 *  NOT consumed by any runtime selector. */
export const FOOD_V2_NIGERIAN_PROMOTION_IDS: readonly string[] = Object.freeze([
  "FOOD_V2_001",
  "FOOD_V2_002",
  "FOOD_V2_004",
  "FOOD_V2_006",
  "FOOD_V2_007",
  "FOOD_V2_009",
  "FOOD_V2_011",
  "FOOD_V2_013",
  "FOOD_V2_014",
  "FOOD_V2_016",
  "FOOD_V2_018",
  "FOOD_V2_019",
  "FOOD_V2_020",
  "FOOD_V2_023",
  "FOOD_V2_025",
  "FOOD_V2_026",
  "FOOD_V2_028",
  "FOOD_V2_029",
  "FOOD_V2_030",
  "FOOD_V2_031",
  "FOOD_V2_032",
  "FOOD_V2_033",
  "FOOD_V2_035",
  "FOOD_V2_038",
  "FOOD_V2_039",
]);
