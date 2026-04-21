import type { InferenceAdapter } from "./inference/adapter";
import { type ConsentGrant, type StyleTwin, type VideoSample } from "./types";
export interface TrainResult {
    readonly twin: StyleTwin;
    readonly durationMs: number;
}
export declare function train(samples: readonly VideoSample[], adapter: InferenceAdapter, consent: ConsentGrant): Promise<TrainResult>;
export declare function retrain(newSamples: readonly VideoSample[], adapter: InferenceAdapter, consent: ConsentGrant): Promise<TrainResult>;
