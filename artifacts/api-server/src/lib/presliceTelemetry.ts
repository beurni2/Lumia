/**
 * N1-FOLLOWUP-PRESLICE-CANDIDATE-INSTRUMENTATION
 *
 * Probe-only, env-gated telemetry collector. Records pre-slice
 * candidate pools, post-sort/post-rotation final pools, and
 * `pickValidatedPhrasing` traces for the `why_do_i` style only.
 *
 * Gated on `LUMINA_PRESLICE_TELEMETRY=1`. With the env unset (the
 * default in production and dev), every public record* function is
 * a single env-var read + early return — no allocations, no string
 * work, no behavior change of any kind. The collector is intended
 * to be drained by `.local/scripts/n1E2eNigeriaQaProbe.mts` once
 * per batch and then cleared.
 *
 * Constraints honored:
 *   - No selection/scoring/validation/sorting changes.
 *   - No production flag changes.
 *   - No schema/API/mobile/DB changes.
 *   - Pure read-only telemetry exposure of the candidate stream.
 */

export const PRESLICE_TELEMETRY_ENV_VAR = "LUMINA_PRESLICE_TELEMETRY";

export function isTelemetryEnabled(): boolean {
  return process.env[PRESLICE_TELEMETRY_ENV_VAR] === "1";
}

export type PresliceCandidateRecord = {
  rank: number;
  hook: string;
  source: string;
  templateId?: string;
  hookStyle?: string;
  hookPhrasingIndex?: number;
  skeletonId?: string;
  hookSkeletonId?: string;
  comedyFamily?: string;
  ideaCoreFamily?: string;
  scenarioFamily?: string;
  scenarioFingerprint?: string;
  topicNoun?: string;
  voiceClusterId?: string;
  hookOpener?: string;
  scoreTotal?: number;
  hookQualityScore?: number;
  willingnessScore?: number;
  pickerEligible?: boolean;
};

export type PresliceBatchRecord = {
  phase: "preslice" | "postsort";
  creatorId?: string;
  region?: string;
  candidates: PresliceCandidateRecord[];
};

export type PickerTraceRow = {
  pass: 1 | 2;
  candidateIdx: number;
  skeletonId?: string;
  hook: string;
  validateHookResult: boolean;
  rejectionReason?: string;
  blocked?: boolean;
};

export type PickerTraceRecord = {
  hookStyle: string;
  scenarioFamily?: string;
  topicNoun?: string;
  seed: number;
  rows: PickerTraceRow[];
  pass1Returned: boolean;
  pass2Reinstated: boolean;
  finalSkeletonId?: string;
  finalHook?: string;
};

const presliceRecords: PresliceBatchRecord[] = [];
const postsortRecords: PresliceBatchRecord[] = [];
const pickerTraces: PickerTraceRecord[] = [];

export type DrainedTelemetry = {
  preslice: PresliceBatchRecord[];
  postsort: PresliceBatchRecord[];
  pickerTraces: PickerTraceRecord[];
};

export function clearTelemetry(): void {
  presliceRecords.length = 0;
  postsortRecords.length = 0;
  pickerTraces.length = 0;
}

export function drainTelemetry(): DrainedTelemetry {
  const drained: DrainedTelemetry = {
    preslice: presliceRecords.slice(),
    postsort: postsortRecords.slice(),
    pickerTraces: pickerTraces.slice(),
  };
  clearTelemetry();
  return drained;
}

/**
 * Internal projector — keeps the `any`-typed candidate shape (we
 * accept whatever `final` carries in `hybridIdeator.ts`) at the
 * boundary so callers don't have to import the full
 * `CandidateMeta` / `PatternMeta` union just to record telemetry.
 */
function projectCandidate(
  rank: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
): PresliceCandidateRecord {
  const idea = c?.idea ?? {};
  const meta = c?.meta ?? {};
  const score = c?.score ?? {};
  const scenario = meta?.scenario ?? {};
  return {
    rank,
    hook: typeof idea.hook === "string" ? idea.hook : "",
    source: typeof meta.source === "string" ? meta.source : "unknown",
    templateId: typeof meta.templateId === "string" ? meta.templateId : undefined,
    hookStyle: typeof meta.hookStyle === "string" ? meta.hookStyle : undefined,
    hookPhrasingIndex:
      typeof meta.hookPhrasingIndex === "number" ? meta.hookPhrasingIndex : undefined,
    skeletonId:
      typeof meta.skeletonId === "string" ? meta.skeletonId : undefined,
    hookSkeletonId:
      typeof meta.hookSkeletonId === "string" ? meta.hookSkeletonId : undefined,
    comedyFamily:
      typeof meta.comedyFamily === "string" ? meta.comedyFamily : undefined,
    ideaCoreFamily:
      typeof meta.ideaCoreFamily === "string" ? meta.ideaCoreFamily : undefined,
    scenarioFamily:
      typeof meta.scenarioFamily === "string" ? meta.scenarioFamily : undefined,
    scenarioFingerprint:
      typeof meta.scenarioFingerprint === "string" ? meta.scenarioFingerprint : undefined,
    topicNoun:
      typeof scenario.topicNoun === "string" ? scenario.topicNoun : undefined,
    voiceClusterId:
      typeof meta.voiceClusterId === "string" ? meta.voiceClusterId : undefined,
    hookOpener:
      typeof meta.hookOpener === "string" ? meta.hookOpener : undefined,
    scoreTotal: typeof score.total === "number" ? score.total : undefined,
    hookQualityScore:
      typeof meta.hookQualityScore === "number"
        ? meta.hookQualityScore
        : undefined,
    willingnessScore:
      typeof idea.willingnessScore === "number"
        ? idea.willingnessScore
        : undefined,
    pickerEligible:
      typeof idea.pickerEligible === "boolean" ? idea.pickerEligible : undefined,
  };
}

const TOP_N = 20;

export function recordPresliceCandidates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  candidates: ReadonlyArray<any>,
  ctx: { creatorId?: string; region?: string },
): void {
  if (!isTelemetryEnabled()) return;
  const slice = candidates.slice(0, TOP_N);
  presliceRecords.push({
    phase: "preslice",
    creatorId: ctx.creatorId,
    region: ctx.region,
    candidates: slice.map((c, i) => projectCandidate(i, c)),
  });
}

export function recordPostSortCandidates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  candidates: ReadonlyArray<any>,
  ctx: { creatorId?: string; region?: string },
): void {
  if (!isTelemetryEnabled()) return;
  postsortRecords.push({
    phase: "postsort",
    creatorId: ctx.creatorId,
    region: ctx.region,
    candidates: candidates.map((c, i) => projectCandidate(i, c)),
  });
}

export function recordPickerTrace(record: PickerTraceRecord): void {
  if (!isTelemetryEnabled()) return;
  pickerTraces.push(record);
}
