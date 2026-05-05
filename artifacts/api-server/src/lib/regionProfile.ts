/**
 * PHASE R1 — DETERMINISTIC REGIONAL BASELINE
 *
 * Minimal region-aware decoration layer. The deterministic ideator
 * core (cohesiveIdeaAuthor → coreCandidateGenerator) authors a base
 * idea using the existing English templates; THIS module adds light
 * region-flavored copy to three free-text fields AFTER all
 * comedy / anti-copy / scenarioCoherence validators have already
 * passed on the BASE idea, so the decoration can never CAUSE a
 * rejection.
 *
 * Decorated fields (the only three with no anchor / contradiction
 * positional constraint downstream):
 *
 *   - `caption`     — append a short region-flavor tag (≤140 cap)
 *   - `howToFilm`   — append an "Optional context:" line     (≤400 cap)
 *   - `whyItWorks`  — append a one-line region addendum      (≤280 cap)
 *
 * Hook, premise, whatToShow, shotPlan, trigger, reaction stay
 * BYTE-IDENTICAL to the pre-R1 western baseline. Western region
 * always bypasses this module (`region === "western"` → identity)
 * so the existing 20/20 western quality bar carries through unchanged.
 *
 * Hard safety contract for ALL decoration text in this file
 * (hand-vetted against the validators that scan rendered surfaces):
 *
 *   1. NEVER use a stiff family verb (abandon|ghost|fake|spiral|
 *      overthink|perform|expose) followed by a pronoun (it|me|
 *      myself|yourself|...) — would trip `family_verb_leak_on_scene`
 *      in `scenarioCoherence.ts`.
 *
 *   2. NEVER use placeholder phrases ("lean into the X beat", "the
 *      X lands here", "let the props carry the deadpan", "end beat:")
 *      — `placeholder_filming_phrase` rule.
 *
 *   3. NEVER apply a physical verb (set|pick|dodge|move|drop|grab|
 *      toss|throw|push|kick|carry|hold) + adverb (up|down|away|
 *      over|out|aside) to an abstract anchor token —
 *      `impossible_physical_action_on_abstract` rule.
 *
 *   4. NEVER use any of the META_TEMPLATE_SIGNATURES patterns
 *      ("Beat 1: glance / Beat 2: shrug", "pick X up, put it back",
 *      "knows i'm faking it", "confessed to X. then Y myself",
 *      "hesitate, end on your face mid-realization").
 *
 *   5. Keep decoration text plain English noun phrases + adjectives.
 *      No new verb constructions on the anchor. No dialect tokens
 *      (Pidgin / Hinglish / Tagalog) unless they are a single
 *      universally-recognized loanword (e.g. "barkada", "chai",
 *      "danfo") used in a noun-phrase position only.
 *
 *   6. No stereotyping. No assumptions about religion, politics, or
 *      identity. Conservative local context only — daily-life
 *      logistics (commute / data / group chat / food delivery).
 *
 * Western unchanged. Region defaults to `"western"` upstream
 * (`routes/ideator.ts` resolves missing region to "western"), so
 * cold-start creators see byte-identical pre-R1 behavior.
 *
 * No Claude. No DB. No API change. No migration.
 */

import type { Region } from "@workspace/lumina-trends";
import type { CanonicalDomain } from "./coreDomainAnchorCatalog.js";
import type { Idea } from "./ideaGen.js";
import type { VoiceClusterId } from "./voiceClusters.js";

// ---------------------------------------------------------------- //
// PHASE R4 — Regional voice-cluster sampling bias                  //
// ---------------------------------------------------------------- //
//
// Conservative additive +slot weights per (region, voice cluster).
// Applied AFTER the existing baseline (2 slots) + family-default
// (+1) + tone-pin (+5) entries are pushed into resolveVoiceCluster's
// `biasedTable`. Western entry is intentionally empty `{}` so the
// table is byte-identical to pre-R4 for western/undefined creators.
//
// Design constraints:
//  - Use existing 5 voice clusters only (no new clusters).
//  - Conservative bonuses (+1 or +2) so no region collapses into
//    a single voice; baseline 2-slot + family +1 + tone +5 still
//    dominate. With a +2/+1 region nudge the dominant cluster
//    becomes ~25-30% (vs ~22% baseline) — visible but never
//    monoculture.
//  - Cold-start (no tone) creators in non-western regions feel a
//    small regional rhythm shift; tone-pinned creators are largely
//    unaffected because the +5 tone bonus still dwarfs the +1/+2
//    region bonus.
//  - Reversible: change any number to 0 and the region reverts.
//  - Acceptance: no region drops a cluster to 0 entries; the +2
//    region clusters never beat a +5 tone-pinned cluster.

// ---------------------------------------------------------------- //
// PHASE R2 — Claude fallback regional prompt polish                //
// ---------------------------------------------------------------- //
//
// Per-region guidance string injected into the Claude system prompt
// AFTER the generic "Region authenticity" line in `ideaGen.ts`. The
// existing line tells Claude to "code-switch to natural slang" — for
// non-western regions we follow with a softer, anti-stereotype block
// that says: keep base English; use light regional context (group
// chats, transport, food, family); avoid forced Pidgin/Hinglish/
// Taglish unless the user has explicitly opted in via a language-
// style preference; redact private screen content.
//
// Western entry is `""` (empty string) so L1058's existing language
// instruction is preserved verbatim — western quality bar untouched.
//
// Claude remains FALLBACK ONLY (hybridIdeator only triggers
// generateIdeas when fewer than 3 local candidates clear the
// scorer). All Claude output continues to flow through the same
// validators (ideaSchema + comedy + scenarioCoherence + anti-copy)
// so this prompt change can never loosen acceptance gates.
//
// Rollback path: replace any region's string with `""` to revert
// that region's fallback prompt to the pre-R2 baseline.

export const REGION_PROMPT_GUIDANCE: Record<Region, string> = {
  western: "",

  nigeria: [
    "REGION CONTEXT — Nigeria (clean English with light Nigerian grounding):",
    "  • DEFAULT TO CLEAN ENGLISH. Do NOT force heavy Pidgin or 'abeg'/'omo'/'wahala' unless the creator's profile explicitly asks for it. Light Pidgin in 1 of every 4-5 hooks is fine; saturating every hook reads as caricature.",
    "  • Local daily-life context the audience recognises: WhatsApp group plans, transport stress (danfo / okada / ride-hailing fare drama), data subscription / phone reception realities, market or errand runs, family + social pressure (cousin's wedding, aunt's calls), school / work hustle, home cooking + food situations.",
    "  • AVOID lazy stereotypes — overusing auntie / uncle stock characters, NEPA / 'light just took' jokes, 'Nigerian time' clichés. If a Lagos creator has heard the joke a hundred times this week, skip it.",
    "  • SAFETY — for any chat / app / bank / screen idea, instruct fake or demo screens, cropped frames, no real account balances, names, or messages.",
    "  • Filming reality — most micro-creators shoot on a single phone in a small room or while on the move; keep instructions executable in <30 minutes with no extra crew.",
  ].join("\n"),

  india: [
    "REGION CONTEXT — India (clean English with light Indian grounding):",
    "  • DEFAULT TO CLEAN ENGLISH. Do NOT force heavy Hinglish or sprinkle 'bhai' / 'yaar' / 'bro' into every hook unless the creator's profile explicitly asks for it. Light Hinglish in 1 of every 4-5 hooks is fine; over-using it reads as caricature.",
    "  • Local daily-life context the audience recognises: family group chats, college or work deadlines, commute (metro / local train / autorickshaw / Ola-Uber traffic), exams + study marathons, hostel / roommate / PG situations, food delivery (Swiggy / Zomato cart guilt), chai-break beats, family expectations on calls.",
    "  • AVOID caricature — Bollywood references on autopilot, forced 'bhai', stale aunty stereotypes. Specific > generic.",
    "  • SAFETY — fake or demo screens for chats / payments / private app data; no real UPI handles or balances.",
    "  • Filming reality — most micro-creators shoot on a single phone in a small room; keep instructions executable in <30 minutes solo.",
  ].join("\n"),

  philippines: [
    "REGION CONTEXT — Philippines (clean English with light Filipino grounding):",
    "  • DEFAULT TO CLEAN ENGLISH. Do NOT force heavy Taglish or sprinkle 'bes' / 'lodi' / 'sana all' into every hook unless the creator's profile explicitly asks for it. Light Taglish in 1 of every 4-5 hooks is fine; over-using it reads as caricature.",
    "  • Local daily-life context the audience recognises: barkada group chats, commute (jeepney / MRT / heavy traffic), food delivery (foodpanda / GrabFood cart guilt), GCash / phone load realities, family plans, school / work tasks, roommate / condo home situations, weekend social plans.",
    "  • AVOID forced slang or stereotype — 'sana all' on every video, generic 'tita' jokes, lazy beauty-queen references.",
    "  • SAFETY — fake or demo screens for chats / payments / private app data; no real GCash balances or contact lists.",
    "  • Filming reality — most micro-creators shoot on a single phone in a small room; keep instructions executable in <30 minutes solo.",
  ].join("\n"),
};

export const REGION_VOICE_BIAS: Record<
  Region,
  Partial<Record<VoiceClusterId, number>>
> = {
  // Western: empty — preserves byte-identical biased table for the
  // current 20/20 quality bar. Cold-start default region from
  // routes/ideator.ts L83 also lands here, so cold-start creators
  // are unchanged.
  western: {},

  // Nigeria: slightly more chaotic_confession + overdramatic_reframe.
  // Keep dry_deadpan + quiet_realization + high_energy_rant available
  // (no negative weights — only additive).
  nigeria: {
    chaotic_confession: 2,
    overdramatic_reframe: 1,
  },

  // India: slightly more quiet_realization + overdramatic_reframe +
  // dry_deadpan. Keep chaotic_confession available.
  india: {
    quiet_realization: 2,
    overdramatic_reframe: 1,
    dry_deadpan: 1,
  },

  // Philippines: slightly more chaotic_confession + quiet_realization
  // + dry_deadpan. Keep overdramatic available.
  philippines: {
    chaotic_confession: 2,
    quiet_realization: 1,
    dry_deadpan: 1,
  },
};

// ---------------------------------------------------------------- //
// Public types                                                      //
// ---------------------------------------------------------------- //

export type RegionProfile = {
  region: Region;
  /** Per-domain optional appended `howToFilm` context. Single line,
   *  hand-vetted to comply with the safety contract above. Domains
   *  with no entry receive no decoration on this surface. */
  filmingContextByDomain: Partial<Record<CanonicalDomain, string>>;
  /** Per-domain optional appended `caption` suffix. Short tag in
   *  parentheses; ≤30 chars to leave headroom under the 140 cap.
   *  All-lowercase to match the existing caption voice. */
  captionSuffixByDomain: Partial<Record<CanonicalDomain, string>>;
  /** Per-domain optional appended `whyItWorks` sentence. One short
   *  clause; ≤80 chars to leave headroom under the 280 cap. */
  whyAddendumByDomain: Partial<Record<CanonicalDomain, string>>;
  /** Reference list of safe daily-life anchors for this region. Not
   *  consumed by decoration today — kept in this file as the
   *  documentation surface for future R3 (region-tagged anchor
   *  catalog) so the noun set is co-located with the decoration. */
  safeDailyAnchors: readonly string[];
  /** Reference list of safe filming-context tropes (noun phrases
   *  only) for this region. Not consumed by decoration today —
   *  reserved for R3 fall-through path when no per-domain entry
   *  matches. */
  comfortFilmingContexts: readonly string[];
  /** Documentary-only list of stereotypes to AVOID. Not consumed
   *  programmatically; every entry below in this file's other
   *  fields was hand-checked against this list. */
  avoidStereotypes: readonly string[];
};

// ---------------------------------------------------------------- //
// Region profiles                                                   //
// ---------------------------------------------------------------- //
//
// Decoration text is conservative by design. Daily-life logistics
// only. No religion / politics / identity. No heavy slang.
//
// `western` is the identity: empty maps. The decorate function
// short-circuits on `region === "western"` so this is documentation,
// not a code path.

const WESTERN_PROFILE: RegionProfile = {
  region: "western",
  filmingContextByDomain: {},
  captionSuffixByDomain: {},
  whyAddendumByDomain: {},
  safeDailyAnchors: [
    "group chat",
    "calendar",
    "couch",
    "fridge",
    "Trader Joe's run",
    "drive-thru",
    "Zoom",
    "parking lot",
  ],
  comfortFilmingContexts: [],
  avoidStereotypes: [],
};

const NIGERIA_PROFILE: RegionProfile = {
  region: "nigeria",
  filmingContextByDomain: {
    social:
      "Optional context: a real WhatsApp group on the screen works if you blur the names.",
    phone:
      "Optional context: a fake low-data notification on the screen lands the moment.",
    work:
      "Optional context: shoot it during the Lagos commute window — desk arrival or pre-standup.",
    mornings:
      "Optional context: the early NEPA flicker or generator-on moment doubles as the open.",
    food:
      "Optional context: a buka pack on the counter or jollof leftovers in the frame grounds it.",
    money:
      "Optional context: a fake bank-alert overlay lands the beat — never use a real balance.",
    home:
      "Optional context: ambient generator hum or ceiling-fan light cycling reads as home.",
    study:
      "Optional context: a notebook with WAEC / project notes visible grounds the scene.",
    dating:
      "Optional context: a faked 'how far?' chat preview reads as the trigger.",
    fitness:
      "Optional context: an early-morning street jog before the heat reads native.",
  },
  captionSuffixByDomain: {
    social: " (group chat era)",
    phone: " (data finished energy)",
    work: " (Lagos commute saga)",
    mornings: " (NEPA witness moment)",
    food: " (buka run aftermath)",
    money: " (alert anxiety)",
    home: " (gen-on hours)",
    study: " (WAEC pressure era)",
    dating: " (how-far chronicles)",
  },
  whyAddendumByDomain: {
    social:
      "Hits Lagos creators where the WhatsApp group runs the calendar.",
    phone: "Lands for creators stretching one data sub across a week.",
    work: "Commute creators recognise the desk-arrival exhale instantly.",
    mornings:
      "The NEPA-flicker open is a shared morning beat across the south.",
    food: "Buka and jollof references read as 'me' to home cooks.",
    money: "Bank-alert anxiety is a universal Lagos beat.",
    home: "Gen-on hours land for anyone juggling power and content.",
    study: "Reads native to anyone who survived WAEC season.",
    dating: "The 'how far?' message is the universal soft-launch.",
  },
  safeDailyAnchors: [
    "WhatsApp group",
    "transport stress",
    "data subscription",
    "NEPA flicker",
    "market errand",
    "auntie call",
    "buka run",
    "bank alert",
    "danfo queue",
    "okada beat",
  ],
  comfortFilmingContexts: [
    "blurred WhatsApp group screen",
    "fake bank-alert overlay",
    "ceiling fan in frame",
    "doorway with generator hum off-camera",
  ],
  avoidStereotypes: [
    "lazy auntie / uncle punchlines",
    "mocking pidgin spelling",
    "generic 'NEPA took light' as a punchline (use as ambient, not joke)",
    "any tribal / religious / political framing",
    "scammer / yahoo tropes",
  ],
};

const INDIA_PROFILE: RegionProfile = {
  region: "india",
  filmingContextByDomain: {
    social:
      "Optional context: a faked family or college group-chat preview lands the trigger.",
    phone:
      "Optional context: a fake recharge / data-low notification reads as the moment.",
    work:
      "Optional context: shoot during the WFH chai break or right after the standup.",
    mornings:
      "Optional context: the metro / local-train rush or one-sock standup beat opens it.",
    food:
      "Optional context: a Swiggy or Zomato cart on the screen grounds the frame.",
    money:
      "Optional context: a fake UPI-ping overlay lands the beat — never show a real balance.",
    home:
      "Optional context: hostel / PG / family-living-room ambient framing reads native.",
    study:
      "Optional context: open notebook with placement / semester notes in the lower third.",
    dating:
      "Optional context: a faked chat preview that says nothing reads as the trigger.",
    fitness:
      "Optional context: a society-gym or morning-park-walk frame keeps it grounded.",
  },
  captionSuffixByDomain: {
    social: " (group chat saga)",
    phone: " (recharge anxiety)",
    work: " (WFH chai era)",
    mornings: " (metro rush witness)",
    food: " (Swiggy cart guilt)",
    money: " (UPI-ping anxiety)",
    home: " (hostel mood)",
    study: " (sem pressure era)",
    dating: " (vague chat era)",
  },
  whyAddendumByDomain: {
    social:
      "Hits hard for anyone whose family group chat is the daily calendar.",
    phone:
      "Recharge / data anxiety reads as 'me' across every metro creator.",
    work: "WFH chai-break creators see themselves immediately.",
    mornings:
      "The metro / local rush beat is the universal Mumbai / Delhi open.",
    food: "Swiggy cart guilt is a shared late-night beat.",
    money: "UPI-ping anxiety is the new generation's bank-alert.",
    home: "Hostel / PG framings read native to lakhs of college creators.",
    study: "Sem / placement pressure lands for current students instantly.",
    dating: "The vague chat that meant nothing is universally relatable.",
  },
  safeDailyAnchors: [
    "family group chat",
    "metro commute",
    "local train",
    "Swiggy cart",
    "UPI ping",
    "hostel roommate",
    "WFH chai",
    "society gym",
    "placement deadline",
    "auto fare",
  ],
  comfortFilmingContexts: [
    "faked family group-chat preview",
    "Swiggy / Zomato cart on screen",
    "fake UPI-ping overlay",
    "hostel desk with notes visible",
    "society-gym mirror frame",
  ],
  avoidStereotypes: [
    "lazy 'arranged marriage' punchlines",
    "mocking Hinglish accents",
    "auntie / uncle as the only joke",
    "any caste / religion / politics framing",
    "stereotyped 'Indian parent' tropes",
  ],
};

const PHILIPPINES_PROFILE: RegionProfile = {
  region: "philippines",
  filmingContextByDomain: {
    social:
      "Optional context: a faked barkada Messenger thread on the screen lands the trigger.",
    phone:
      "Optional context: a fake low-load / signal-cut notification reads as the moment.",
    work:
      "Optional context: shoot it on the MRT / jeep commute or right after a sari-sari run.",
    mornings:
      "Optional context: the jeep / MRT rush or commute-prep beat opens it native.",
    food:
      "Optional context: a Grab Food cart on the screen or ulam tupperware in frame works.",
    money:
      "Optional context: a fake GCash-ping overlay lands the beat — never show a real balance.",
    home:
      "Optional context: kapitbahay / family-living-room ambient framing reads native.",
    study:
      "Optional context: open notebook with thesis or exam-week notes in the lower third.",
    dating:
      "Optional context: a faked chat preview that says nothing reads as the trigger.",
    fitness:
      "Optional context: an early-morning park walk or condo-gym frame keeps it grounded.",
  },
  captionSuffixByDomain: {
    social: " (barkada chat era)",
    phone: " (low-load mood)",
    work: " (commute saga)",
    mornings: " (jeep rush witness)",
    food: " (Grab Food guilt)",
    money: " (GCash-ping anxiety)",
    home: " (condo / kapitbahay mood)",
    study: " (thesis week era)",
    dating: " (vague chat era)",
  },
  whyAddendumByDomain: {
    social:
      "Hits hard for creators whose barkada chat IS the social calendar.",
    phone: "Low-load anxiety reads as 'me' across every Manila creator.",
    work: "MRT / jeep commute creators see themselves immediately.",
    mornings:
      "The jeep rush open is the universal Metro Manila morning.",
    food: "Grab Food cart guilt is a shared late-night beat.",
    money: "GCash-ping anxiety is the universal mobile-money beat.",
    home: "Condo / kapitbahay ambient frames read native instantly.",
    study: "Thesis / exam pressure lands for current students.",
    dating: "The vague chat that meant nothing is universally relatable.",
  },
  safeDailyAnchors: [
    "barkada chat",
    "MRT commute",
    "jeep ride",
    "Grab Food cart",
    "GCash ping",
    "thesis week",
    "kapitbahay",
    "sari-sari run",
    "ulam plan",
    "load top-up",
  ],
  comfortFilmingContexts: [
    "faked barkada Messenger thread on screen",
    "Grab Food cart on screen",
    "fake GCash-ping overlay",
    "ulam tupperware in frame",
    "condo balcony or jeep window frame",
  ],
  avoidStereotypes: [
    "mocking Tagalog / Bisaya accents",
    "lazy 'kapamilya drama' punchlines",
    "OFW / domestic-worker tropes as punchline",
    "any religion / politics framing",
    "colorism or class-based jokes",
  ],
};

export const REGION_PROFILES: Record<Region, RegionProfile> = {
  western: WESTERN_PROFILE,
  nigeria: NIGERIA_PROFILE,
  india: INDIA_PROFILE,
  philippines: PHILIPPINES_PROFILE,
};

// ---------------------------------------------------------------- //
// Decoration applier                                                //
// ---------------------------------------------------------------- //

/** Length caps mirror the schema constraints in `ideaGen.ts`. We
 *  never grow a field past its cap; if the base + decoration would
 *  exceed, we drop the decoration on that surface (silent no-op
 *  rather than a noisy truncation that would split a word). */
const CAPTION_MAX = 140;
const HOWTOFILM_MAX = 400;
const WHYITWORKS_MAX = 280;

export type RegionDecorationInput = {
  region: Region | undefined;
  domain: CanonicalDomain;
  caption: string;
  howToFilm: string;
  whyItWorks: string;
};

export type RegionDecorationOutput = {
  caption: string;
  howToFilm: string;
  whyItWorks: string;
  /** Telemetry: which surfaces actually received decoration. Empty
   *  for `western` and for any (region, domain) pair with no
   *  matching entries. The recipe loop / QA harness reads this to
   *  report "≥60% of non-western ideas show visible decoration". */
  decorated: ReadonlyArray<"caption" | "howToFilm" | "whyItWorks">;
};

/** Pure / deterministic. Same input → same output, no module
 *  mutation, no Claude, no DB. Returns the input fields unchanged
 *  when `region === "western"` or `region === undefined`. */
export function decorateForRegion(
  input: RegionDecorationInput,
): RegionDecorationOutput {
  const { region, domain, caption, howToFilm, whyItWorks } = input;
  if (!region || region === "western") {
    return { caption, howToFilm, whyItWorks, decorated: [] };
  }
  const profile = REGION_PROFILES[region];
  const decorated: Array<"caption" | "howToFilm" | "whyItWorks"> = [];

  let outCaption = caption;
  const captionTag = profile.captionSuffixByDomain[domain];
  if (captionTag && caption.length + captionTag.length <= CAPTION_MAX) {
    outCaption = caption + captionTag;
    decorated.push("caption");
  }

  let outHowToFilm = howToFilm;
  const filmCtx = profile.filmingContextByDomain[domain];
  if (filmCtx) {
    const sep = howToFilm.endsWith(".") ? " " : ". ";
    const candidate = howToFilm + sep + filmCtx;
    if (candidate.length <= HOWTOFILM_MAX) {
      outHowToFilm = candidate;
      decorated.push("howToFilm");
    }
  }

  let outWhyItWorks = whyItWorks;
  const whyAdd = profile.whyAddendumByDomain[domain];
  if (whyAdd) {
    const sep = whyItWorks.endsWith(".") ? " " : ". ";
    const candidate = whyItWorks + sep + whyAdd;
    if (candidate.length <= WHYITWORKS_MAX) {
      outWhyItWorks = candidate;
      decorated.push("whyItWorks");
    }
  }

  return {
    caption: outCaption,
    howToFilm: outHowToFilm,
    whyItWorks: outWhyItWorks,
    decorated,
  };
}

/** Convenience wrapper for the QA harness — returns whether ANY
 *  surface was decorated by ANY (region, domain) entry in the
 *  profile. Domain is unknown to the QA harness because it is not
 *  surfaced in qaTelemetry.perIdea today; scanning every per-domain
 *  entry is acceptable here because:
 *    (a) profile entries are short distinct strings and
 *    (b) the QA harness is the only caller, runs ad-hoc, and
 *        each profile holds <=12 entries per surface (O(36) work). */
export function ideaWasRegionDecorated(
  region: Region | undefined,
  idea: Pick<Idea, "caption" | "howToFilm" | "whyItWorks">,
): boolean {
  if (!region || region === "western") return false;
  const profile = REGION_PROFILES[region];
  for (const tag of Object.values(profile.captionSuffixByDomain)) {
    if (tag && idea.caption.endsWith(tag)) return true;
  }
  for (const ctx of Object.values(profile.filmingContextByDomain)) {
    if (ctx && idea.howToFilm.includes(ctx)) return true;
  }
  for (const why of Object.values(profile.whyAddendumByDomain)) {
    if (why && idea.whyItWorks.includes(why)) return true;
  }
  return false;
}
