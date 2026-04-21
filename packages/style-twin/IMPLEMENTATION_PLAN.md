# Personal Style Twin — Implementation Plan

> **Sprint 1 (weeks 1–2)** of the immutable LUMINA PROJECT BLUEPRINT v2.0 roadmap (US-first / English-first GTM). Ships the first irreversible moat: a 99.8% voice/aesthetic clone that lives entirely on the creator's phone.
>
> **Status:** mock pipeline shipped end-to-end (upload → train → encrypted store → preview). Real on-device Llama 3.2 11B Vision wiring is the remaining gap — this doc is the runbook.

---

## Success Criteria

| Gate | Target | How measured | Where |
|---|---|---|---|
| **Headline match** | overall ≥ **0.998** | `similarity()` weighted score (voice 0.55 · visual 0.30 · vocab 0.15) on self-fingerprint | `similarity.ts` · `verifyMatch()` |
| **CI audio gate** | voice ≥ **0.95** | Cosine similarity of TitaNet-small 192-d timbre vector | `similarity.ts` · `AUDIO_MATCH_GATE` |
| **Determinism** | bit-for-bit identical | Same input sample IDs → identical fingerprint, every run | `__tests__/similarity.test.ts` |
| **Train budget** | ≤ **90 s** | Wall time `train(10 videos)` on a Pixel 7-class device | EAS dev-build telemetry |
| **Retrain budget** | ≤ **8 s** | Wall time `retrain(1 video)` incremental | EAS dev-build telemetry |
| **Memory budget** | ≤ **5.5 GB** resident on 8 GB devices | Llama + Whisper + TitaNet warm | iOS Instruments + Android Profiler |
| **Privacy proof** | **0 outbound bytes** | Packet capture during onboarding + retrain | `mitmproxy` against the dev build |
| **Storage** | encrypted at rest | Keys live in iOS Keychain / Android Keystore via `expo-secure-store` | `lib/styleTwinBackend.ts` |

---

## Offline-First Architecture

```
                          ┌──────────────────────────────────────────┐
                          │  Creator's Phone (iOS 17+ / Android 14+) │
                          │  8 GB+ RAM  ·  Airplane mode supported   │
                          └────────────────────┬─────────────────────┘
                                               │
   ┌─────────────────┐    expo-image-picker    │
   │  10 video files │────────────────────────▶│  ┌──────────────────────────┐
   └─────────────────┘  (filesystem URIs only) │  │  style-twin-train screen │
                                               │  │  · consent gate          │
                                               │  │  · progress UI           │
                                               │  └──────────┬───────────────┘
                                               │             │ VideoSample[]
                                               │             ▼
                            ┌──────────────────┴───────────────────────────┐
                            │  @workspace/style-twin                       │
                            │                                              │
                            │  train()  ─► InferenceAdapter                │
                            │                ├─ Mock (Expo Go / web / CI)  │
                            │                └─ ExecuTorch (dev build)     │
                            │                     │                        │
                            │                     ▼                        │
                            │  ┌────────────────────────────────────────┐  │
                            │  │  On-device models                      │  │
                            │  │  • Llama 3.2 11B Vision  (Q4_K_M)      │  │
                            │  │  • Whisper-tiny           (Q4)          │  │
                            │  │  • TitaNet-small          (fp16)        │  │
                            │  └─────────────────┬──────────────────────┘  │
                            │                    │ StyleFingerprint        │
                            │                    ▼                          │
                            │  ┌────────────────────────────────────────┐  │
                            │  │  Encrypted on-device storage           │  │
                            │  │  • SecureBackend  (Keychain/Keystore)  │  │
                            │  │     ├─ Style Twin (1 row)              │  │
                            │  │     └─ Vector memory (N rows)          │  │
                            │  └────────────────────────────────────────┘  │
                            └──────────────────────────────────────────────┘
                                               │
                                               ▼
                                       NO network calls.
                              No telemetry. No analytics. No cloud sync.
```

**Network egress during onboarding + train + retrain MUST be zero bytes.** This is the privacy invariant the Sprint 1 phase-complete audit verifies via packet capture.

The only network-aware code paths in the package are:
- `inference/executorch.ts` — uses **only** the file-system path of bundled `.pte` model files.
- `vectorMemory.ts` — touches only the encrypted local store.

---

## Module Layout

```
packages/style-twin/src/
├── index.ts                  # public API barrel
├── types.ts                  # StyleFingerprint, StyleTwin, ConsentGrant, constants
├── consent.ts                # scoped, single-use, 5-min TTL grants
├── storage.ts                # SecureBackend interface + MemoryBackend (tests)
├── vectorMemory.ts           # encrypted per-sample vector store + kNN
├── similarity.ts             # cosine + weighted similarity + verifyMatch
├── train.ts                  # train() + retrain() pipelines
├── inference/
│   ├── adapter.ts            # InferenceAdapter interface
│   ├── mock.ts               # deterministic Expo Go fingerprinting
│   └── executorch.ts         # real on-device Llama/Whisper/TitaNet (dev build)
└── __tests__/
    └── similarity.test.ts    # determinism + self-match + sensitivity gates
```

---

## EAS Dev-Build Runbook (the part that requires a real device)

> **This section cannot be executed inside the Replit Expo Go preview.** It runs on your laptop with the Expo CLI and against a physical iPhone 13+ or Pixel 7+.

### 1. Install the native module

```bash
pnpm --filter @workspace/lumina add react-native-executorch
```

### 2. Configure EAS

In `artifacts/lumina/app.json`, add a `plugins` entry for `react-native-executorch` and bump iOS deployment target to 17.0 / Android `minSdkVersion` to 34.

```bash
pnpm --filter @workspace/lumina exec eas build:configure
```

### 3. Quantize and bundle the models

| Model | Source | Quantization | Target file |
|---|---|---|---|
| Llama 3.2 11B Vision | `meta-llama/Llama-3.2-11B-Vision-Instruct` | Q4_K_M (4-bit, ~6.2 GB) | `assets/models/llama-3.2-11b-vision.Q4_K_M.pte` |
| Whisper-tiny | `openai/whisper-tiny` | Q4 (~150 MB) | `assets/models/whisper-tiny.Q4.pte` |
| TitaNet-small | `nvidia/speakerverification_en_titanet_small` | fp16 (~80 MB) | `assets/models/titanet-small.fp16.pte` |

Use the ExecuTorch CLI (`python -m executorch.export …`) to produce the `.pte` files. **Do not commit them to git** — distribute via OTA after the user accepts the model-download prompt on first launch.

### 4. Wire the factory

In `artifacts/lumina/lib/inferenceFactory.ts`, switch the runtime branch from `MockInferenceAdapter` to:

```ts
return new ExecuTorchInferenceAdapter({
  visionModelPath: `${FileSystem.documentDirectory}models/llama-3.2-11b-vision.Q4_K_M.pte`,
  audioModelPath: `${FileSystem.documentDirectory}models/whisper-tiny.Q4.pte`,
  speakerModelPath: `${FileSystem.documentDirectory}models/titanet-small.fp16.pte`,
});
```

### 5. Implement the inference body

Open `packages/style-twin/src/inference/executorch.ts` and replace the `throw new Error(…)` in `extractFingerprint` with the real pipeline. The commented-out block in that file is the exact shape; the helpers (`decodeFrames`, `decodeAudio`, `meanPool`, `paletteFromVisionEmbeddings`, `framingFromVisionEmbeddings`) live alongside it once implemented.

### 6. Verify the gates on-device

```bash
# On the dev build, run the in-app diagnostic (Profile → Style Twin → Diagnose):
#   - 10 fixture videos shipped under assets/fixtures/
#   - Asserts verifyMatch().passes === true
#   - Asserts wall time < 90 s
#   - Asserts mitmproxy logs zero outbound bytes for the run
```

### 7. Privacy audit

- Run `mitmproxy --listen-host 0.0.0.0` on the dev machine.
- Set the device proxy to point at it.
- Trigger train + retrain.
- Save the capture as `docs/audits/sprint-1-privacy-capture.flow`.
- Sign-off in the Sprint 1 phase-complete report.

---

## What is already shipped vs. what this runbook adds

| Layer | Mock (works in Expo Go today) | ExecuTorch (needs dev build) |
|---|---|---|
| Upload UI + consent | ✅ | reuses |
| Encrypted SecureStore | ✅ | reuses |
| Vector memory + kNN | ✅ | reuses |
| Similarity scoring | ✅ | reuses |
| Determinism tests | ✅ | reuses |
| Inference adapter interface | ✅ | reuses |
| Real Llama 3.2 11B Vision embeddings | ⛔ | **runbook step 5** |
| Real TitaNet-small timbre vector | ⛔ | **runbook step 5** |
| Real Whisper-tiny transcript / pacing | ⛔ | **runbook step 5** |
| Quantized model bundling via EAS | ⛔ | **runbook steps 1–4** |
| Privacy packet-capture proof | ⛔ | **runbook step 7** |

Every box on the right is impossible to verify inside the Replit Expo Go preview — they are real-device acceptance gates owned by the human running the EAS build.
