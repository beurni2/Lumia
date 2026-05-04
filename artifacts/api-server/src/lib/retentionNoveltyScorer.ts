import type { ViralPatternMemory } from "./viralPatternMemory.js";
import type { Idea } from "./ideaGen.js";
import type { CandidateMeta, ScoredCandidate } from "./ideaScorer.js";

export type RetentionProfile = {
  batchDepth: number;
  structureCounts: Record<string, number>;
  hookStyleCounts: Record<string, number>;
  emotionalSpikeCounts: Record<string, number>;
  formatCounts: Record<string, number>;
  totalEntries: number;
};

export type RetentionScores = {
  signalAlignment: number;
  overfitPenalty: number;
  fatigueRisk: number;
  noveltyDistance: number;
  slotClass: "hero" | "taste" | "novelty";
};

export const EMPTY_RETENTION_PROFILE: RetentionProfile = {
  batchDepth: 0,
  structureCounts: {},
  hookStyleCounts: {},
  emotionalSpikeCounts: {},
  formatCounts: {},
  totalEntries: 0,
};

export function buildRetentionProfile(
  last3BatchIdeas: ReadonlyArray<ReadonlyArray<{ idea: Idea }>>,
): RetentionProfile {
  const structureCounts: Record<string, number> = {};
  const hookStyleCounts: Record<string, number> = {};
  const emotionalSpikeCounts: Record<string, number> = {};
  const formatCounts: Record<string, number> = {};
  let totalEntries = 0;
  for (const batch of last3BatchIdeas) {
    for (const entry of batch) {
      totalEntries++;
      const s = entry.idea.structure;
      if (s) structureCounts[s] = (structureCounts[s] ?? 0) + 1;
      const h = entry.idea.hookStyle;
      if (h) hookStyleCounts[h] = (hookStyleCounts[h] ?? 0) + 1;
      const e = entry.idea.emotionalSpike;
      if (e) emotionalSpikeCounts[e] = (emotionalSpikeCounts[e] ?? 0) + 1;
      const f = entry.idea.pattern;
      if (f) formatCounts[f] = (formatCounts[f] ?? 0) + 1;
    }
  }
  return {
    batchDepth: last3BatchIdeas.length,
    structureCounts,
    hookStyleCounts,
    emotionalSpikeCounts,
    formatCounts,
    totalEntries,
  };
}

export function computeSignalAlignment(
  c: { idea: Idea; meta: CandidateMeta },
  memory: ViralPatternMemory,
): number {
  if (memory.sampleSize < 3) return 0;
  let score = 0;
  const sw = memory.structures[c.idea.structure] ?? 0;
  if (sw > 0) score += Math.min(sw, 3);
  else if (sw < 0) score += Math.max(sw, -2);
  const hw = memory.hookStyles[c.idea.hookStyle] ?? 0;
  if (hw > 0) score += Math.min(hw, 2);
  else if (hw < 0) score += Math.max(hw, -2);
  const ew = memory.emotionalSpikes[c.idea.emotionalSpike] ?? 0;
  if (ew > 0) score += Math.min(ew, 2);
  else if (ew < 0) score += Math.max(ew, -1);
  const fw = memory.formats[c.idea.pattern] ?? 0;
  if (fw > 0) score += Math.min(fw, 2);
  else if (fw < 0) score += Math.max(fw, -1);
  for (const mb of memory.momentumBoosts) {
    if (
      (mb.dimension === "structure" && c.idea.structure === mb.tag) ||
      (mb.dimension === "hookStyle" && c.idea.hookStyle === mb.tag) ||
      (mb.dimension === "emotionalSpike" && c.idea.emotionalSpike === mb.tag) ||
      (mb.dimension === "format" && c.idea.pattern === mb.tag)
    ) {
      score += mb.multiplier === 1.7 ? 2 : 1;
    }
  }
  for (const sp of memory.stalePenalties) {
    if (
      (sp.dimension === "structure" && c.idea.structure === sp.tag) ||
      (sp.dimension === "format" && c.idea.pattern === sp.tag)
    ) {
      score += sp.penalty === -2 ? -2 : -1;
    }
  }
  for (const ts of memory.tasteShiftPromotions) {
    if (
      (ts.dimension === "structure" && c.idea.structure === ts.tag) ||
      (ts.dimension === "hookStyle" && c.idea.hookStyle === ts.tag) ||
      (ts.dimension === "emotionalSpike" && c.idea.emotionalSpike === ts.tag) ||
      (ts.dimension === "format" && c.idea.pattern === ts.tag)
    ) {
      score += 1;
    }
  }
  return Math.round(Math.max(-5, Math.min(7, score)));
}

export function computeOverfitPenalty(
  c: { idea: Idea },
  profile: RetentionProfile,
): number {
  if (profile.totalEntries < 6) return 0;
  let penalty = 0;
  const threshold = profile.totalEntries * 0.5;
  const sCount = profile.structureCounts[c.idea.structure] ?? 0;
  if (sCount >= threshold) penalty -= 3;
  else if (sCount >= profile.totalEntries * 0.4) penalty -= 1;
  const hCount = profile.hookStyleCounts[c.idea.hookStyle] ?? 0;
  if (hCount >= threshold) penalty -= 2;
  else if (hCount >= profile.totalEntries * 0.4) penalty -= 1;
  const eCount = profile.emotionalSpikeCounts[c.idea.emotionalSpike] ?? 0;
  if (eCount >= threshold) penalty -= 2;
  const fCount = profile.formatCounts[c.idea.pattern] ?? 0;
  if (fCount >= threshold) penalty -= 2;
  return Math.max(-6, penalty);
}

export function computeFatigueRisk(
  c: { idea: Idea },
  profile: RetentionProfile,
): number {
  if (profile.batchDepth < 3) return 0;
  let fatigue = 0;
  const sCount = profile.structureCounts[c.idea.structure] ?? 0;
  const hCount = profile.hookStyleCounts[c.idea.hookStyle] ?? 0;
  const fCount = profile.formatCounts[c.idea.pattern] ?? 0;
  const sFrac = profile.totalEntries > 0 ? sCount / profile.totalEntries : 0;
  const hFrac = profile.totalEntries > 0 ? hCount / profile.totalEntries : 0;
  const fFrac = profile.totalEntries > 0 ? fCount / profile.totalEntries : 0;
  const avgFrac = (sFrac + hFrac + fFrac) / 3;
  if (avgFrac >= 0.5) fatigue -= 3;
  else if (avgFrac >= 0.35) fatigue -= 2;
  else if (avgFrac >= 0.25) fatigue -= 1;
  return fatigue;
}

export function computeNoveltyDistance(
  c: { idea: Idea },
  profile: RetentionProfile,
): number {
  if (profile.totalEntries === 0) return 0;
  let freshAxes = 0;
  if ((profile.structureCounts[c.idea.structure] ?? 0) === 0) freshAxes++;
  if ((profile.hookStyleCounts[c.idea.hookStyle] ?? 0) === 0) freshAxes++;
  if ((profile.emotionalSpikeCounts[c.idea.emotionalSpike] ?? 0) === 0)
    freshAxes++;
  if ((profile.formatCounts[c.idea.pattern] ?? 0) === 0) freshAxes++;
  if (freshAxes >= 3) return 3;
  if (freshAxes === 2) return 2;
  if (freshAxes === 1) return 1;
  return 0;
}

export function classifySlot(
  c: { idea: Idea; meta: CandidateMeta },
  memory: ViralPatternMemory,
  profile: RetentionProfile,
): "hero" | "taste" | "novelty" {
  const sa = computeSignalAlignment(c, memory);
  const nd = computeNoveltyDistance(c, profile);
  if (nd >= 3) return "novelty";
  if (sa >= 3) return "taste";
  return "hero";
}

export function scoreRetention(
  c: { idea: Idea; meta: CandidateMeta },
  memory: ViralPatternMemory,
  profile: RetentionProfile,
): RetentionScores {
  return {
    signalAlignment: computeSignalAlignment(c, memory),
    overfitPenalty: computeOverfitPenalty(c, profile),
    fatigueRisk: computeFatigueRisk(c, profile),
    noveltyDistance: computeNoveltyDistance(c, profile),
    slotClass: classifySlot(c, memory, profile),
  };
}

export function retentionSelectionBonus(
  c: { idea: Idea; meta: CandidateMeta },
  memory: ViralPatternMemory,
  profile: RetentionProfile,
): number {
  if (profile.batchDepth === 0) return 0;
  const sa = computeSignalAlignment(c, memory);
  const overfit = computeOverfitPenalty(c, profile);
  const fatigue = computeFatigueRisk(c, profile);
  const nd = computeNoveltyDistance(c, profile);
  const noveltyBoost = nd >= 3 ? 2 : nd >= 2 ? 1 : 0;
  const bonus = Math.round(sa * 0.5) + overfit + fatigue + noveltyBoost;
  return Math.max(-8, Math.min(5, bonus));
}

export function applyBatchComposition(
  batch: ScoredCandidate[],
  memory: ViralPatternMemory,
  profile: RetentionProfile,
): ScoredCandidate[] {
  if (batch.length < 3 || profile.batchDepth < 2) return batch;
  const scored = batch.map((c) => ({
    candidate: c,
    scores: scoreRetention(c, memory, profile),
  }));
  const heroIdx = scored.reduce(
    (best, cur, i) =>
      cur.candidate.score.total > scored[best].candidate.score.total
        ? i
        : best,
    0,
  );
  const remaining = scored.filter((_, i) => i !== heroIdx);
  const tasteIdx = remaining.reduce(
    (best, cur, i) =>
      cur.scores.signalAlignment > remaining[best].scores.signalAlignment
        ? i
        : best,
    0,
  );
  const rest = remaining.filter((_, i) => i !== tasteIdx);
  const noveltyIdx = rest.reduce(
    (best, cur, i) =>
      cur.scores.noveltyDistance > rest[best].scores.noveltyDistance ? i : best,
    0,
  );
  const hero = scored[heroIdx];
  const taste = remaining[tasteIdx];
  const novelty = rest[noveltyIdx];
  const otherSlots = rest.filter((_, i) => i !== noveltyIdx);
  const heroIsDistinct =
    hero.scores.slotClass !== taste.scores.slotClass ||
    hero.scores.slotClass !== novelty.scores.slotClass;
  const hasMeaningfulSpread =
    taste.scores.signalAlignment !== novelty.scores.signalAlignment ||
    taste.scores.noveltyDistance !== novelty.scores.noveltyDistance;
  if (heroIsDistinct || hasMeaningfulSpread) {
    return [
      hero.candidate,
      taste.candidate,
      novelty.candidate,
      ...otherSlots.map((s) => s.candidate),
    ];
  }
  return batch;
}
