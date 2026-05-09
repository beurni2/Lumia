/**
 * PHASE Z1 — Film-This-Now screen.
 *
 * Lightweight timeline view of a single idea, surfaced as a
 * secondary path off the Home card so the creator can scan the
 * shotlist without committing to the full creation flow. Built
 * entirely client-side from the idea payload that Home passes
 * through `router.push({ pathname: "/film-this-now", params })`.
 * No new server endpoint, no new fetch — everything we render
 * is already on the cached/freshly-shipped idea.
 *
 * Tap "Start filming" to enter the existing /create flow, which
 * fires the same `selected` ideator signal Home would have fired,
 * so attribution stays consistent regardless of which path the
 * user took to reach the camera.
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { type IdeaCardData } from "@/components/IdeaCard";
import { lumina } from "@/constants/colors";
import { fontFamily, type } from "@/constants/typography";
import {
  COMFORT_MODE_LABELS,
  COMFORT_MODES,
  type ComfortMode,
  deriveActionConversion,
  deriveConfidenceLabels,
  getComfortAdaptation,
} from "@/lib/actionConversion";
import { submitIdeatorSignal } from "@/lib/ideatorSignal";

// Idea payload shape — same JSON-encoded blob Home pushes into
// /create. We accept the superset (includes shotPlan + script)
// even though IdeaCardData doesn't declare them, because the
// ideator response carries them and we want to render them here
// without widening the public IdeaCardData type just for one
// screen.
type FullIdea = IdeaCardData & {
  script?: string;
  shotPlan?: string[];
  trigger?: string;
  reaction?: string;
};

/**
 * PHASE W2-FTN-FIX-1 — placeholder detectors.
 *
 * The W2 author (`westernPackAuthor.ts`) emits templated values for
 * `trigger`, `reaction`, `shotPlan[1]`, and `whyItWorks` on every
 * W2 entry — they're filler used to satisfy the schema, not authored
 * filming guidance. Pre-FIX-1 these leaked into the FTN screen as
 * TWIST and PAYOFF beats. The detectors below match the EXACT shapes
 * the W2 author writes so non-placeholder real authoring still
 * renders normally.
 *
 * Detection rules — EXACT shapes the W2 author writes (anchored,
 * case-sensitive, literal em-dash U+2014, literal single quotes,
 * literal trailing period or absence). Sources:
 *   `westernPackAuthor.ts:414` →
 *      `\`freeze on the ${anchorLc} for one beat\``       (no period)
 *   `westernPackAuthor.ts:423` →
 *      `\`Beat lands — let the ${anchorLc} sit.\``        (capital B, period)
 *   `westernPackAuthor.ts:431` →
 *      `\`Editorial-curated Western hook on '${anchorLc}' — packaged for filmability.\``
 *
 * Tightness is deliberate: we'd rather let one truly-W2 placeholder
 * leak (extremely unlikely — these strings are not human-natural)
 * than suppress a creator-authored line that happens to use a
 * similar phrase. NG/IN/PH cohorts cannot match these because they
 * use different authoring paths that never emit these exact shapes.
 *
 * We do NOT rewrite placeholder text — we only suppress beats whose
 * only available source is a placeholder.
 */
const W2_BEAT_LANDS_PLACEHOLDER_RE =
  /^Beat lands \u2014 let the .+ sit\.$/;
const W2_FREEZE_PLACEHOLDER_RE =
  /^freeze on the .+ for one beat$/;
const W2_WHY_PLACEHOLDER_RE =
  /^Editorial-curated Western hook on '.+' \u2014 packaged for filmability\.$/;

// PHASE W2-FTN-E1 — `westernPackAuthor.ts:424` writes the byte-
// identical line `"Cut on the contradiction."` as `shotPlan[2]`
// for every W2 entry. Exact match (no anchor token) — the line is
// not human-natural and would never legitimately appear in any
// non-W2 authored shotPlan.
const W2_CUT_ON_CONTRADICTION_PLACEHOLDER = "Cut on the contradiction.";

function isW2TwistPlaceholder(s: string): boolean {
  const t = s.trim();
  return W2_BEAT_LANDS_PLACEHOLDER_RE.test(t) || W2_FREEZE_PLACEHOLDER_RE.test(t);
}

function isW2WhyItWorksPlaceholder(s: string): boolean {
  return W2_WHY_PLACEHOLDER_RE.test(s.trim());
}

// PHASE W2-FTN-E1 — combined SHOT PLAN list filter. Reuses the
// existing W2 twist (beat-lands) detector and adds the exact-
// match cut-on-contradiction string. Used to drop W2 author
// placeholder beats from the SHOT PLAN list section while leaving
// non-placeholder beats and non-W2 authored shotPlans untouched.
function isW2ShotPlanPlaceholder(s: string): boolean {
  const t = s.trim();
  return (
    isW2TwistPlaceholder(t) || t === W2_CUT_ON_CONTRADICTION_PLACEHOLDER
  );
}

/**
 * PHASE W2-FTN-FIX-1 (Fix-2) — script-vs-whatToShow distinctness.
 *
 * The W2 author sets `script = entry.whatToShow` (verbatim) at
 * `westernPackAuthor.ts:420`, so for every W2 entry the two fields
 * are byte-identical and rendering both would just duplicate the
 * action beat. Some non-W2 paths leave them genuinely different
 * (talking-head ideas where script carries the spoken line and
 * whatToShow describes the visual). We render SCRIPT only in the
 * latter case.
 *
 * Conservative distinctness: trimmed strings differ AND the first
 * 40 chars differ. We don't try fuzzy diffing — when in doubt, hide
 * the section so the screen doesn't show duplicate copy.
 */
function isScriptDistinctFromWhatToShow(
  script: string | undefined,
  whatToShow: string | undefined,
): boolean {
  if (!script) return false;
  const s = script.trim();
  if (s.length < 10) return false;
  const w = (whatToShow ?? "").trim();
  if (s === w) return false;
  if (w.length > 0 && s.slice(0, 40) === w.slice(0, 40)) return false;
  return true;
}

/**
 * PHASE UX3.2 — comfort adapter (concrete-instruction overlay).
 *
 * Pre-UX3.2 this was a client-side regex phrase-swap table that
 * rewrote face/voice prompt language in place ("direct to camera"
 * → "hold the silence on the action"; "deadpan" → "let the props
 * carry the deadpan"). The user QA verdict on UX3.1 flagged the
 * "let the props carry the deadpan" output as unfilmable
 * placeholder copy, and the swap pattern itself fundamentally
 * cannot generate concrete alternate framings — it can only
 * substring-rewrite existing copy.
 *
 * UX3.2 replacement: APPEND a concrete additional sentence
 * describing the alternate filming setup (hands-only / over-
 * shoulder / phone-on-tripod-pointed-at-prop for `no_face`;
 * on-screen text card placement / caption-only delivery / music-
 * led pacing for `no_voice`) so the creator gets a real
 * instruction they can execute. Plus a narrow targeted swap of
 * the literal "to camera" / "say it out loud" phrases — but
 * crucially WITHOUT the banned UX3.1 placeholder substitutions
 * ("let the props carry the deadpan" / "hold the silence" etc.).
 *
 * `comfortMode === null` is the identity case → returns the
 * source unchanged. Unknown modes also identity-return so
 * future server modes don't crash the screen.
 */
const NO_FACE_APPENDIX =
  "Hands-only or over-the-shoulder framing. Tripod or phone propped on a shelf, lens pointed at the prop — your hands enter and leave the frame, your face never has to.";
const NO_VOICE_APPENDIX =
  "On-screen text card carries the line — type it as a caption overlay timed to the beat. Let the music or ambient room sound lead pacing instead of voice.";

function comfortAdaptCopy(
  text: string,
  comfortMode: ComfortMode | null,
): string {
  if (!text || !comfortMode) return text;
  let body = text;
  if (comfortMode === "no_face") {
    // Targeted face-prompt removals — replace face-only directions
    // with prop / hands directions. NO "let the props carry the
    // deadpan" / "hold the silence" placeholder substitutions
    // (those are the UX3.1 phrases the user rejected).
    body = body
      .replace(/\bdirect to camera\b/gi, "in frame on the prop")
      .replace(/\bstraight to camera\b/gi, "in frame on the prop")
      .replace(
        /\blook (?:straight )?(?:at|into|to) (?:the )?camera\b/gi,
        "stay on the prop",
      )
      .replace(/\bto camera\b/gi, "in frame")
      .replace(/\bframe yourself\b/gi, "frame the prop");
    // PHASE UX3.3 — removed `\byou and the\b → the` rewrite. It was
    // a UX3.1 cleanup pass for the heavy-substring comfort adapter
    // that no longer runs; in the current authored-plan world it
    // corrupts legitimate copy ("catching both you and the mirror"
    // → "catching both the mirror") and serves no compensating
    // purpose because the prior `frame yourself` → `frame the prop`
    // swap doesn't introduce a "you and the" fragment.
    return `${body} ${NO_FACE_APPENDIX}`;
  }
  if (comfortMode === "no_voice") {
    body = body
      .replace(/\bsay (?:this |it )?out loud\b/gi, "type it as caption")
      .replace(/\bout loud\b/gi, "on caption")
      .replace(/\bsay this\b/gi, "caption this")
      .replace(/\bsay it\b/gi, "caption it");
    return `${body} ${NO_VOICE_APPENDIX}`;
  }
  return text;
}

export default function FilmThisNowScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ idea?: string }>();

  const idea = useMemo<FullIdea | null>(() => {
    if (!params.idea) return null;
    try {
      return JSON.parse(params.idea) as FullIdea;
    } catch {
      return null;
    }
  }, [params.idea]);

  const [copyConfirm, setCopyConfirm] = useState<string | null>(null);

  // PHASE UX2 — opt-in low-cringe comfort mode. Single-select:
  // tap a chip to activate, re-tap to clear, tap a different
  // chip to switch. Lives in screen-local state (no AsyncStorage)
  // — persistence intentionally deferred until beta interviews
  // show creators want it carried across sessions. Resets to
  // null when navigating to a different idea because params.idea
  // changes the entire screen mount.
  const [comfortMode, setComfortMode] = useState<ComfortMode | null>(null);
  const adaptation = useMemo(
    () => (comfortMode && idea ? getComfortAdaptation(idea, comfortMode) : null),
    [comfortMode, idea],
  );

  // Copy-to-clipboard with a 1.5s confirmation toast. We keep
  // the toast purely local to this screen — no signal fires for
  // a copy here, by design: "exported" is reserved for the
  // gallery-save in /review (which is the actual export event).
  const handleCopyCaption = useCallback(async () => {
    if (!idea?.caption) return;
    try {
      await Clipboard.setStringAsync(idea.caption);
      setCopyConfirm("Caption copied");
      setTimeout(() => setCopyConfirm(null), 1500);
    } catch {
      setCopyConfirm("Couldn't copy");
      setTimeout(() => setCopyConfirm(null), 1500);
    }
  }, [idea?.caption]);

  // "Start filming" hands off to the existing creation flow.
  // We re-encode the same idea payload so /create receives it
  // exactly as Home would have sent it.
  //
  // ATTRIBUTION FIX (architect catch): Home's `openCreate`
  // fires the `selected` ideator signal BEFORE navigating to
  // /create, but /create itself doesn't emit one on mount —
  // so a Film-This-Now → /create handoff would silently lose
  // attribution for this entry path. We mirror Home's pattern
  // and fire the same `selected` signal here, threading every
  // available structural tag so the server-side memory
  // aggregator credits the correct structure / hookStyle /
  // pattern / spike / payoff buckets. Fire-and-forget; the
  // helper swallows network failures.
  const handleStartFilming = useCallback(() => {
    if (!idea) return;
    submitIdeatorSignal({
      ideaHook: idea.hook,
      signalType: "selected",
      ideaPattern: idea.pattern,
      emotionalSpike: idea.emotionalSpike,
      payoffType: idea.payoffType,
      structure: idea.structure,
      hookStyle: idea.hookStyle,
    });
    router.push({
      pathname: "/create",
      params: { idea: JSON.stringify(idea) },
    });
  }, [router, idea]);

  if (!idea) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <CosmicBackdrop />
        <View style={[styles.content, { paddingTop: insets.top + 24 }]}>
          <Text style={styles.errorTitle}>No idea to film</Text>
          <Text style={styles.errorBody}>
            We couldn&rsquo;t read the idea you tapped. Head back home
            and try again.
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed ? styles.primaryBtnPressed : null,
            ]}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Derive timeline windows from the idea's own metadata. The
  // hookSeconds field gates the first beat; everything after is
  // a soft suggestion based on the 15-25s short-form window the
  // ideator targets. We never INVENT durations — if the idea
  // didn't ship hookSeconds, the beat is rendered without a
  // timestamp.
  const hookEnd =
    typeof idea.hookSeconds === "number" && idea.hookSeconds > 0
      ? idea.hookSeconds
      : 2;
  const totalLen =
    typeof idea.videoLengthSec === "number" && idea.videoLengthSec > 0
      ? idea.videoLengthSec
      : 20;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <CosmicBackdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backBtn,
            pressed ? styles.backBtnPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backBtnText}>← Back</Text>
        </Pressable>

        <Text style={styles.kicker}>FILM THIS NOW</Text>
        <Text style={styles.title}>{idea.hook}</Text>
        {idea.whyThisFitsYou ? (
          <Text style={styles.whyFits}>{idea.whyThisFitsYou}</Text>
        ) : null}

        {/* PHASE UX2 — comfort-mode toggle row. Sits high in the
            screen so creators with face/voice/setting anxiety
            see it BEFORE they read the beats and decide "this
            isn't for me today." Single-select with tap-to-
            deselect (which is NOT radio semantics — radios can't
            unselect) so each chip is `accessibilityRole="button"`
            with `accessibilityState.selected`, the conventional
            React Native toggle-chip pattern. The container has
            no role; just an `accessibilityLabel` to anchor the
            row for screen readers. */}
        <View
          style={styles.comfortRow}
          accessible={false}
          accessibilityLabel="Filming comfort mode"
        >
          {COMFORT_MODES.map((m) => {
            const active = comfortMode === m;
            return (
              <Pressable
                key={m}
                onPress={() => setComfortMode(active ? null : m)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${COMFORT_MODE_LABELS[m]}${
                  active ? ", selected" : ""
                }`}
                style={({ pressed }) => [
                  styles.comfortChip,
                  active ? styles.comfortChipActive : null,
                  pressed ? styles.comfortChipPressed : null,
                ]}
              >
                <Text
                  style={[
                    styles.comfortChipText,
                    active ? styles.comfortChipTextActive : null,
                  ]}
                >
                  {COMFORT_MODE_LABELS[m]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* PHASE UX3 — 6-beat structure. Setup / Hook / Action /
            Twist / Payoff / Caption with timestamps derived
            proportionally from the idea's own `videoLengthSec`
            (so a 12s idea doesn't pretend to be 18s). The split
            is fixed-ratio against the total length:
              Setup  : pre-roll (counts down from 0)
              Hook   : 0 → hookSeconds (default 2)
              Action : hookEnd → ~33% of total
              Twist  : ~33% → ~66% of total
              Payoff : ~66% → 100% of total
            Captions appear AFTER the timeline beats so the
            creator first internalizes the rhythm, then sees the
            verbatim line. Comfort adaptation moves to AFTER
            caption per spec — see further down. */}
        {(() => {
          // Beat 0 (Setup) is implicit pre-roll guidance — no
          // timestamp. Beat 1 (Hook) lands at idea.hookSeconds.
          // Beats 2/3/4 split the remainder into thirds so the
          // ratio scales with videoLengthSec.
          const hookSec = Math.max(0.5, hookEnd);
          const remainder = Math.max(2, totalLen - hookSec);
          const actionEnd = hookSec + remainder * (1 / 3);
          const twistEnd = hookSec + remainder * (2 / 3);
          const payoffEnd = totalLen;
          const fmt = (n: number) =>
            n < 10 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(0);
          // PHASE W2-FTN-FIX-1 (Fix-1) — derive SETUP source from
          // existing authored fields instead of the pre-FIX hard-
          // coded face-camera boilerplate. Source priority:
          //   1. shotPlan[0]   — every W2 entry has "Open on the
          //                      {anchor} in frame." here, which is
          //                      a concrete prep instruction.
          //   2. visualHook    — sentence-form open shot when the
          //                      authoring path didn't write a
          //                      shotPlan.
          //   3. (omit)        — silence is better than the generic
          //                      face-camera default that may
          //                      collide with comfort-mode prefs.
          // We refuse to render shotPlan[0] when it matches the W2
          // beat-lands placeholder shape (defensive — that template
          // is for shotPlan[1], not [0], but the check is cheap).
          const sp0Raw =
            Array.isArray(idea.shotPlan) && idea.shotPlan.length >= 1
              ? idea.shotPlan[0]
              : null;
          const sp0 =
            sp0Raw && sp0Raw.trim().length > 0 && !isW2TwistPlaceholder(sp0Raw)
              ? sp0Raw
              : null;
          const setupSource =
            sp0 ?? (idea.visualHook && idea.visualHook.trim().length > 0
              ? idea.visualHook
              : null);

          // PHASE W2-FTN-FIX-1 (Fix-3) — resolve ACTION source
          // explicitly so we can de-dupe TWIST when both beats
          // would resolve to the same string.
          const actionSourceRaw =
            (idea.whatToShow ?? idea.trigger ?? "").toString();
          const actionSource =
            actionSourceRaw.trim().length > 0 ? actionSourceRaw : null;

          // PHASE W2-FTN-FIX-1 (Fix-3) — TWIST guards.
          // Pre-FIX TWIST fell back to shotPlan[1] → trigger and
          // would render the W2 author's templated freeze /
          // beat-lands placeholders verbatim. Now we walk the
          // candidates in priority order and pick the FIRST that
          //   (a) is non-empty,
          //   (b) is not a known W2 placeholder shape, AND
          //   (c) doesn't equal the resolved ACTION source.
          // If no candidate survives, the beat is omitted entirely.
          const twistCandidates: Array<string | null> = [
            Array.isArray(idea.shotPlan) && idea.shotPlan.length >= 2
              ? idea.shotPlan[1] ?? null
              : null,
            idea.trigger ?? null,
          ];
          let twistSource: string | null = null;
          for (const cand of twistCandidates) {
            if (!cand) continue;
            const trimmed = cand.trim();
            if (trimmed.length === 0) continue;
            if (isW2TwistPlaceholder(trimmed)) continue;
            if (actionSource && trimmed === actionSource.trim()) continue;
            twistSource = cand;
            break;
          }

          // PHASE W2-FTN-FIX-1 (Fix-3) — PAYOFF guards.
          // Reaction still wins when it's a concrete authored line.
          // We refuse to render either the W2 freeze placeholder
          // (in `reaction`) OR the W2 editorial-curated whyItWorks
          // placeholder. If only placeholder sources are available,
          // PAYOFF is omitted.
          const reactionRaw = idea.reaction?.trim() ?? "";
          const reactionUsable =
            reactionRaw.length > 0 && !isW2TwistPlaceholder(reactionRaw);
          const whyRaw = idea.whyItWorks?.trim() ?? "";
          const whyUsable =
            whyRaw.length > 0 && !isW2WhyItWorksPlaceholder(whyRaw);
          const payoffSource = reactionUsable
            ? idea.reaction!
            : whyUsable
              ? idea.whyItWorks!
              : null;

          // PHASE W2-FTN-FIX-1 (Fix-2) — SCRIPT section between
          // TWIST and PAYOFF, only when distinct from whatToShow.
          // Hidden for every W2 entry (W2 author sets script =
          // whatToShow verbatim at westernPackAuthor.ts:420) and
          // for any other authoring path that didn't write a
          // distinct script. Comfort-adapted like the beats.
          const scriptUsable = isScriptDistinctFromWhatToShow(
            idea.script,
            idea.whatToShow,
          );

          return (
            <>
              {/* SETUP — preflight prompt; no timestamp. PHASE
                  W2-FTN-FIX-1 (Fix-1): renders idea-derived source
                  only; omitted entirely when no source is
                  available. Adapts to comfortMode. */}
              {setupSource ? (
                <View style={styles.beat}>
                  <Text style={styles.beatTime}>SETUP</Text>
                  <Text style={styles.beatLabel}>BEFORE YOU HIT RECORD</Text>
                  <Text style={styles.beatBody}>
                    {comfortAdaptCopy(setupSource, comfortMode)}
                  </Text>
                </View>
              ) : null}

              {/* HOOK — 0 → hookSec. Schema-guaranteed field. */}
              <View style={styles.beat}>
                <Text style={styles.beatTime}>0&ndash;{fmt(hookSec)}s</Text>
                <Text style={styles.beatLabel}>HOOK</Text>
                <Text style={styles.beatBody}>{idea.hook}</Text>
              </View>

              {/* ACTION — hookSec → actionEnd. Whatever visible
                  beat the show field describes; fallback to
                  trigger for legacy cached ideas. comfortMode
                  swaps "say this" / "to camera" copy hints into
                  overlay/hands prompts when active. */}
              {actionSource ? (
                <View style={styles.beat}>
                  <Text style={styles.beatTime}>
                    {fmt(hookSec)}&ndash;{fmt(actionEnd)}s
                  </Text>
                  <Text style={styles.beatLabel}>ACTION</Text>
                  <Text style={styles.beatBody}>
                    {comfortAdaptCopy(actionSource, comfortMode)}
                  </Text>
                </View>
              ) : null}

              {/* TWIST — actionEnd → twistEnd. PHASE UX3.2 sourced
                  twist copy from concrete idea fields and hid the
                  row when no concrete source was present. PHASE
                  W2-FTN-FIX-1 (Fix-3) extends this: also reject
                  the W2 author's templated freeze / beat-lands
                  placeholders, and de-dupe when twistSource ===
                  actionSource. Concrete authored TWIST text still
                  renders normally. */}
              {twistSource ? (
                <View style={styles.beat}>
                  <Text style={styles.beatTime}>
                    {fmt(actionEnd)}&ndash;{fmt(twistEnd)}s
                  </Text>
                  <Text style={styles.beatLabel}>TWIST</Text>
                  <Text style={styles.beatBody}>
                    {comfortAdaptCopy(twistSource, comfortMode)}
                  </Text>
                </View>
              ) : null}

              {/* SCRIPT — PHASE W2-FTN-FIX-1 (Fix-2). Renders only
                  when idea.script is meaningfully different from
                  whatToShow (talking-head paths). Sits between
                  TWIST and PAYOFF as a "what to actually say"
                  block. comfortMode adapts (e.g. no_voice swaps
                  "say it out loud" → "type it as caption"). */}
              {scriptUsable ? (
                <View style={styles.beat}>
                  <Text style={styles.beatTime}>SCRIPT</Text>
                  <Text style={styles.beatLabel}>WHAT TO SAY</Text>
                  <Text style={styles.beatBody}>
                    {comfortAdaptCopy(idea.script!, comfortMode)}
                  </Text>
                </View>
              ) : null}

              {/* PAYOFF — twistEnd → payoffEnd. Reaction wins when
                  it's a concrete authored line; whyItWorks is the
                  fallback. PHASE W2-FTN-FIX-1 (Fix-3): both
                  sources are screened against the W2 author's
                  placeholder shapes; the beat is omitted when
                  only placeholder sources are available. */}
              {payoffSource ? (
                <View style={styles.beat}>
                  <Text style={styles.beatTime}>
                    {fmt(twistEnd)}&ndash;{fmt(payoffEnd)}s
                  </Text>
                  <Text style={styles.beatLabel}>PAYOFF</Text>
                  <Text style={styles.beatBody}>
                    {comfortAdaptCopy(payoffSource, comfortMode)}
                  </Text>
                </View>
              ) : null}
            </>
          );
        })()}

        {/* Shot plan — the model's bullet-list of the actual
            shots needed. Optional because pre-v2 cached batches
            lack the field; renders nothing if absent.
            PHASE W2-FTN-E1 — filter W2 author placeholder beats
            (`Beat lands — let the {anchor} sit.` and
            `Cut on the contradiction.`) before render. Re-numbers
            surviving beats 1..N so the list reads naturally with
            no gaps. Hides the entire SHOT PLAN section when zero
            non-placeholder beats survive. Non-W2 authored shotPlans
            and pre-v2 cached payloads are unaffected — the
            detector is exact-shape against the W2 author's writes. */}
        {(() => {
          const sp = Array.isArray(idea.shotPlan) ? idea.shotPlan : [];
          const filtered = sp.filter(
            (s) =>
              typeof s === "string" &&
              s.trim().length > 0 &&
              !isW2ShotPlanPlaceholder(s),
          );
          if (filtered.length === 0) return null;
          return (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>SHOT PLAN</Text>
              {filtered.map((shot, i) => (
                <Text key={i} style={styles.shotLine}>
                  {i + 1}. {shot}
                </Text>
              ))}
            </View>
          );
        })()}

        {/* Caption + copy button. Same Clipboard pattern review.tsx
            uses for its caption block. */}
        {idea.caption ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CAPTION</Text>
            <Text style={styles.captionBody}>{idea.caption}</Text>
            <Pressable
              onPress={handleCopyCaption}
              style={({ pressed }) => [
                styles.copyBtn,
                pressed ? styles.copyBtnPressed : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Copy caption"
            >
              <Text style={styles.copyBtnText}>
                {copyConfirm ?? "Copy caption"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* PHASE UX3 — Comfort adaptation block MOVED to AFTER
            caption (was above the beats). Rationale: the
            timeline beats above already adapt their copy to the
            active comfortMode (`comfortAdaptCopy` swaps
            face/voice prompts into overlay/hands prompts), so
            this block is now a recap of WHY the timeline reads
            the way it does, not a preamble. Only renders when a
            mode is active. Tone is teal/match when matchesComfort-
            Mode is true, dim/mismatch when false (creator can
            still try but we tell them it's not the most natural
            fit so they're not surprised). Safety note appears
            only when `detectScreenSafetyContext` fires AND the
            active mode has a registered safety note. */}
        {adaptation ? (
          <View
            style={[
              styles.adaptBlock,
              adaptation.fits === "match"
                ? styles.adaptBlockMatch
                : styles.adaptBlockMismatch,
            ]}
            accessibilityLabel={`Comfort adaptation, ${COMFORT_MODE_LABELS[adaptation.mode]}, ${
              adaptation.fits === "match"
                ? "good fit for this idea"
                : "less ideal fit for this idea"
            }`}
          >
            <Text style={styles.adaptKicker}>
              ADAPTED — {COMFORT_MODE_LABELS[adaptation.mode].toUpperCase()}
              {adaptation.fits === "mismatch" ? " · less ideal fit" : ""}
            </Text>
            {adaptation.tips.map((tip, i) => (
              <Text key={i} style={styles.adaptTip}>
                {`• ${tip}`}
              </Text>
            ))}
            {adaptation.safetyNote !== null ? (
              <Text style={styles.adaptSafety}>
                {`⚠  ${adaptation.safetyNote}`}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* PHASE UX1 — Action Conversion footer. Time +
            difficulty + confidence labels in a tight,
            scannable block right above the primary CTA so the
            user sees "this is small, fast, and private" at the
            exact moment they're deciding to tap "Start
            filming". All three values are derived purely from
            fields the server already ships — see
            `lib/actionConversion.ts`. Each row is HIDDEN when
            its underlying signal is missing (legacy cached
            ideas / Llama wraps); the section header itself is
            suppressed when nothing inside it would render. */}
        {(() => {
          const ac = deriveActionConversion(idea);
          const labels = deriveConfidenceLabels(idea, 4);
          const timeLine =
            ac.estimatedShootSec !== null
              ? `${Math.round(ac.estimatedShootSec)} seconds on camera`
              : ac.filmingTimeMin !== null
                ? `~${ac.filmingTimeMin} min start to finish`
                : null;
          const hasAnything =
            timeLine !== null || ac.difficultyLabel !== null || labels.length > 0;
          if (!hasAnything) return null;
          return (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>PLAN</Text>
              {timeLine !== null ? (
                <View style={styles.planRow}>
                  <Text style={styles.planRowLabel}>Time</Text>
                  <Text style={styles.planRowValue}>{timeLine}</Text>
                </View>
              ) : null}
              {ac.difficultyLabel !== null ? (
                <View style={styles.planRow}>
                  <Text style={styles.planRowLabel}>Difficulty</Text>
                  <Text style={styles.planRowValue}>{ac.difficultyLabel}</Text>
                </View>
              ) : null}
              {labels.length > 0 ? (
                <View style={styles.planChipRow}>
                  {labels.map((chip, idx) => (
                    <View key={idx} style={styles.planChip}>
                      <Text style={styles.planChipText}>{chip}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })()}

        <Pressable
          onPress={handleStartFilming}
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed ? styles.primaryBtnPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Start filming"
        >
          <Text style={styles.primaryBtnText}>Start filming →</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  content: {
    paddingHorizontal: 22,
    gap: 4,
  },
  backBtn: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  backBtnPressed: { opacity: 0.6 },
  backBtnText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
  },
  kicker: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  title: {
    ...type.display,
    color: "#FFFFFF",
    marginBottom: 8,
  },
  whyFits: {
    ...type.body,
    fontStyle: "italic",
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    marginBottom: 18,
  },
  beat: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: 14,
    marginVertical: 6,
  },
  beatTime: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 4,
  },
  beatLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  beatBody: {
    ...type.body,
    color: "rgba(255,255,255,0.9)",
    fontSize: 15,
    lineHeight: 21,
  },
  section: {
    marginTop: 18,
    marginBottom: 6,
  },
  sectionLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  shotLine: {
    ...type.body,
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  captionBody: {
    ...type.body,
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  copyBtn: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,255,204,0.10)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.32)",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  copyBtnPressed: { opacity: 0.7 },
  copyBtnText: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 13,
  },
  // PHASE UX2 — Comfort-mode toggle chip row + adaptation block.
  // The chip row uses flexWrap so on a small iPhone viewport the
  // 4 chips wrap to two rows comfortably. Active chips are
  // filled-teal so the selection is unambiguous; inactive chips
  // are quiet outlined so the row reads as "optional opt-in"
  // rather than mandatory configuration.
  comfortRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
    marginBottom: 14,
  },
  comfortChip: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  comfortChipActive: {
    backgroundColor: "rgba(0,255,204,0.18)",
    borderColor: "rgba(0,255,204,0.55)",
  },
  comfortChipPressed: {
    opacity: 0.7,
  },
  comfortChipText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.78)",
    fontSize: 12,
    letterSpacing: 0.2,
  },
  comfortChipTextActive: {
    fontFamily: fontFamily.bodyBold,
    color: lumina.firefly,
  },
  // Adaptation block — teal-tinted when the chosen mode is a
  // confident fit for this idea; dim-neutral when not. The body
  // (tips + optional safety note) reads identically; only the
  // visual rank shifts so the creator knows whether they're
  // working with the grain of the idea or against it.
  adaptBlock: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  adaptBlockMatch: {
    backgroundColor: "rgba(0,255,204,0.08)",
    borderColor: "rgba(0,255,204,0.32)",
  },
  adaptBlockMismatch: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.16)",
  },
  adaptKicker: {
    fontFamily: fontFamily.bodyBold,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  adaptTip: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.88)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  adaptSafety: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,213,128,0.92)",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  // PHASE UX1 — Plan footer block. Two-column rows for Time +
  // Difficulty (label on left, value on right) plus a flex-wrap
  // chip row for confidence labels. Quiet visual rank so the
  // primary "Start filming" CTA below stays unambiguously the
  // dominant element on the screen.
  planRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  planRowLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    letterSpacing: 0.6,
  },
  planRowValue: {
    fontFamily: fontFamily.bodyBold,
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
  },
  planChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 12,
  },
  planChip: {
    backgroundColor: "rgba(0,255,204,0.10)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.30)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  planChipText: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  primaryBtn: {
    marginTop: 24,
    backgroundColor: lumina.firefly,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  primaryBtnText: {
    fontFamily: fontFamily.bodyBold,
    color: "#001D17",
    fontSize: 16,
    letterSpacing: 0.4,
  },
  errorTitle: {
    ...type.display,
    color: "#FFFFFF",
    marginBottom: 8,
    marginTop: 24,
  },
  errorBody: {
    ...type.body,
    color: "rgba(255,255,255,0.7)",
    marginBottom: 24,
  },
});
