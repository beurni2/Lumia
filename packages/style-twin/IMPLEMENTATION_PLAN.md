# Personal Style Twin — Implementation Plan

> **Sprint 1 (weeks 1–2)** of the immutable LUMINA PROJECT BLUEPRINT v2.0 roadmap (US-first / English-first GTM). Ships the first irreversible moat: a 99.8% voice/aesthetic clone that lives entirely on the creator's phone.
>
> **Status (April 2026):** mock pipeline shipped end-to-end (upload → train → encrypted store → preview). The real ExecuTorch adapter is now **fully implemented** in `inference/executorch.ts` — what remains is producing the EAS dev build, quantizing the three `.pte` files, and running the on-device privacy audit. The v2.0 English-First Beta is **deliberately delayed until those steps clear**.

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
                            │  │  On-device models (OTA-distributed)    │  │
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

**Network egress during onboarding + train + retrain MUST be zero bytes.** This is the privacy invariant the Sprint 1 phase-complete audit verifies via packet capture (`docs/EAS_DEV_BUILD_RUNBOOK.md` §7).

The only network-aware code paths in the package are:
- `inference/executorch.ts` — uses **only** the file-system path of resolved `.pte` model files.
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
│   └── executorch.ts         # REAL on-device Llama/Whisper/TitaNet (dev build)
└── __tests__/
    └── similarity.test.ts    # determinism + self-match + sensitivity gates
```

---

## What landed in `inference/executorch.ts`

The adapter is now real, not stubbed. Highlights:

- **Strict, dev-build-only loader.** `loadRuntimeOrThrow()` dynamically `await import`s `react-native-executorch`. Outside a dev build it throws `ExecuTorchUnavailableError`, which the host `lib/inferenceFactory.ts` catches to fall back to `MockInferenceAdapter`. The adapter itself **never** imports the mock — the fallback decision lives at the factory boundary.
- **Concurrency-safe lazy load.** `ensureModels()` is idempotent and reuses an in-flight promise; failures clear the cache so the next call retries cleanly. `unloadModels()` frees weights when the user leaves the train screen.
- **Real five-stage pipeline.** Per video: decode 8 frames + 16 kHz mono PCM (via injected `FrameDecoder` / `AudioDecoder`) → Llama 3.2 Vision frame embeddings → mean-pooled palette / framing / motion-energy features → TitaNet-small 192-d L2-normalized timbre vector → Whisper-tiny transcript → pacing, filler-rate, vocabulary, catchphrase extraction.
- **Typed errors at every stage.** `ExecuTorchUnavailableError`, `ExecuTorchModelLoadError(modelPath, cause)`, and `ExecuTorchInferenceError(stage, cause)` give the train screen a clean error model.
- **Inlined merge math.** `mergeFingerprints` no longer dynamically imports the mock — the lerp + L2 re-normalize logic is inlined so the real adapter has zero runtime dependency on `mock.ts`.
- **Progress hook.** `config.onProgress(stage, pct)` powers the per-clip progress bar in the training UI.
- **Platform-agnostic decoders.** The package exports `FrameDecoder` / `AudioDecoder` interfaces that the Lumina dev build implements with `expo-video-thumbnails` and `expo-av`. The package itself takes no Expo dependency.

---

## Real-Device Steps (the part that requires a custom EAS dev build)

> The full step-by-step is in **`docs/EAS_DEV_BUILD_RUNBOOK.md`**. The summary below is the contract the founding engineer is expected to clear before the v2.0 English-First Beta gate opens.

### Step 1 — Install the native module

```bash
pnpm --filter @workspace/lumina add react-native-executorch@^0.4 \
                                      expo-file-system expo-asset \
                                      expo-video-thumbnails expo-av
```

### Step 2 — Configure the dev build

Add the `react-native-executorch` plugin to `artifacts/lumina/app.json`, lift iOS deployment target to **17.0** and Android `minSdkVersion` to **34**, and accept the `eas.json` profiles already shipped (`development`, `development-simulator`, `preview`, `production`).

### Step 3 — Quantize the three models on the host machine

| Model | Source | Quantization | Approx size | Target file |
|---|---|---|---|---|
| Llama 3.2 11B Vision | `meta-llama/Llama-3.2-11B-Vision-Instruct` | Q4_K_M (4-bit) | ~6.2 GB | `llama-3.2-11b-vision.Q4_K_M.pte` |
| Whisper-tiny | `openai/whisper-tiny` | Q4 | ~150 MB | `whisper-tiny.Q4.pte` |
| TitaNet-small | `nvidia/speakerverification_en_titanet_small` | fp16 | ~80 MB | `titanet-small.fp16.pte` |

Use the ExecuTorch CLI (`python -m executorch.examples.models.llama.export_llama …`, see runbook §3 for the exact invocations). Record SHA-256 hashes in `docs/audits/MODEL_HASHES.txt`.

### Step 4 — Distribute the `.pte` files via Expo OTA

Models are **never committed**. They are uploaded to `https://models.lumina.app/v2/` and pulled on first launch via `expo-updates` channel `models@v2`. The download is gated behind a scoped `consent.ts` grant (`scope: "model-download"`) and verified against `MODEL_HASHES.txt` before being moved into `${FileSystem.documentDirectory}models/`.

### Step 5 — Wire the factory

`artifacts/lumina/lib/inferenceFactory.ts` instantiates `ExecuTorchInferenceAdapter` with the resolved on-device paths plus the host-app `frameDecoder` / `audioDecoder`. On `ExecuTorchUnavailableError` (Expo Go, web, CI) it returns `MockInferenceAdapter`. The package itself stays platform-agnostic.

### Step 6 — Build and install

```bash
eas build --profile development --platform ios       # then install via QR
eas build --profile development --platform android   # adb install -r …
```

### Step 7 — On-device verification

Open the dev build → **Profile → Train your Style Twin → Diagnose**. The diagnostic runs the 10-clip self-fixture and asserts:

- `verifyMatch().passes === true` (voice ≥ 0.95, overall ≥ 0.998)
- train wall time ≤ 90 s, retrain ≤ 8 s
- resident memory ≤ 5.5 GB
- battery delta ≤ 3 %

### Step 8 — Privacy audit (the v2.0 invariant)

Run `mitmproxy --listen-host 0.0.0.0`, point the device proxy at it, trigger train + retrain, confirm **zero outbound bytes** outside the model-download phase, and save the capture as `docs/audits/sprint-1-privacy-capture.flow`. Repeat in airplane mode end-to-end. Sign off in `docs/audits/sprint-1-phase-complete.md`.

---

## What is already shipped vs. what these steps add

| Layer | Mock (works in Expo Go today) | ExecuTorch (needs dev build) |
|---|---|---|
| Upload UI + consent | ✅ | reuses |
| Encrypted SecureStore | ✅ | reuses |
| Vector memory + kNN | ✅ | reuses |
| Similarity scoring | ✅ | reuses |
| Determinism tests | ✅ | reuses |
| Inference adapter interface | ✅ | reuses |
| **Real adapter implementation** | n/a | ✅ landed (`inference/executorch.ts`) |
| Real Llama 3.2 11B Vision embeddings | ⛔ | **runbook step 3 + 6** |
| Real TitaNet-small timbre vector | ⛔ | **runbook step 3 + 6** |
| Real Whisper-tiny transcript / pacing | ⛔ | **runbook step 3 + 6** |
| Quantized model bundling via OTA | ⛔ | **runbook steps 3 + 4** |
| Privacy packet-capture proof | ⛔ | **runbook step 7 + 8** |

Every box on the right is impossible to verify inside the Replit Expo Go preview — they are real-device acceptance gates owned by the human running the EAS build. The v2.0 English-First Beta does not open until all of them clear.
