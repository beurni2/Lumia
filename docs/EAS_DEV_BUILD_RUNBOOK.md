# EAS Dev-Build Runbook — Lumina Style Twin

> **Blueprint:** v2.0 — US-first / English-first GTM (immutable).
> **Why this runbook exists:** the v2.0 beta is **deliberately delayed** until real on-device inference and posting are complete. This document is the single source of truth for producing a custom EAS dev build that runs Llama 3.2 11B Vision + Whisper-tiny + TitaNet-small entirely on-device, with zero outbound bytes during training or retraining.
>
> **Owner:** founding engineer with macOS 14+, Xcode 16+, Android Studio Koala+, an iPhone 13 Pro+ and a Pixel 7+.
> **Estimated wall time:** ~4 hours for the first build, ~25 minutes for incremental rebuilds.

---

## 0. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24.x | Match `.nvmrc`. |
| pnpm | 9.x | The monorepo's package manager. |
| Expo CLI | latest | `pnpm add -g expo`. |
| EAS CLI | ≥ 12.0 | `pnpm add -g eas-cli`, then `eas login`. |
| Xcode | 16+ | iOS 17 SDK. Run `sudo xcode-select -s /Applications/Xcode.app`. |
| Android Studio | Koala+ | Android SDK 34, NDK 26.1. |
| Python | 3.11 | For the ExecuTorch export pipeline. |
| Hugging Face account | — | Llama 3.2 license accepted under your account. |
| Apple Developer + Google Play account | active | Required for `eas device:create` + provisioning. |

```bash
# one-time host bootstrap
brew install cmake ninja git-lfs ffmpeg
git lfs install
pip install --upgrade pip
pip install "executorch>=0.4.0" "torch>=2.4.0" "transformers>=4.45.0" \
            "huggingface_hub" "soundfile" "librosa"
```

---

## 1. Install the native module

```bash
pnpm --filter @workspace/lumina add react-native-executorch@^0.4
pnpm --filter @workspace/lumina add expo-file-system expo-asset \
                                      expo-video-thumbnails expo-av
```

`react-native-executorch` is a **native** module — it cannot be statically imported in Expo Go. The `packages/style-twin/src/inference/executorch.ts` adapter loads it dynamically and throws `ExecuTorchUnavailableError` outside a dev build, so the host factory falls back to `MockInferenceAdapter` cleanly.

---

## 2. Configure the dev build

### 2a. `app.json`

Add the ExecuTorch plugin and lift the deployment targets:

```jsonc
{
  "expo": {
    "ios": {
      "supportsTablet": false,
      "deploymentTarget": "17.0",
      "infoPlist": {
        "NSCameraUsageDescription": "Train your Style Twin from your own clips.",
        "NSMicrophoneUsageDescription": "Capture voice samples for the Twin.",
        "NSPhotoLibraryUsageDescription": "Pick training videos for the Twin."
      }
    },
    "android": {
      "minSdkVersion": 34,
      "compileSdkVersion": 35,
      "permissions": ["READ_MEDIA_VIDEO", "READ_MEDIA_AUDIO"]
    },
    "plugins": [
      ["expo-router", { "origin": "https://replit.com/" }],
      "expo-font",
      "expo-web-browser",
      ["react-native-executorch", { "backend": "xnnpack-fp16" }]
    ]
  }
}
```

### 2b. `eas.json`

Already shipped at `artifacts/lumina/eas.json`. Three relevant profiles:

| Profile | Inference backend | Distribution | Use |
|---|---|---|---|
| `development` | `executorch` | internal | day-to-day on-device dev |
| `development-simulator` | `mock` | internal simulator | UI iteration without models |
| `production` | `executorch` | App Store / Play Store | release |

### 2c. Provision devices

```bash
eas device:create                    # iPhone 13 Pro+ via web flow
eas credentials                      # accept generated provisioning profile
```

---

## 3. Quantize and bundle the models

The three models live **outside** git. They are produced once on the host machine, uploaded to a private bucket, and shipped to devices via the Expo OTA channel `models@v2`.

### 3a. Llama 3.2 11B Vision (Q4_K_M, ~6.2 GB)

```bash
mkdir -p artifacts/lumina/build/models && cd artifacts/lumina/build/models

huggingface-cli download meta-llama/Llama-3.2-11B-Vision-Instruct \
  --local-dir ./llama-3.2-11b-vision

python -m executorch.examples.models.llama.export_llama \
  --checkpoint ./llama-3.2-11b-vision/consolidated.00.pth \
  --params     ./llama-3.2-11b-vision/params.json \
  --vision \
  --quantization Q4_K_M \
  --kv-cache \
  --use-sdpa-with-kv-cache \
  --output llama-3.2-11b-vision.Q4_K_M.pte
```

### 3b. Whisper-tiny (Q4, ~150 MB)

```bash
python -m executorch.examples.models.whisper.export_whisper \
  --model openai/whisper-tiny \
  --quantization Q4 \
  --output whisper-tiny.Q4.pte
```

### 3c. TitaNet-small (fp16, ~80 MB)

```bash
python -m executorch.examples.models.titanet.export_titanet \
  --model nvidia/speakerverification_en_titanet_small \
  --precision fp16 \
  --output titanet-small.fp16.pte
```

### 3d. Verify the artifacts

```bash
sha256sum *.pte > MODEL_HASHES.txt
ls -lh *.pte
# Expected:
#   ~6.2 GB  llama-3.2-11b-vision.Q4_K_M.pte
#   ~150 MB  whisper-tiny.Q4.pte
#   ~80 MB   titanet-small.fp16.pte
```

`MODEL_HASHES.txt` is the only file from this step that is committed (under `docs/audits/`). The `.pte` files themselves are never committed — `.gitignore` already excludes `artifacts/lumina/build/`.

---

## 4. OTA distribution of the .pte files

The app does not bundle models in the build (it would blow the 4 GB IPA limit and force a 6 GB download to first launch). Instead:

1. Upload the three `.pte` files (and `MODEL_HASHES.txt`) to the private bucket fronted by `https://models.lumina.app/v2/`.
2. The first-launch screen prompts the user **"Download your private AI models (~6.4 GB, Wi-Fi recommended)"** and gates download behind explicit consent (`scope: "model-download"`, 5-min TTL, single-use grant — same primitive as `consent.ts`).
3. On accept, `lib/modelDownloader.ts` streams each file into `${FileSystem.documentDirectory}models/`, verifies the SHA-256 against `MODEL_HASHES.txt`, then resolves.
4. `lib/inferenceFactory.ts` instantiates `ExecuTorchInferenceAdapter` with those resolved file-system paths.

Update channel: `eas update --channel models --message "v2 model bundle"`.

---

## 5. Wire the factory

`artifacts/lumina/lib/inferenceFactory.ts`:

```ts
import * as FileSystem from "expo-file-system";
import {
  ExecuTorchInferenceAdapter,
  ExecuTorchUnavailableError,
  MockInferenceAdapter,
  type InferenceAdapter,
} from "@workspace/style-twin";
import { frameDecoder } from "./media/frameDecoder";
import { audioDecoder } from "./media/audioDecoder";

export async function getInferenceAdapter(): Promise<InferenceAdapter> {
  if (process.env.EXPO_PUBLIC_INFERENCE_BACKEND !== "executorch") {
    return new MockInferenceAdapter();
  }
  try {
    const root = `${FileSystem.documentDirectory}models/`;
    const adapter = new ExecuTorchInferenceAdapter({
      visionModelPath:  `${root}llama-3.2-11b-vision.Q4_K_M.pte`,
      audioModelPath:   `${root}whisper-tiny.Q4.pte`,
      speakerModelPath: `${root}titanet-small.fp16.pte`,
      frameDecoder,
      audioDecoder,
    });
    return adapter;
  } catch (err) {
    if (err instanceof ExecuTorchUnavailableError) return new MockInferenceAdapter();
    throw err;
  }
}
```

The adapter itself never falls back — that decision lives in the factory so the package stays pure.

---

## 6. Build, install, run

```bash
# iOS (physical device)
eas build --profile development --platform ios
eas device:list                     # confirm device is registered
# Install via the QR code or `eas build:run --latest --platform ios`

# Android (physical device)
eas build --profile development --platform android
adb install -r ~/Downloads/lumina-development.apk
```

Open the dev build, accept the model-download prompt, wait for the SHA-256 verifications to complete, then **Profile → Train your Style Twin → Diagnose** to run the on-device gate.

---

## 7. Privacy validation checklist (the v2.0 invariant)

| ✅ | Check | Tool / command |
|---|---|---|
| ☐ | Device proxy points at host laptop | iOS: Settings → Wi-Fi → HTTP Proxy. Android: Wi-Fi → Modify Network. |
| ☐ | `mitmproxy --listen-host 0.0.0.0 --listen-port 8080` running | mitmproxy 11+ |
| ☐ | Model download phase shows traffic only to `models.lumina.app` | mitmproxy filter: `~d models.lumina.app` |
| ☐ | **Train run shows ZERO outbound bytes** | mitmproxy filter: `!~d models.lumina.app` during train |
| ☐ | **Retrain run shows ZERO outbound bytes** | same filter |
| ☐ | Airplane-mode train succeeds end-to-end | iOS Control Center / Android quick toggle |
| ☐ | Capture saved | `mitmproxy → File → Save flow → docs/audits/sprint-1-privacy-capture.flow` |
| ☐ | Voice/visual cosine ≥ 0.95 on the 10-clip self-fixture | in-app Diagnose screen |
| ☐ | Wall-time gate: train ≤ 90 s, retrain ≤ 8 s | in-app telemetry + stopwatch |
| ☐ | Memory resident ≤ 5.5 GB | iOS Instruments (Allocations) / Android Profiler |
| ☐ | Battery delta ≤ 3 % per training run | iOS Settings → Battery / Android Battery Usage |
| ☐ | App killed → relaunch → fingerprint persists, decrypts | confirm `verifyMatch().passes === true` |
| ☐ | Compliance footer reflects v2.0 stack | `CCPA · EU AI Act · COPPA · FTC · GDPR` |

Sign-off goes in `docs/audits/sprint-1-phase-complete.md` with the founding engineer's initials, the device serial, and the iOS/Android build SHA.

---

## 8. Failure modes and recovery

| Symptom | Likely cause | Fix |
|---|---|---|
| `ExecuTorchUnavailableError` on dev build | running Expo Go, simulator without `developmentClient`, or the plugin missing from `app.json` | rebuild with `eas build --profile development` after fixing `app.json`. |
| `ExecuTorchModelLoadError: ENOENT` | model OTA didn't finish or SHA-256 mismatch | re-trigger model download from Settings → Storage → Re-verify models. |
| Train wall-time > 90 s | thermal throttling or fp32 fallback | confirm `xnnpack-fp16` backend is active (see plugin config in §2a). |
| `mitmproxy` shows packets to anything other than `models.lumina.app` during train | a future commit imported a network-bound side effect | bisect via `git bisect run pnpm -F lumina test:privacy`. **This is a v2.0 release blocker.** |

---

## 9. What ships, what doesn't

| Artifact | Committed | Distributed via |
|---|---|---|
| `eas.json` | ✅ | git |
| `app.json` plugin block | ✅ | git |
| `react-native-executorch` dependency | ✅ | git (lockfile) |
| Adapter + decoders TypeScript | ✅ | git |
| `.pte` model files | ❌ | Expo OTA `models@v2` channel + private CDN |
| `MODEL_HASHES.txt` | ✅ | `docs/audits/` |
| Privacy capture | ✅ | `docs/audits/sprint-1-privacy-capture.flow` |

This is the only path to ungate the v2.0 English-First Beta. No code path that is not on this checklist may move that gate.
