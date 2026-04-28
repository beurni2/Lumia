/**
 * Ideator action signals — distinct from per-idea verdict feedback.
 *
 * Where `lib/ideaFeedback.ts` posts a Yes/Maybe/No VERDICT on the
 * card itself, this module posts what the creator DOES with the
 * idea after voting:
 *   • `selected`           — tapped the card to enter the create flow
 *   • `regenerated_batch`  — blew away the current batch instead of
 *                            picking from it
 *   • `skipped`            — scrolled past without voting (future)
 *   • `exported`           — exported the script to clipboard / share
 *                            (future)
 *   • `make_another_version` — tapped "Make another version" on the
 *                              export-success screen, asking for a
 *                              variation of the same idea
 *   • `abandoned`          — opened create then bailed (future)
 *
 * The server weights signals more heavily than verdicts because
 * actions reveal real intent; see api-server/src/lib/
 * viralPatternMemory.ts for the weight table.
 *
 * Fire-and-forget like ideaFeedback — the UI never blocks on this.
 * A 5xx is logged in dev and silently dropped in production. We
 * never throw out of this module so a caller can wire it from any
 * tap handler without try/catch noise.
 */

import { customFetch } from "@workspace/api-client-react";

export type IdeatorSignalType =
  | "selected"
  | "exported"
  | "make_another_version"
  | "regenerated_batch"
  | "skipped"
  | "abandoned"
  // Semi-auto enhancement apply — caption/hook/start-hint tap.
  // Server weights this +1 (positive but lighter than `exported`).
  | "applied_enhancement";

export type SubmitIdeatorSignalInput = {
  ideaHook: string;
  signalType: IdeatorSignalType;
  // Structural metadata so the server-side aggregator can attribute
  // the signal to the right pattern/spike/payoff bucket. All
  // optional — a signal with NO metadata still records, the
  // aggregator just can't credit it to a dimension.
  ideaPattern?: string;
  emotionalSpike?: string;
  payoffType?: string;
  // Lumina Evolution Engine tags (Part 1). Lets the server-side
  // memory aggregator credit the action signal (selected / exported
  // / make_another_version) to the structure + hookStyle dimensions. Both
  // optional — server tolerates NULL.
  structure?: string;
  hookStyle?: string;
  // Semi-auto enhancement apply payload (Part 5 of SUGGESTION-APPLY
  // spec). Only meaningful when signalType=applied_enhancement;
  // server-side validator tolerates it on any signal. We don't send
  // an ideaId because the screen-level idea has no canonical id
  // until export — the server keys off ideaHook for attribution.
  // Set extends to cover the SEMI-AUTO EDIT layer too:
  //   • caption / hook / start_hint  — text rewrites (note-only).
  //   • stitch_clips / trim_start    — preview-state edit intents
  //                                     surfaced in the BeforeAfter
  //                                     "After" frame. Same
  //                                     applied_enhancement signal,
  //                                     same +1 weight; the type tag
  //                                     keeps action-flavour
  //                                     attribution intact.
  suggestionType?:
    | "caption"
    | "hook"
    | "start_hint"
    | "stitch_clips"
    | "trim_start";
};

/**
 * Fire-and-forget POST. Caller should not await — there's no UI
 * spinner for this and we don't want a slow round-trip to leak into
 * the user's perception of card-tap responsiveness. Network/5xx
 * failures log to the dev console but never throw, because there is
 * nothing meaningful the UI could do with a failure here — the user
 * already moved on.
 */
export function submitIdeatorSignal(input: SubmitIdeatorSignalInput): void {
  void (async () => {
    try {
      await customFetch("/api/ideas/signal", {
        method: "POST",
        body: JSON.stringify(input),
      });
    } catch (err) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn("[ideatorSignal] submit failed (non-fatal)", err);
      }
    }
  })();
}
