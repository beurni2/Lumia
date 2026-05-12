/**
 * PHASE P13-T2 — SLEEP_V1 curated everyday→sleep promotion entries.
 *
 * 8 native-reviewer-stamped (BI-LIGHT-PIDGIN 2026-05-12) Nigerian
 * light-pidgin entries with `domain: "everyday"` whose anchors map to
 * canonical sleep anchors (alarm, pillow, bed, charger, fan, blanket,
 * mosquito, light). Imported as a sibling module in the pattern
 * established by FOOD_V2 / W2-N: the 8 entries are frozen at module
 * load, typed as `NigerianPackEntry`, and concatenated into
 * `NIGERIAN_HOOK_PACK` at the tail by `nigerianHookPack.ts` when the
 * `LUMINA_NG_PACK_ENABLED=true` activation flag is set.
 *
 * SAFETY:
 *   • Every entry below was supplied verbatim by the curator in the
 *     P13-T2 packet — the agent did NOT author, rewrite, improve,
 *     normalize, or substitute hook text, anchor, whatToShow,
 *     howToFilm, caption, pidginLevel, or reviewedBy stamp.
 *   • All 8 entries pass the production `assertNigerianPackIntegrity`
 *     rules (reviewedBy non-empty + not PENDING + not AGENT-PROPOSED,
 *     pidginLevel ∈ {light_pidgin}, anchor in hook AND whatToShow,
 *     length bands, mocking patterns clear, domain non-empty). The
 *     assert runs at boot against the concatenated `NIGERIAN_HOOK_PACK`
 *     so this module's entries are re-validated each load.
 *
 * PURPOSE:
 *   Closes the everyday→sleep topology starvation finding from the
 *   P12-T2 widened-entry audit (only 1 effective sleep entry — `bed`
 *   shared with mornings). Provides 8 everyday-domain entries whose
 *   anchors are canonical sleep anchors, so the T2 projection edge
 *   `everyday → sleep` (gated by LUMINA_NG_PACK_PROJECTION_T2_ENABLED)
 *   has real surface area.
 *
 * DEACTIVATION:
 *   Same gate as the rest of the pack — set `LUMINA_NG_PACK_ENABLED`
 *   to anything other than `"true"` and the live pack is empty,
 *   making this entire module inert. Production `start` script does
 *   NOT set this flag (staging-only).
 */
import { type NigerianPackEntry } from "./nigerianHookPack.js";

export const SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES: readonly NigerianPackEntry[] =
  Object.freeze([
    Object.freeze({
      // SLEEP_V1_001 · sourceDomain: everyday · targetProjection: sleep
      hook: "alarm don shout, my body still dey act deaf",
      whatToShow:
        "Alarm rings beside you while your hand keeps searching for snooze without opening your eyes.",
      howToFilm:
        "Film close on the alarm, then cut to your hand moving lazily under the blanket.",
      caption: "body no hear am",
      anchor: "alarm",
      domain: "everyday",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-12",
    }),
    Object.freeze({
      // SLEEP_V1_002 · sourceDomain: everyday · targetProjection: sleep
      hook: "pillow don sabi all the plans i cancel with my eyes closed",
      whatToShow:
        "Lie on the pillow while ignored messages and missed plans show on your phone.",
      howToFilm:
        "Film from above; show your face half-asleep, then cut to the phone notifications.",
      caption: "pillow kept records",
      anchor: "pillow",
      domain: "everyday",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-12",
    }),
    Object.freeze({
      // SLEEP_V1_003 · sourceDomain: everyday · targetProjection: sleep
      hook: "bed said just lie down, now sun don enter window",
      whatToShow:
        "Sit on the bed for a quick rest, then jump-cut to morning light and panic.",
      howToFilm:
        "Start with shoes still on; hard cut to you waking up confused.",
      caption: "one minute became tomorrow",
      anchor: "bed",
      domain: "everyday",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-12",
    }),
    Object.freeze({
      // SLEEP_V1_004 · sourceDomain: everyday · targetProjection: sleep
      hook: "charger wey dey near bed no get owner once night reach",
      whatToShow:
        "Everyone reaches for the same charger beside the bed while pretending they owned it first.",
      howToFilm:
        "Film hands entering frame from different sides toward the charger.",
      caption: "charger custody battle",
      anchor: "charger",
      domain: "everyday",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-12",
    }),
    Object.freeze({
      // SLEEP_V1_005 · sourceDomain: everyday · targetProjection: sleep
      hook: "fan don stop, sleep don pack bag",
      whatToShow:
        "The fan stops and you wake up instantly, sweating and staring at the ceiling.",
      howToFilm:
        "Start with peaceful sleep, then cut to sudden stillness and your eyes opening.",
      caption: "heat resumed work",
      anchor: "fan",
      domain: "everyday",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-12",
    }),
    Object.freeze({
      // SLEEP_V1_006 · sourceDomain: everyday · targetProjection: sleep
      hook: "blanket don hold me like i owe am",
      whatToShow:
        "Try to get out of bed but keep pulling the blanket back over yourself.",
      howToFilm:
        "Film the repeated attempt to stand; each time the blanket wins.",
      caption: "blanket collected me",
      anchor: "blanket",
      domain: "everyday",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-12",
    }),
    Object.freeze({
      // SLEEP_V1_007 · sourceDomain: everyday · targetProjection: sleep
      hook: "mosquito don sing one note, sleep don resign",
      whatToShow:
        "Try to sleep, hear mosquito buzz near your ear, then sit up like war has started.",
      howToFilm:
        "Use quiet room audio, then add the buzz and your sudden reaction.",
      caption: "night concert started",
      anchor: "mosquito",
      domain: "everyday",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-12",
    }),
    Object.freeze({
      // SLEEP_V1_008 · sourceDomain: everyday · targetProjection: sleep
      hook: "light go off and everybody start breathing like suspect",
      whatToShow:
        "The light goes off at night and everyone pauses, listening and adjusting to the darkness.",
      howToFilm:
        "Cut from lit room to darkness; capture faces frozen for one second.",
      caption: "darkness took attendance",
      anchor: "light",
      domain: "everyday",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI-LIGHT-PIDGIN 2026-05-12",
    }),
  ]);

/** Stable provenance ids matching each entry's curator SLEEP_V1_NNN
 *  id (in source-order). NOT consumed by any runtime selector. */
export const SLEEP_V1_NIGERIAN_PROMOTION_IDS: readonly string[] =
  Object.freeze([
    "SLEEP_V1_001",
    "SLEEP_V1_002",
    "SLEEP_V1_003",
    "SLEEP_V1_004",
    "SLEEP_V1_005",
    "SLEEP_V1_006",
    "SLEEP_V1_007",
    "SLEEP_V1_008",
  ]);
