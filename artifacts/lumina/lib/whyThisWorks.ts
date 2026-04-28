/**
 * whyThisWorks — derive 2–3 short, plain-language confidence
 * lines from an idea's metadata.
 *
 * Why deterministic (not the LLM `whyItWorks` field):
 *   The model's free-text "why it works" leaks system terms
 *   ("denial_loop core", "exploration target", "small panic
 *   structure") into the user-facing UI. That copy reads like
 *   internal docs and adds friction at the most fragile step in
 *   the funnel — right before the user films.
 *
 *   Rather than constrain the LLM (which is a generation-engine
 *   change), we ignore that field at render time and synthesise
 *   the message client-side from fields the engine already
 *   produces. This is a pure rendering layer change — no signal,
 *   memory, or generation logic is touched.
 *
 * Output contract:
 *   - 2 or 3 lines
 *   - each line is 3–6 words, plain English
 *   - never references structure / hookStyle / pattern by name
 *   - sounds like something a friend would say, not docs
 */

import type { IdeaCardData } from "@/components/IdeaCard";

export function deriveWhyThisWorksLines(idea: IdeaCardData): string[] {
  const out: string[] = [];

  // L1 — relatability anchor. Every Phase-1 structure
  // (denial_loop, avoidance, small_panic, self_callout,
  // social_awareness, routine_contradiction,
  // expectation_vs_reality) is a "relatable moment" pattern, so
  // this line is true regardless of which one the engine picked.
  out.push("Super relatable moment");

  // L2 — filming form. Derived from `pattern`, which is the
  // user-visible "POV / Reaction / Mini-story / Contrast" badge
  // — not a system internal.
  switch (idea.pattern) {
    case "reaction":
      out.push("Easy reaction — just your face");
      break;
    case "pov":
      out.push("One quick POV shot");
      break;
    case "mini_story":
    case "observational_confessional":
      out.push("One simple beat to act out");
      break;
    case "contrast":
    case "before_after":
    case "expectation_vs_reality":
      out.push("Quick before vs. after");
      break;
    default:
      out.push("Quick to film");
  }

  // L3 — friction reducer. Prefer the smallest concrete number
  // we have so the line earns its place; fall back to a generic
  // "no setup" promise.
  if (typeof idea.filmingTimeMin === "number" && idea.filmingTimeMin <= 3) {
    out.push("Takes about a minute");
  } else if (
    typeof idea.videoLengthSec === "number" &&
    idea.videoLengthSec > 0 &&
    idea.videoLengthSec <= 20
  ) {
    out.push("Under 20 seconds");
  } else {
    out.push("No setup needed");
  }

  return out;
}
