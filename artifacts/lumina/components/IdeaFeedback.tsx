/**
 * Per-idea feedback row — "Would you post this?"
 *
 * Renders directly beneath an `IdeaCard` on the Home feed. Three
 * pill buttons (Yes / Maybe / No). Tapping Yes or Maybe submits
 * immediately and collapses into a quiet "thanks" line. Tapping
 * No expands a small reason input (with 4 chip suggestions to
 * lower the friction of typing) and a Send button.
 *
 * Design constraints honoured:
 *   • Lightweight: never blocks the user's tap into the create
 *     flow on the parent IdeaCard — the row is a sibling, not a
 *     wrapper. Tapping a chip / Send / a verdict is fully
 *     swallowed (the press doesn't bubble to the card).
 *   • Optimistic: the local verdict is recorded the moment the
 *     user taps, so a slow round-trip never re-prompts them.
 *   • Web-safe: uses Pressable + TextInput, no native-only modules.
 *     Haptics are wired via the existing `feedback` helper which
 *     already no-ops on web.
 *
 * NOT shown in onboarding's quick-win — asking for a verdict on
 * the user's first ever idea (before they understand the loop) is
 * premature. Home only.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { lumina } from "@/constants/colors";
import { fontFamily } from "@/constants/typography";
import { feedback as haptic } from "@/lib/feedback";
import {
  getLocalVerdict,
  setLocalVerdict,
  submitIdeaFeedback,
  type IdeaVerdict,
} from "@/lib/ideaFeedback";
import type { IdeaCardData } from "@/components/IdeaCard";

// Quick-tap chips so a "No" doesn't require typing if the user
// can't be bothered — typing on mobile is the friction we're
// dodging. Each chip is the prefill text for the input; the user
// can edit before sending or just hit Send to submit verbatim.
const REASON_CHIPS = [
  "Not my vibe",
  "Too complex",
  "Already done this",
  "Won't perform",
];

export function IdeaFeedback({
  idea,
  region,
  onSubmit,
}: {
  idea: IdeaCardData;
  region?: string;
  // Optional callback fired the moment a verdict is recorded
  // (after the optimistic UI flip, before the network write
  // resolves). The Home feed uses this to drive the
  // multi-YES feedback-loop toast — IdeaFeedback itself
  // remains a dumb per-card row that doesn't know about
  // siblings.
  onSubmit?: (verdict: IdeaVerdict) => void;
}) {
  const [submitted, setSubmitted] = useState<IdeaVerdict | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  // In-flight guard: React state updates are batched, so a fast
  // double-tap can fire `recordAndSubmit` twice before `setSubmitted`
  // commits and hides the buttons. A ref flips synchronously and
  // blocks the second call, so we never send two POSTs for one
  // human intent. The server's atomic upsert is the second line of
  // defence; this is the cheaper first line.
  const inFlightRef = useRef(false);

  // Hydrate from local cache on mount so a re-render of the Home
  // feed (after regenerate, after backgrounding the app, etc.)
  // doesn't re-prompt the user on an idea they already voted on.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const v = await getLocalVerdict(idea.hook);
      if (alive && v) {
        setSubmitted(v);
        inFlightRef.current = true;
      }
    })();
    return () => {
      alive = false;
    };
  }, [idea.hook]);

  function recordAndSubmit(verdict: IdeaVerdict, reasonText?: string) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    // Optimistic local state — flip the UI immediately, persist
    // to AsyncStorage, then fire-and-forget the network write.
    setSubmitted(verdict);
    void setLocalVerdict(idea.hook, verdict);
    // Notify the parent (Home) that a verdict was recorded so it
    // can update the YES counter / show the loop-reinforcement
    // toast. Fire BEFORE the network write so a slow round-trip
    // doesn't delay the UI feedback.
    onSubmit?.(verdict);
    submitIdeaFeedback({
      ideaHook: idea.hook,
      verdict,
      reason: reasonText?.trim() || undefined,
      region,
      ideaCaption: idea.caption,
      ideaPayoffType: idea.payoffType,
      ideaPattern: idea.pattern,
      // Powers the per-creator viral-pattern-memory aggregator on the
      // server. Optional on the body; the server simply ignores rows
      // where it's null when computing the memory snapshot.
      emotionalSpike: idea.emotionalSpike,
      // Lumina Evolution Engine tags — same purpose as
      // emotionalSpike, just two more dimensions the aggregator
      // tracks (structure + hookStyle).
      structure: idea.structure,
      hookStyle: idea.hookStyle,
    });
  }

  function onPickVerdict(verdict: IdeaVerdict) {
    haptic.selection();
    if (verdict === "no") {
      // Open the reason capture instead of submitting immediately.
      // The user can still send without typing if they tap Send —
      // we'll record verdict='no' with a null reason, which is
      // strictly better signal than nothing.
      setReasonOpen(true);
      return;
    }
    recordAndSubmit(verdict);
  }

  function onSendReason() {
    haptic.tap();
    recordAndSubmit("no", reason);
    setReasonOpen(false);
  }

  // Already voted — show a quiet acknowledgement and stop. We
  // intentionally don't offer an "undo" affordance: the natural
  // way to change a vote is to wait for tomorrow's batch.
  if (submitted) {
    return (
      <View style={styles.container}>
        <Text style={styles.thanks}>
          {submitted === "yes"
            ? "Thanks — we'll show you more like this."
            : submitted === "maybe"
              ? "Got it — noted as maybe."
              : "Thanks — we'll show you fewer like this."}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!reasonOpen ? (
        <>
          <Text style={styles.prompt}>Would you post this?</Text>
          <View style={styles.row}>
            <VerdictPill
              label="Yes"
              tone="yes"
              onPress={() => onPickVerdict("yes")}
            />
            <VerdictPill
              label="Maybe"
              tone="maybe"
              onPress={() => onPickVerdict("maybe")}
            />
            <VerdictPill
              label="No"
              tone="no"
              onPress={() => onPickVerdict("no")}
            />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.prompt}>What didn't land?</Text>
          <View style={styles.chipRow}>
            {REASON_CHIPS.map((chip) => (
              <Pressable
                key={chip}
                onPress={(e) => {
                  e.stopPropagation();
                  haptic.tap();
                  setReason(chip);
                }}
                style={({ pressed }) => [
                  styles.chip,
                  reason === chip ? styles.chipActive : null,
                  pressed ? styles.chipPressed : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Reason: ${chip}`}
              >
                <Text
                  style={[
                    styles.chipLabel,
                    reason === chip ? styles.chipLabelActive : null,
                  ]}
                >
                  {chip}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Or tell us in your own words (optional)"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={styles.input}
            multiline
            maxLength={500}
            // Stop touch events from bubbling to the parent IdeaCard
            // pressable so tapping into the input doesn't navigate
            // to the create flow.
            onStartShouldSetResponder={() => true}
          />
          <View style={styles.actionRow}>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                haptic.tap();
                setReasonOpen(false);
                setReason("");
              }}
              style={({ pressed }) => [
                styles.cancelBtn,
                pressed ? styles.btnPressed : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Cancel feedback"
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onSendReason();
              }}
              style={({ pressed }) => [
                styles.sendBtn,
                pressed ? styles.btnPressed : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Send feedback"
            >
              <Text style={styles.sendLabel}>Send</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function VerdictPill({
  label,
  tone,
  onPress,
}: {
  label: string;
  tone: "yes" | "maybe" | "no";
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={(e) => {
        // Critical: stop the press from bubbling to the parent
        // IdeaCard pressable, which would otherwise navigate into
        // the create flow when the user just wanted to vote.
        e.stopPropagation();
        onPress();
      }}
      style={({ pressed }) => [
        styles.pill,
        tone === "yes" ? styles.pillYes : null,
        tone === "maybe" ? styles.pillMaybe : null,
        tone === "no" ? styles.pillNo : null,
        pressed ? styles.pillPressed : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Vote ${label}`}
    >
      <Text style={styles.pillLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  prompt: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    letterSpacing: 0.6,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  pill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
  },
  pillYes: {
    borderColor: "rgba(0,255,204,0.5)",
    backgroundColor: "rgba(0,255,204,0.08)",
  },
  pillMaybe: {
    borderColor: "rgba(255,255,255,0.22)",
  },
  pillNo: {
    borderColor: "rgba(255,120,120,0.4)",
    backgroundColor: "rgba(255,120,120,0.06)",
  },
  pillPressed: {
    opacity: 0.7,
  },
  pillLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "#FFFFFF",
    fontSize: 14,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipActive: {
    borderColor: lumina.firefly,
    backgroundColor: "rgba(0,255,204,0.1)",
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
  },
  chipLabelActive: {
    color: lumina.firefly,
  },
  input: {
    fontFamily: fontFamily.bodyMedium,
    color: "#FFFFFF",
    fontSize: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    marginBottom: 10,
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  cancelLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
  },
  sendBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: lumina.firefly,
  },
  sendLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "#001814",
    fontSize: 13,
  },
  btnPressed: {
    opacity: 0.75,
  },
  thanks: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontStyle: "italic",
  },
});
