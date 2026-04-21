import { TIMBRE_DIMS } from "../types";
function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
function seededRand(seed) {
    let s = seed || 1;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0xffffffff;
    };
}
function makeVector(seed, dims) {
    const rand = seededRand(seed);
    const v = new Array(dims);
    let norm = 0;
    for (let i = 0; i < dims; i++) {
        const x = rand() * 2 - 1;
        v[i] = x;
        norm += x * x;
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dims; i++)
        v[i] /= norm;
    return v;
}
function pickPalette(seed) {
    const rand = seededRand(seed);
    const palette = [
        { hex: "#c084fc", weight: 0.32 },
        { hex: "#ff8da1", weight: 0.24 },
        { hex: "#1f1a4a", weight: 0.18 },
        { hex: "#f6f3ff", weight: 0.14 },
        { hex: "#0a0820", weight: 0.12 },
    ];
    return palette
        .map((p) => ({ ...p, weight: p.weight * (0.7 + rand() * 0.6) }))
        .sort((a, b) => b.weight - a.weight);
}
const MOCK_TOKENS = [
    "vibe", "lit", "lowkey", "delicioso", "mantap", "literally",
    "fr", "hatian", "chamou", "bestie", "viral", "trending",
];
const MOCK_CATCHPHRASES = [
    "you already know",
    "vamos nessa",
    "let's get into it",
    "mantap banget",
    "no cap",
];
/**
 * MockInferenceAdapter — runs in Expo Go and tests.
 *
 * Generates a deterministic, plausible Style Twin fingerprint from the input
 * sample IDs. No native code, no model files, no network. Used until the
 * ExecuTorch adapter is wired in a custom dev build (Sprint 1.5).
 */
export class MockInferenceAdapter {
    mode = "mock";
    async extractFingerprint(samples) {
        if (samples.length === 0)
            throw new Error("No samples provided");
        const seed = samples.reduce((acc, s) => acc ^ hashString(s.id), 0);
        const rand = seededRand(seed);
        return {
            voice: {
                pacingWpm: 140 + Math.round(rand() * 60),
                energyMean: 0.55 + rand() * 0.25,
                energyStd: 0.1 + rand() * 0.1,
                timbreVector: makeVector(seed ^ 0xa1, TIMBRE_DIMS),
                fillerRate: rand() * 0.08,
            },
            visual: {
                palette: pickPalette(seed ^ 0xb2),
                temperatureKelvin: 4800 + Math.round(rand() * 1800),
                framingBias: {
                    thirdsScore: 0.55 + rand() * 0.35,
                    centerScore: 0.2 + rand() * 0.3,
                },
                motionEnergy: 0.3 + rand() * 0.5,
            },
            vocabulary: {
                tokens: MOCK_TOKENS.slice(0, 6 + Math.floor(rand() * 4)),
                catchphrases: MOCK_CATCHPHRASES.slice(0, 2 + Math.floor(rand() * 2)),
                languages: ["en", rand() > 0.5 ? "pt-BR" : "id-ID"],
            },
        };
    }
    async mergeFingerprints(existing, incoming, weight) {
        const w = Math.max(0, Math.min(1, weight));
        const lerp = (a, b) => a * (1 - w) + b * w;
        const timbre = existing.voice.timbreVector.map((v, i) => lerp(v, incoming.voice.timbreVector[i] ?? v));
        let norm = Math.sqrt(timbre.reduce((s, x) => s + x * x, 0)) || 1;
        for (let i = 0; i < timbre.length; i++)
            timbre[i] /= norm;
        return {
            voice: {
                pacingWpm: lerp(existing.voice.pacingWpm, incoming.voice.pacingWpm),
                energyMean: lerp(existing.voice.energyMean, incoming.voice.energyMean),
                energyStd: lerp(existing.voice.energyStd, incoming.voice.energyStd),
                timbreVector: timbre,
                fillerRate: lerp(existing.voice.fillerRate, incoming.voice.fillerRate),
            },
            visual: {
                palette: w < 0.5 ? existing.visual.palette : incoming.visual.palette,
                temperatureKelvin: lerp(existing.visual.temperatureKelvin, incoming.visual.temperatureKelvin),
                framingBias: {
                    thirdsScore: lerp(existing.visual.framingBias.thirdsScore, incoming.visual.framingBias.thirdsScore),
                    centerScore: lerp(existing.visual.framingBias.centerScore, incoming.visual.framingBias.centerScore),
                },
                motionEnergy: lerp(existing.visual.motionEnergy, incoming.visual.motionEnergy),
            },
            vocabulary: {
                tokens: Array.from(new Set([...existing.vocabulary.tokens, ...incoming.vocabulary.tokens])).slice(0, 12),
                catchphrases: Array.from(new Set([
                    ...existing.vocabulary.catchphrases,
                    ...incoming.vocabulary.catchphrases,
                ])).slice(0, 6),
                languages: Array.from(new Set([...existing.vocabulary.languages, ...incoming.vocabulary.languages])),
            },
        };
    }
}
