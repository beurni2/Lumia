/**
 * PHASE UX3.1 — Post-fix LIVE-app QA harness.
 *
 * Drives the real production orchestrator (`runHybridIdeator`) with
 * the seeded demo creator so every idea in this report comes out of
 * the same code path the mobile app would hit. Then renders:
 *
 *   1. 3 normal batches  (regenerate=false)
 *   2. 2 refresh batches (regenerate=true, excludeHooks = visible)
 *   3. 3 Film-This-Now screens (replicates the lumina film-this-now.tsx
 *      6-beat structure with proportional timestamps)
 *   4. 1 no-face comfort adaptation (mirrors comfortAdaptCopy)
 *   5. 1 no-voice comfort adaptation (mirrors comfortAdaptCopy)
 *
 * For every idea we surface:
 *   - hook
 *   - whatToShow
 *   - howToFilm
 *   - caption
 *   - scenarioCoherence verdict (null = ship; reason string = blocked)
 *   - source/path used (per-idea, off `qaTelemetry.perIdea[].source`)
 *   - rejection summary (per-batch local + coherence + fallback counts)
 *
 * Run:
 *   pnpm exec tsx artifacts/api-server/src/qa/ux31LiveQa.ts
 *
 * Output is written directly to `.local/UX31_LIVE_QA.md` via
 * `fs.writeFileSync`, NOT stdout, so the orchestrator's pino logger
 * (which writes to stdout) doesn't corrupt the markdown.
 *
 * No DB writes, no schema changes, no API surface changes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import { runHybridIdeator } from "../lib/hybridIdeator";
import { validateScenarioCoherence } from "../lib/scenarioCoherence";
import { styleProfileSchema } from "../lib/styleProfile";
import type { Idea } from "../lib/ideaGen";

// ---------------------------------------------------------------- //
// Helpers                                                          //
// ---------------------------------------------------------------- //

function comfortAdaptCopy(
  text: string,
  comfortMode: "no_face" | "no_voice" | null,
): string {
  if (!text || !comfortMode) return text;
  if (comfortMode === "no_face") {
    return text
      .replace(/\bdirect to camera\b/gi, "hold the silence on the action")
      .replace(/\bstraight to camera\b/gi, "hold the silence on the action")
      .replace(
        /\blook (?:straight )?(?:at|into|to) (?:the )?camera\b/gi,
        "hold on the action",
      )
      .replace(/\bto camera\b/gi, "in frame")
      .replace(/\bdeadpan\b/gi, "let the props carry the deadpan")
      .replace(/\bframe yourself\b/gi, "frame the scene")
      .replace(/\byou and the\b/gi, "the");
  }
  if (comfortMode === "no_voice") {
    return text
      .replace(/\bsay (?:this |it )?out loud\b/gi, "show it on caption")
      .replace(/\bout loud\b/gi, "on caption")
      .replace(/\bsay this\b/gi, "caption this")
      .replace(/\bsay it\b/gi, "caption it");
  }
  return text;
}

function fmt(n: number): string {
  return n < 10 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(0);
}

type RunOutcome = {
  label: string;
  regenerate: boolean;
  excludeHooks: string[];
  ideas: Idea[];
  perIdeaSource: string[];
  perIdeaAnchor: (string | undefined)[];
  perIdeaCoreId: (string | undefined)[];
  source: string;
  usedFallback: boolean;
  counts: { localKept: number; fallbackKept: number };
};

async function runOne(
  label: string,
  regenerate: boolean,
  excludeHooks: string[],
  creator: typeof schema.creators.$inferSelect,
): Promise<RunOutcome> {
  const styleProfile = styleProfileSchema.parse({});
  const result = await runHybridIdeator({
    creator,
    region: "western",
    styleProfile,
    count: 3,
    regenerate,
    excludeHooks,
    ctx: { creatorId: creator.id, agentRunId: null },
  });
  const perIdea = result.qaTelemetry?.perIdea ?? [];
  return {
    label,
    regenerate,
    excludeHooks,
    ideas: result.ideas,
    perIdeaSource: result.ideas.map(
      (_, i) => perIdea[i]?.source ?? result.source,
    ),
    perIdeaAnchor: result.ideas.map((_, i) => perIdea[i]?.anchor),
    perIdeaCoreId: result.ideas.map((_, i) => perIdea[i]?.premiseCoreId),
    source: result.source,
    usedFallback: result.usedFallback,
    counts: result.counts,
  };
}

function ideaCard(
  idea: Idea,
  source: string,
  anchor?: string,
  coreId?: string,
): string {
  const verdict = validateScenarioCoherence(idea);
  const lines: string[] = [];
  lines.push(`#### Hook`);
  lines.push("");
  lines.push(`> ${idea.hook}`);
  lines.push("");
  lines.push(`#### whatToShow`);
  lines.push("");
  lines.push(`> ${idea.whatToShow}`);
  lines.push("");
  lines.push(`#### howToFilm`);
  lines.push("");
  lines.push(`> ${idea.howToFilm}`);
  lines.push("");
  lines.push(`#### Caption`);
  lines.push("");
  lines.push(`> ${idea.caption ?? "_(no caption)_"}`);
  lines.push("");
  lines.push(`#### Diagnostics`);
  lines.push("");
  lines.push(
    `- **scenarioCoherence**: ${verdict === null ? "PASS (`null`)" : `FAIL \`${verdict}\``}`,
  );
  lines.push(`- **source / path**: \`${source}\``);
  if (anchor) lines.push(`- **anchor**: \`${anchor}\``);
  if (coreId) lines.push(`- **premiseCoreId**: \`${coreId}\``);
  lines.push(
    `- **idea meta**: pattern=\`${idea.pattern}\`, structure=\`${idea.structure}\`, hookStyle=\`${idea.hookStyle}\`, spike=\`${idea.emotionalSpike}\`, payoff=\`${idea.payoffType}\``,
  );
  lines.push(
    `- **timings**: hookSec=${idea.hookSeconds}s, videoLength=${idea.videoLengthSec}s, filmingTime=${idea.filmingTimeMin}min`,
  );
  lines.push("");
  return lines.join("\n");
}

function batchHeader(o: RunOutcome): string {
  const lines: string[] = [];
  lines.push(`## ${o.label}`);
  lines.push("");
  lines.push(
    `- **regenerate**: \`${o.regenerate}\` · **batch source**: \`${o.source}\` · **usedFallback**: \`${o.usedFallback}\``,
  );
  lines.push(
    `- **counts**: localKept=${o.counts.localKept}, fallbackKept=${o.counts.fallbackKept}, ideas shipped=${o.ideas.length}`,
  );
  if (o.excludeHooks.length > 0) {
    lines.push(
      `- **excludeHooks (${o.excludeHooks.length})**: ${o.excludeHooks.map((h) => `\`${h}\``).join(", ")}`,
    );
  }
  // Rejection summary: per-batch we don't have direct access to
  // localResult.rejectionReasons here (it's logged inside runHybridIdeator),
  // but we CAN compute the validator verdict on every shipped idea
  // and surface that as a per-batch quality signal.
  const verdicts = o.ideas.map((i) => validateScenarioCoherence(i));
  const failures = verdicts.filter((v) => v !== null);
  lines.push(
    `- **shipped-idea coherence sweep**: ${o.ideas.length - failures.length}/${o.ideas.length} PASS` +
      (failures.length > 0
        ? `, FAIL reasons=${failures.map((f) => `\`${f}\``).join(", ")}`
        : ""),
  );
  lines.push("");
  return lines.join("\n");
}

function filmThisNowScreen(idea: Idea, source: string): string {
  const totalLen = idea.videoLengthSec;
  const hookSec = Math.max(0.5, idea.hookSeconds);
  const remainder = Math.max(2, totalLen - hookSec);
  const actionEnd = hookSec + remainder * (1 / 3);
  const twistEnd = hookSec + remainder * (2 / 3);
  const payoffEnd = totalLen;
  const lines: string[] = [];
  lines.push(`### Idea: "${idea.hook}"`);
  lines.push(`- **source**: \`${source}\``);
  lines.push(`- **scenarioCoherence**: ${validateScenarioCoherence(idea) === null ? "PASS" : `FAIL \`${validateScenarioCoherence(idea)}\``}`);
  lines.push(
    `- **videoLength**: ${totalLen}s · **hookSec**: ${hookSec}s · **filmingTime**: ${idea.filmingTimeMin}min`,
  );
  lines.push("");
  lines.push("| Beat | Time | Body |");
  lines.push("| --- | --- | --- |");
  lines.push(
    `| SETUP | _(pre-roll)_ | Phone propped, single take. Frame yourself so the hook lands first, then say it straight to camera. |`,
  );
  lines.push(`| HOOK | 0–${fmt(hookSec)}s | ${idea.hook} |`);
  lines.push(
    `| ACTION | ${fmt(hookSec)}–${fmt(actionEnd)}s | ${(idea.whatToShow ?? idea.trigger ?? "").replace(/\|/g, "\\|")} |`,
  );
  const twistBody =
    idea.emotionalSpike && idea.payoffType
      ? `Lean into the ${idea.emotionalSpike} beat — the ${idea.payoffType.replace(/_/g, " ")} lands here.`
      : idea.emotionalSpike
        ? `Lean into the ${idea.emotionalSpike} beat — let the contradiction widen.`
        : `The ${idea.payoffType?.replace(/_/g, " ")} lands here — let the shift breathe before the payoff.`;
  lines.push(`| TWIST | ${fmt(actionEnd)}–${fmt(twistEnd)}s | ${twistBody.replace(/\|/g, "\\|")} |`);
  lines.push(
    `| PAYOFF | ${fmt(twistEnd)}–${fmt(payoffEnd)}s | ${(idea.reaction ?? idea.whyItWorks ?? "").replace(/\|/g, "\\|")} |`,
  );
  if (idea.shotPlan && idea.shotPlan.length > 0) {
    lines.push("");
    lines.push("**SHOT PLAN**");
    lines.push("");
    idea.shotPlan.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  if (idea.caption) {
    lines.push("");
    lines.push(`**CAPTION**: ${idea.caption}`);
  }
  lines.push("");
  return lines.join("\n");
}

function comfortAdaptationCard(
  idea: Idea,
  mode: "no_face" | "no_voice",
  source: string,
): string {
  const lines: string[] = [];
  lines.push(`### ${mode.toUpperCase()} adaptation — "${idea.hook}"`);
  lines.push(`- **source**: \`${source}\``);
  lines.push(
    `- **scenarioCoherence (raw idea)**: ${validateScenarioCoherence(idea) === null ? "PASS" : `FAIL \`${validateScenarioCoherence(idea)}\``}`,
  );
  lines.push("");
  const fields: Array<{ label: string; raw: string }> = [
    { label: "whatToShow", raw: idea.whatToShow },
    { label: "howToFilm", raw: idea.howToFilm },
    { label: "trigger", raw: idea.trigger ?? "" },
    { label: "reaction", raw: idea.reaction ?? "" },
    { label: "caption", raw: idea.caption ?? "" },
  ];
  lines.push("| Field | Original | Adapted (`" + mode + "`) | Changed? |");
  lines.push("| --- | --- | --- | --- |");
  for (const f of fields) {
    if (!f.raw) continue;
    const adapted = comfortAdaptCopy(f.raw, mode);
    const changed = adapted !== f.raw;
    lines.push(
      `| ${f.label} | ${f.raw.replace(/\|/g, "\\|")} | ${adapted.replace(/\|/g, "\\|")} | ${changed ? "**yes**" : "no"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------- //
// Main                                                             //
// ---------------------------------------------------------------- //

async function main(): Promise<void> {
  const demo = (
    await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.isDemo, true))
      .limit(1)
  )[0];
  if (!demo) {
    console.error("No demo creator seeded — abort.");
    process.exit(1);
  }
  const lines: string[] = [];
  lines.push("# PHASE UX3.1 — Post-fix LIVE-app QA Sample");
  lines.push("");
  lines.push(
    `_Generated by_ \`pnpm exec tsx artifacts/api-server/src/qa/ux31LiveQa.ts\``,
  );
  lines.push("");
  lines.push(
    "Drives the actual `runHybridIdeator` orchestrator with the seeded demo creator so every idea below comes from the SAME code path the mobile app hits. The 3 Film-This-Now screens replicate the lumina `film-this-now.tsx` 6-beat layout with proportional timestamps. The two comfort-adaptation cards mirror the UX3 client-side `comfortAdaptCopy` substitutions (literal string swaps for face/voice-dependent prompts).",
  );
  lines.push("");
  lines.push("## How to read");
  lines.push("");
  lines.push(
    "- **scenarioCoherence: PASS** — the rendered idea cleared all 9 UX3 + UX3.1 rules and would ship.",
  );
  lines.push(
    "- **scenarioCoherence: FAIL `<reason>`** — would have been rejected by the validator. None should be present in this report (the validator runs INSIDE the orchestrator before shipping).",
  );
  lines.push(
    "- **source / path** — per-idea attribution surfaced via the orchestrator's `qaTelemetry.perIdea[].source` (additive QA-only field; production callers ignore it):",
  );
  lines.push(
    "  - `core_native` → cohesive author path (premise core × catalog row × anchor).",
  );
  lines.push(
    "  - `pattern_variation` → pattern engine path (now also gated by `validateScenarioCoherence` post-UX3.1).",
  );
  lines.push("  - `claude_fallback` → Anthropic fallback (rare on demo creator).");
  lines.push("");

  // -------- 1. Three normal batches ----------------------------- //
  const batches: RunOutcome[] = [];
  for (let i = 1; i <= 3; i += 1) {
    const o = await runOne(`Normal batch #${i}`, false, [], demo);
    batches.push(o);
  }

  // -------- 2. Two refresh batches ------------------------------ //
  // Use prior visible hooks as excludeHooks so the orchestrator's
  // UX3 refresh path is exercised end-to-end.
  const visibleHooks = batches
    .flatMap((b) => b.ideas.map((i) => i.hook.toLowerCase().trim()))
    .slice(0, 20);
  for (let i = 1; i <= 2; i += 1) {
    const o = await runOne(
      `Refresh batch #${i}`,
      true,
      visibleHooks,
      demo,
    );
    batches.push(o);
  }

  // -------- Emit batch sections --------------------------------- //
  lines.push("---");
  lines.push("");
  lines.push("# Section 1 — 3 normal batches + 2 refresh batches");
  lines.push("");
  for (const b of batches) {
    lines.push(batchHeader(b));
    b.ideas.forEach((idea, i) => {
      lines.push(`### Idea ${i + 1}`);
      lines.push("");
      lines.push(
        ideaCard(
          idea,
          b.perIdeaSource[i] ?? "(unknown)",
          b.perIdeaAnchor[i],
          b.perIdeaCoreId[i],
        ),
      );
    });
    lines.push("---");
    lines.push("");
  }

  // -------- 3. Three Film-This-Now screens ---------------------- //
  // Pick one idea from each of the first 3 batches so the screens
  // sample across normal-path runs (not all from the same batch).
  lines.push("# Section 2 — 3 Film-This-Now screens (proportional 6-beat)");
  lines.push("");
  lines.push(
    "Each screen replicates the lumina `film-this-now.tsx` layout: SETUP (pre-roll, no timestamp) / HOOK (0→hookSec) / ACTION (→33%) / TWIST (→66%) / PAYOFF (→100%) / SHOT PLAN / CAPTION. Timestamps are derived from the idea's own `videoLengthSec` so a 12s idea doesn't pretend to be 18s.",
  );
  lines.push("");
  const filmPicks: Array<{ idea: Idea; source: string }> = [];
  for (let i = 0; i < 3 && i < batches.length; i += 1) {
    const b = batches[i]!;
    if (b.ideas.length > 0) {
      filmPicks.push({
        idea: b.ideas[0]!,
        source: b.perIdeaSource[0] ?? "(unknown)",
      });
    }
  }
  filmPicks.forEach((p, i) => {
    lines.push(`## Film-This-Now screen #${i + 1}`);
    lines.push("");
    lines.push(filmThisNowScreen(p.idea, p.source));
    lines.push("---");
    lines.push("");
  });

  // -------- 4. + 5. Comfort adaptations ------------------------- //
  lines.push("# Section 3 — Comfort adaptations");
  lines.push("");
  lines.push(
    "Mirrors the UX3 client-side `comfortAdaptCopy` overlay (literal string swaps applied to derived beat copy). Tables show original → adapted side-by-side with a Changed? column so it's clear when no swap fired (the substitutions only fire on phrases that explicitly assume face / voice delivery).",
  );
  lines.push("");
  // Pick two distinct ideas (not necessarily the same as film picks)
  // to keep the report varied. Prefer an idea whose copy actually
  // contains face/voice-dependent phrases so the adaptation has
  // something to swap; fall back to the next idea if none qualify.
  const allIdeasFlat = batches.flatMap((b, bi) =>
    b.ideas.map((idea, ii) => ({
      idea,
      source: b.perIdeaSource[ii] ?? "(unknown)",
      bi,
      ii,
    })),
  );
  function hasFaceVocab(idea: Idea): boolean {
    const blob =
      `${idea.whatToShow} ${idea.howToFilm} ${idea.trigger ?? ""} ${idea.reaction ?? ""} ${idea.caption ?? ""}`.toLowerCase();
    return /\b(direct to camera|straight to camera|to camera|deadpan|frame yourself|look (?:straight )?(?:at|into|to) (?:the )?camera)\b/.test(
      blob,
    );
  }
  function hasVoiceVocab(idea: Idea): boolean {
    const blob =
      `${idea.whatToShow} ${idea.howToFilm} ${idea.trigger ?? ""} ${idea.reaction ?? ""} ${idea.caption ?? ""}`.toLowerCase();
    return /\b(say (?:this |it )?out loud|out loud|say this|say it)\b/.test(
      blob,
    );
  }
  const noFacePick =
    allIdeasFlat.find((p) => hasFaceVocab(p.idea)) ?? allIdeasFlat[3] ?? allIdeasFlat[0]!;
  const noVoicePick =
    allIdeasFlat.find(
      (p) => hasVoiceVocab(p.idea) && p.idea.hook !== noFacePick.idea.hook,
    ) ??
    allIdeasFlat.find((p) => p.idea.hook !== noFacePick.idea.hook) ??
    allIdeasFlat[0]!;

  lines.push(comfortAdaptationCard(noFacePick.idea, "no_face", noFacePick.source));
  lines.push("---");
  lines.push("");
  lines.push(
    comfortAdaptationCard(noVoicePick.idea, "no_voice", noVoicePick.source),
  );
  lines.push("---");
  lines.push("");

  // -------- Aggregate stats ------------------------------------- //
  const allIdeas = batches.flatMap((b) => b.ideas);
  const verdicts = allIdeas.map((i) => validateScenarioCoherence(i));
  const passCount = verdicts.filter((v) => v === null).length;
  const sourceCounts: Record<string, number> = {};
  for (const b of batches) {
    for (const s of b.perIdeaSource) {
      sourceCounts[s] = (sourceCounts[s] ?? 0) + 1;
    }
  }
  lines.push("# Aggregate");
  lines.push("");
  lines.push(`- **total ideas shipped**: ${allIdeas.length}`);
  lines.push(
    `- **scenarioCoherence pass rate**: ${passCount}/${allIdeas.length}` +
      (passCount === allIdeas.length ? " (100% — UX3.1 acceptance)" : ""),
  );
  lines.push(
    `- **source breakdown**: ${Object.entries(sourceCounts)
      .map(([k, v]) => `\`${k}\`=${v}`)
      .join(", ")}`,
  );
  lines.push(
    `- **batch sources**: ${batches.map((b) => `${b.label.split(" ")[0]} ${b.label.split(" ").pop()} → \`${b.source}\``).join("; ")}`,
  );
  lines.push("");

  const outPath = path.resolve(process.cwd(), ".local/UX31_LIVE_QA.md");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  // Use console.error (stderr) for the only structured signal so
  // stdout (where pino writes) stays unpolluted.
  console.error(`[ux31LiveQa] wrote ${lines.length} lines to ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
