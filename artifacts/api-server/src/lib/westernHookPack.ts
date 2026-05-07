/**
 * PHASE W2-A — Western/default authored hook pack DARK INFRASTRUCTURE.
 *
 * This module ships the type, the empty draft corpus, the editorial
 * integrity checker, and the controlled vocabularies for a future
 * Western/default authored hook+scenario pack. It does NOT introduce
 * any runtime behavior — there is no slot reservation, no scoring
 * change, no activation guard, no API surface, no Claude touchpoint.
 * The draft corpus is `Object.freeze([])` and remains empty until a
 * separate authoring PR adds entries.
 *
 * Safety model (mirrors the N1 dark-infrastructure precedent):
 *
 *   1. The draft corpus is a SEPARATE constant from any future live
 *      Western pack constant. It cannot be reached by any current
 *      runtime path because no runtime path imports it.
 *   2. The draft type forces `reviewedBy` to the literal sentinel
 *      `PENDING_EDITORIAL_REVIEW`. Promoting a draft to a live pack
 *      would require an editor to overwrite that stamp in the same
 *      PR (and the live-pack integrity check — added in a future
 *      phase — must reject the sentinel for the same reason the
 *      Nigerian boot assert rejects `PENDING_NATIVE_REVIEW`).
 *   3. The integrity checker is exported but NOT called at module
 *      load (because the corpus is empty by construction). The QA
 *      driver and unit tests exercise it against synthetic fixtures.
 *
 * NOT in scope for W2-A (do not add now):
 *   - 150 entries (separate authoring PR)
 *   - Slot reservation
 *   - Scoring changes
 *   - Activation guard
 *   - API / Claude / validator changes
 *   - Migrations
 */

// `PENDING_EDITORIAL_REVIEW` is the draft-layer reviewer sentinel. The
// integrity checker REQUIRES draft rows to carry this exact stamp so
// no agent-authored draft entry can be silently promoted into a live
// pack without an editor overwriting the stamp.
export const PENDING_EDITORIAL_REVIEW = "PENDING_EDITORIAL_REVIEW" as const;

// ---------------------------------------------------------------- //
// Controlled vocabularies                                            //
// ---------------------------------------------------------------- //
//
// These three taxonomies are the editorial scaffolding for the future
// authored corpus — they let the QA report bucket entries and let the
// integrity checker reject typoed/freeform values that would otherwise
// create silent classification drift.

export const WESTERN_COMEDY_FAMILIES = Object.freeze([
  // a hook stating an intent then immediately breaking it
  "self_betrayal",
  // a hook performing denial of the obvious
  "denial_loop",
  // a hook performatively bracing for the dread
  "performative_dread",
  // a hook narrating a small, specific shame
  "tiny_humiliation",
  // a hook treating an inanimate object as a social actor
  "parasocial_object",
  // a hook narrating optimism that is obviously about to fail
  "anxious_optimism",
  // a hook narrating procrastination as theatre
  "procrastination_theatre",
  // a hook escalating a small thing into a catastrophe
  "catastrophizing",
] as const);
export type WesternComedyFamily = (typeof WESTERN_COMEDY_FAMILIES)[number];

export const WESTERN_EMOTIONAL_SPIKES = Object.freeze([
  "shame",
  "dread",
  "glee",
  "despair",
  "defeat",
  "smugness",
  "panic",
  "embarrassment",
] as const);
export type WesternEmotionalSpike =
  (typeof WESTERN_EMOTIONAL_SPIKES)[number];

export const WESTERN_SETTINGS = Object.freeze([
  "bedroom",
  "kitchen",
  "bathroom",
  "desk",
  "couch",
  "car",
  "gym",
  "doorway",
  "mirror",
  "phone",
] as const);
export type WesternSetting = (typeof WESTERN_SETTINGS)[number];

// ---------------------------------------------------------------- //
// Atomic draft entry shape (the 10 user-required fields).            //
// ---------------------------------------------------------------- //

export type WesternHookPackDraftEntry = {
  /** Stable identifier (snake_case + short hash). Author chooses. */
  readonly id: string;
  /** Verbatim hook text. ≤ 120 chars to match `ideaSchema.hook`. */
  readonly hook: string;
  /** Beat-by-beat scene narration. 20–500 chars to match
   *  `ideaSchema.whatToShow`. MUST describe a concrete behavior —
   *  the integrity checker rejects the generic "set X down / stare /
   *  walk away" template that has no behavioral specificity. */
  readonly whatToShow: string;
  /** Concrete filming instructions. 15–400 chars to match
   *  `ideaSchema.howToFilm`. */
  readonly howToFilm: string;
  /** Caption text. 1–280 chars (R-layer region tag may compose on
   *  top via the regionProfile decoration layer in the future). */
  readonly caption: string;
  /** Single lowercase token anchor. Same shape as
   *  `coreDomainAnchorCatalog` anchors. */
  readonly anchor: string;
  /** Coarse comedy bucket — one of `WESTERN_COMEDY_FAMILIES`. */
  readonly comedyFamily: WesternComedyFamily;
  /** Coarse emotional-spike label — one of
   *  `WESTERN_EMOTIONAL_SPIKES`. */
  readonly emotionalSpike: WesternEmotionalSpike;
  /** Coarse setting label — one of `WESTERN_SETTINGS`. */
  readonly setting: WesternSetting;
  /** Editor stamp. For draft rows the type is pinned to the
   *  `PENDING_EDITORIAL_REVIEW` literal so the invariant is enforced
   *  at compile time as well as in the runtime checker. The future
   *  live-pack entry type (out of scope for W2-A) will widen this to
   *  a real reviewer initials+date string and the live-pack
   *  integrity check MUST reject the sentinel. */
  readonly reviewedBy: typeof PENDING_EDITORIAL_REVIEW;
};

// ---------------------------------------------------------------- //
// THE DRAFT CORPUS — empty by construction.                          //
//                                                                    //
// SHIPS EMPTY. Real entries land via a separate authoring PR.        //
// The constant is exported only so the QA driver can read it.        //
// ---------------------------------------------------------------- //

export const WESTERN_HOOK_PACK_DRAFT: readonly WesternHookPackDraftEntry[] =
  Object.freeze([]);

// ---------------------------------------------------------------- //
// Field-length bands — kept in lockstep with `ideaSchema`. Mirrors  //
// the bounds duplicated in `nigerianHookPack.ts` PACK_FIELD_BOUNDS. //
// ---------------------------------------------------------------- //

export const WESTERN_DRAFT_FIELD_BOUNDS = Object.freeze({
  hookMin: 1,
  hookMax: 120,
  whatToShowMin: 20,
  whatToShowMax: 500,
  howToFilmMin: 15,
  howToFilmMax: 400,
  captionMin: 1,
  captionMax: 280,
});

// ---------------------------------------------------------------- //
// Weak banned hook skeletons.                                        //
//                                                                    //
// Curated from the W1.3 ON shipped sample weak families. These are  //
// the shapes the editorial corpus MUST avoid by construction so the  //
// pack does not re-introduce the very templates W1.3+W1.4 are        //
// already demoting at the catalog scoring layer.                     //
// ---------------------------------------------------------------- //

export const WESTERN_DRAFT_WEAK_SKELETON_PATTERNS: ReadonlyArray<{
  readonly id: string;
  readonly pattern: RegExp;
}> = Object.freeze([
  {
    id: "totally_fine_about_anchor",
    pattern: /\bI\s+am\s+totally\s+fine\s+about\s+(?:the|my)\s+\w+/i,
  },
  {
    id: "anchor_knows_im_lying",
    pattern: /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+knows\s+i'?m\s+lying\b/i,
  },
  {
    id: "someone_explain_anchor_now",
    pattern:
      /\bsomeone\s+explain\s+(?:the|my)\s+\w+(?:[-\s]\w+)?\s+to\s+me\.?\s+NOW\b/,
  },
  {
    id: "anchor_won_obviously",
    pattern: /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+won\.?\s+obviously\b/i,
  },
  {
    id: "anchor_itself_became",
    pattern: /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+itself\s+became\b/i,
  },
  {
    id: "anchor_flatlined_my_whole_week",
    pattern:
      /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+flatlined\s+my\s+whole\s+week\b/i,
  },
  {
    id: "body_quit_brain_screaming",
    pattern: /\bmy\s+body\s+quit\.?\s+my\s+brain\s+kept\s+screaming\b/i,
  },
]);

// ---------------------------------------------------------------- //
// Generic "set X down / stare / walk away" scenario detector.       //
//                                                                    //
// A scenario is GENERIC when it describes putting an object down,    //
// staring at it, and walking away — without any concrete second      //
// behavior. The detector requires the lazy-template signature        //
// (set / put / place + stare / look + walk away / leave) to fire.    //
// Single-word matches like "stare" alone are not enough.             //
// ---------------------------------------------------------------- //

const GENERIC_SET_VERB = /\b(?:set|put|place)\s+(?:the|my|it)\b/i;
const GENERIC_STARE_VERB = /\b(?:stare|stares|staring|look|looks|looking)\b/i;
const GENERIC_WALKAWAY_VERB =
  /\b(?:walk(?:s|ing)?\s+away|leave(?:s|ing)?|leaves|left)\b/i;

function isGenericSetStareWalkAwayScenario(whatToShow: string): boolean {
  if (!whatToShow) return false;
  return (
    GENERIC_SET_VERB.test(whatToShow) &&
    GENERIC_STARE_VERB.test(whatToShow) &&
    GENERIC_WALKAWAY_VERB.test(whatToShow)
  );
}

// ---------------------------------------------------------------- //
// Privacy / safety patterns to reject.                               //
//                                                                    //
// Narrow band — the corpus must not invite leakage of real personal  //
// data (real names, real phone numbers, real addresses, real bank /  //
// SSN / credit-card / email). The intent is the same as              //
// FAKE_CHAT_NOTE / FAKE_BANK_NOTE in the N1 drafts — content shown   //
// must be obviously mock. The integrity checker enforces a small set //
// of obvious shapes; the editor remains the primary safety reviewer. //
// ---------------------------------------------------------------- //

const PRIVACY_PATTERNS: ReadonlyArray<{ readonly id: string; readonly pattern: RegExp }> =
  Object.freeze([
    // 9–11 digit unbroken phone-number-like sequences.
    { id: "phone_number_like", pattern: /\b\d{9,11}\b/ },
    // SSN-like 3-2-4 sequence.
    { id: "ssn_like", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
    // 13–19-digit card-number-like.
    { id: "credit_card_like", pattern: /\b\d{13,19}\b/ },
    // Email-shaped string.
    { id: "email_like", pattern: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i },
  ]);

// Local djb2 — same canonical implementation used by neighbouring
// modules. Inlined here to keep this dark-infrastructure module
// dependency-free.
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/**
 * Normalise a hook to a coarse skeleton for near-duplicate detection.
 * Long content tokens (≥5 chars) collapse to `__`; short tokens are
 * kept verbatim. Capped at 24 tokens to avoid runaway strings.
 *
 * Inlined (rather than imported from `catalogTemplateCreatorMemory`)
 * to keep this dark-infrastructure module standalone.
 */
function normalizeDraftHookToSkeleton(hook: string): string {
  if (!hook) return "";
  const cleaned = hook
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .trim();
  if (cleaned.length === 0) return "";
  const tokens = cleaned.split(/\s+/).slice(0, 24);
  return tokens.map((t) => (t.length >= 5 ? "__" : t)).join(" ");
}

// ---------------------------------------------------------------- //
// Detailed integrity-check result. Returned by the checker (rather  //
// than thrown) so the QA driver can render a structured report.    //
// ---------------------------------------------------------------- //

export type WesternDraftIntegrityFailure = {
  readonly id: string | null;
  readonly index: number;
  readonly code: string;
  readonly detail: string;
};

export type WesternDraftIntegrityReport = {
  readonly ok: boolean;
  readonly failures: readonly WesternDraftIntegrityFailure[];
  readonly duplicateHookFingerprints: readonly string[];
  readonly weakSkeletonHits: ReadonlyMap<string, number>;
  readonly lengthFailures: readonly WesternDraftIntegrityFailure[];
  readonly privacyFailures: readonly WesternDraftIntegrityFailure[];
};

function inBand(s: string | undefined, min: number, max: number): boolean {
  if (typeof s !== "string") return false;
  const len = s.trim().length;
  return len >= min && len <= max;
}

function describeBand(name: string, min: number, max: number): string {
  return `${name} length out of band [${min}, ${max}]`;
}

/**
 * Validate the draft corpus. Returns a structured report. An empty
 * corpus is always `ok: true` with no failures (the resting state).
 */
export function checkWesternHookPackDraftIntegrity(
  pack: readonly WesternHookPackDraftEntry[],
): WesternDraftIntegrityReport {
  const failures: WesternDraftIntegrityFailure[] = [];
  const lengthFailures: WesternDraftIntegrityFailure[] = [];
  const privacyFailures: WesternDraftIntegrityFailure[] = [];
  const dupeFingerprints = new Map<string, number>();
  const seenIds = new Set<string>();
  const seenHookExact = new Map<string, number>();
  const seenSkeletons = new Map<string, number>();
  const weakSkeletonHits = new Map<string, number>();

  pack.forEach((entry, index) => {
    const id = entry?.id ?? null;
    const ctx = (code: string, detail: string): WesternDraftIntegrityFailure => ({
      id,
      index,
      code,
      detail,
    });
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      failures.push(ctx("missing_id", "id is required and non-empty"));
    } else if (seenIds.has(id)) {
      failures.push(ctx("duplicate_id", `id '${id}' already used`));
    } else {
      seenIds.add(id);
    }

    const b = WESTERN_DRAFT_FIELD_BOUNDS;
    if (!inBand(entry?.hook, b.hookMin, b.hookMax)) {
      const f = ctx("hook_length", describeBand("hook", b.hookMin, b.hookMax));
      failures.push(f);
      lengthFailures.push(f);
    }
    if (!inBand(entry?.whatToShow, b.whatToShowMin, b.whatToShowMax)) {
      const f = ctx(
        "what_to_show_length",
        describeBand("whatToShow", b.whatToShowMin, b.whatToShowMax),
      );
      failures.push(f);
      lengthFailures.push(f);
    }
    if (!inBand(entry?.howToFilm, b.howToFilmMin, b.howToFilmMax)) {
      const f = ctx(
        "how_to_film_length",
        describeBand("howToFilm", b.howToFilmMin, b.howToFilmMax),
      );
      failures.push(f);
      lengthFailures.push(f);
    }
    if (!inBand(entry?.caption, b.captionMin, b.captionMax)) {
      const f = ctx(
        "caption_length",
        describeBand("caption", b.captionMin, b.captionMax),
      );
      failures.push(f);
      lengthFailures.push(f);
    }

    const anchor = (entry?.anchor ?? "").trim();
    if (anchor.length === 0 || /\s/.test(anchor)) {
      failures.push(
        ctx("anchor_invalid", "anchor must be a single non-empty token"),
      );
    }

    if (!WESTERN_COMEDY_FAMILIES.includes(entry?.comedyFamily as never)) {
      failures.push(
        ctx(
          "comedy_family_invalid",
          `comedyFamily '${String(entry?.comedyFamily)}' not in WESTERN_COMEDY_FAMILIES`,
        ),
      );
    }
    if (
      !WESTERN_EMOTIONAL_SPIKES.includes(entry?.emotionalSpike as never)
    ) {
      failures.push(
        ctx(
          "emotional_spike_invalid",
          `emotionalSpike '${String(entry?.emotionalSpike)}' not in WESTERN_EMOTIONAL_SPIKES`,
        ),
      );
    }
    if (!WESTERN_SETTINGS.includes(entry?.setting as never)) {
      failures.push(
        ctx(
          "setting_invalid",
          `setting '${String(entry?.setting)}' not in WESTERN_SETTINGS`,
        ),
      );
    }

    // Draft rows MUST carry the editorial-review sentinel — promoting
    // a draft to a live pack requires an editor to overwrite this
    // stamp in the same PR.
    if ((entry?.reviewedBy ?? "").trim() !== PENDING_EDITORIAL_REVIEW) {
      failures.push(
        ctx(
          "reviewed_by_invalid",
          `draft rows must carry reviewedBy='${PENDING_EDITORIAL_REVIEW}'`,
        ),
      );
    }

    const hook = entry?.hook ?? "";
    const exactKey = hook.toLowerCase().trim();
    if (exactKey.length > 0) {
      const prev = seenHookExact.get(exactKey);
      if (prev !== undefined) {
        const fp = `exact:${djb2(exactKey).toString(16)}`;
        if (!dupeFingerprints.has(fp)) dupeFingerprints.set(fp, prev);
        failures.push(
          ctx(
            "duplicate_hook_exact",
            `hook duplicates entry at index ${prev}: ${hook.slice(0, 60)}`,
          ),
        );
      } else {
        seenHookExact.set(exactKey, index);
      }
      const skeleton = normalizeDraftHookToSkeleton(hook);
      if (skeleton.length > 0) {
        const prevSk = seenSkeletons.get(skeleton);
        if (prevSk !== undefined) {
          const fp = `skel:${djb2(skeleton).toString(16)}`;
          if (!dupeFingerprints.has(fp)) dupeFingerprints.set(fp, prevSk);
          failures.push(
            ctx(
              "duplicate_hook_skeleton",
              `hook skeleton duplicates entry at index ${prevSk}: ${skeleton.slice(0, 60)}`,
            ),
          );
        } else {
          seenSkeletons.set(skeleton, index);
        }
      }
    }

    for (const w of WESTERN_DRAFT_WEAK_SKELETON_PATTERNS) {
      if (w.pattern.test(hook)) {
        weakSkeletonHits.set(w.id, (weakSkeletonHits.get(w.id) ?? 0) + 1);
        failures.push(
          ctx(
            "weak_banned_skeleton",
            `hook matches banned weak skeleton '${w.id}'`,
          ),
        );
        break;
      }
    }

    for (const p of PRIVACY_PATTERNS) {
      if (p.pattern.test(hook) || p.pattern.test(entry?.whatToShow ?? "")) {
        const f = ctx(
          "privacy_unsafe",
          `entry matches obvious privacy/safety pattern '${p.id}'`,
        );
        failures.push(f);
        privacyFailures.push(f);
        break;
      }
    }

    if (isGenericSetStareWalkAwayScenario(entry?.whatToShow ?? "")) {
      failures.push(
        ctx(
          "generic_object_scenario",
          "whatToShow describes generic 'set object down / stare / walk away' with no second behavior",
        ),
      );
    }
  });

  return {
    ok: failures.length === 0,
    failures,
    duplicateHookFingerprints: [...dupeFingerprints.keys()],
    weakSkeletonHits,
    lengthFailures,
    privacyFailures,
  };
}
