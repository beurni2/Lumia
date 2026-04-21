# Real-Device Test Runbook — Lumina v2.0

> **Purpose.** Founder-facing, copy-paste checklist to take the just-shipped on-device inference (`d1f8357`) + sandbox OAuth/posting (`fdff2f5`) from a fresh laptop to a working iPhone/Pixel that posts a real Llama-generated Short to TikTok / Reels / YouTube **sandbox** accounts.
>
> **Companion docs (read first if you've never run an EAS build):**
> - `docs/EAS_DEV_BUILD_RUNBOOK.md` — the deep reference (export pipeline, OTA, hashes, privacy checklist).
> - `FOUNDER_DEMO_SCRIPT.md` — the 4-minute demo this runbook validates.
>
> **Total wall time:** ~4 h first run · ~25 min for re-flashes.
> **You will need:** macOS 14+ · Xcode 16 · Android Studio Koala+ · 1× iPhone 13 Pro+ · 1× Pixel 7+ · Apple Developer + Google Play accounts · TikTok/Meta/Google sandbox apps already created.

---

## Phase 0 — One-time host bootstrap (~30 min)

```bash
# Toolchain
brew install cmake ninja git-lfs ffmpeg
git lfs install

# Node, pnpm, Expo, EAS
nvm install 24 && nvm use 24
npm i -g pnpm@9 expo eas-cli
eas login                      # use the Lumina org account
eas whoami                     # sanity check

# Python side (model export)
python3.11 -m venv ~/.venv/lumina && source ~/.venv/lumina/bin/activate
pip install --upgrade pip
pip install "executorch>=0.4.0" "torch>=2.4.0" "transformers>=4.45.0" \
            huggingface_hub soundfile librosa
huggingface-cli login          # accept the Llama 3.2 license under your HF account

# Repo
git clone git@github.com:lumina/lumina.git && cd lumina
pnpm install
```

**Gate check** — must all be green before continuing:

```bash
pnpm -r --workspace-concurrency=1 test 2>&1 | grep -E "PASS|FAIL"
# Expect: 22 PASS · 0 FAIL  (api-server is intentionally frozen)
pnpm --filter @workspace/lumina exec tsc --noEmit
# Expect: no output (clean)
```

---

## Phase 1 — Build the custom EAS dev-build (~90 min first run)

### 1.1 Register the physical devices

```bash
eas device:create               # iPhone — open the link on the device, install the profile
eas device:create               # Pixel — same flow; pick "Android" when prompted
eas device:list                 # confirm both UDIDs appear
```

### 1.2 Sandbox env file

Create `artifacts/lumina/.env.development` (this file is **gitignored**):

```bash
EXPO_PUBLIC_INFERENCE_BACKEND=executorch
EXPO_PUBLIC_PUBLISHER_BACKEND=real
EXPO_PUBLIC_PLATFORM_MODE=sandbox
EXPO_PUBLIC_REDIRECT_SCHEME=lumina

EXPO_PUBLIC_TIKTOK_CLIENT_ID=<sandbox client_key from TikTok Devs Portal>
EXPO_PUBLIC_TIKTOK_CLIENT_SECRET=<sandbox client_secret>

EXPO_PUBLIC_INSTAGRAM_CLIENT_ID=<Meta App ID, dev mode>
EXPO_PUBLIC_INSTAGRAM_CLIENT_SECRET=<Meta App secret>

EXPO_PUBLIC_YOUTUBE_CLIENT_ID=<Google OAuth client, Testing status>
EXPO_PUBLIC_YOUTUBE_CLIENT_SECRET=<Google client secret>
```

### 1.3 Kick the cloud builds

```bash
cd artifacts/lumina

# iOS — internal distribution, signed for the registered iPhone(s)
eas build --profile development --platform ios

# Android — APK suitable for direct install via adb
eas build --profile development --platform android
```

When each build finishes (~30–45 min), EAS prints a download URL. Keep both URLs open — you'll need them in Phase 2.

> **First build only:** EAS will prompt to generate iOS distribution certs + provisioning profiles and an Android keystore. Accept the defaults; EAS stores them in the project.

---

## Phase 2 — Install on a physical device (~10 min)

### 2.1 iPhone

1. On the iPhone, open the EAS download URL in **Safari** (Chrome won't work — it can't install ad-hoc IPAs).
2. Tap **Install**.
3. iPhone → Settings → General → VPN & Device Management → trust the Lumina developer profile.
4. Open the app — you should see the Lumina splash, then the onboarding screen.

### 2.2 Pixel (Android)

```bash
# From the laptop, with the Pixel plugged in via USB and developer mode on
adb devices                     # confirm device shows "device", not "unauthorized"
curl -L -o lumina-dev.apk "<the EAS Android URL>"
adb install -r lumina-dev.apk
adb shell am start -n com.lumina.app/.MainActivity
```

### 2.3 Push the model bundle (one-time, ~6.5 GB)

The `.pte` files are NEVER in the repo — they ship via Expo OTA channel `models@v2`:

```bash
cd artifacts/lumina
eas update --branch models@v2 --message "models v2 — Llama 3.2 11B Q4_K_M + Whisper-tiny + TitaNet-small"
```

On first launch, the app downloads the bundle (Wi-Fi recommended), verifies SHA-256 against `docs/audits/MODEL_HASHES.txt`, and stores it in the device's app sandbox. **Watch the in-app progress bar — it should reach 100% with a green "Models verified ✓" toast.**

---

## Phase 3 — End-to-end real Llama 3.2 Vision inference test (~15 min)

Mirrors the first half of `FOUNDER_DEMO_SCRIPT.md`. Record the screen — these timings are the demo's source of truth.

| Step | What to do on the device | Pass criteria |
|---|---|---|
| 3.1 | Tap **Train your Style Twin** | Camera + mic permission prompts appear — grant both |
| 3.2 | Record three 30-s clips (talking-head, B-roll, action) | Each clip preview plays back; "Process" button enables |
| 3.3 | Tap **Process** | Progress card shows 5 stages: `decode → vision → speaker → transcript → aggregate`; total wall time ≤ **180 s on iPhone 13 Pro**, ≤ **240 s on Pixel 7** |
| 3.4 | Twin Card appears | Audio gate ≥ 0.95 · Visual gate ≥ 0.90 · "On-Twin" badge green |
| 3.5 | Toggle **Airplane mode** ON, repeat 3.3 with a 4th clip | Processing still completes — confirms zero outbound bytes |
| 3.6 | Inspect logs from the laptop | `npx react-native log-ios` (or `adb logcat | grep Lumina`) — must contain `[executorch] models loaded` and **must NOT contain** `[mock] inference` |

If 3.6 shows `[mock] inference`, the env flag didn't bake in — rebuild after fixing `.env.development`.

---

## Phase 4 — Sandbox posting verification (~20 min)

Pre-req: in each platform's developer console, add the test account's username to the sandbox/test users list. (TikTok: "Sandbox" tab → Add user. Meta: App Roles → Testers. Google: OAuth consent screen → Test users.)

### 4.1 Connect each platform

In the app: **Profile → Connected Accounts**

For each of TikTok / Instagram / YouTube:

1. Tap **Connect**.
2. The system browser opens (`ASWebAuthenticationSession` on iOS, Custom Tabs on Android).
3. Sign in with the **sandbox test account**.
4. Approve the requested scopes.
5. The browser closes; the row flips to **Connected · Sandbox** (orange badge).

**Verify token storage** (laptop, with device plugged in):

```bash
# iOS
xcrun simctl spawn booted defaults read com.lumina.app   # nothing — Keychain is encrypted
# Confirm vault entry exists (won't print value):
security find-generic-password -s "lumina.oauth.tiktok" -g 2>&1 | grep -E "acct|svce"

# Android — same: values are EncryptedSharedPreferences, won't print
adb shell run-as com.lumina.app ls files/ | grep -i secure
```

If those return entries (without leaking the token), the secure vault is working.

### 4.2 Post a Short to all three

1. Style Twin done (Phase 3) → tap **Generate** on Swarm Studio's daily brief card.
2. Wait for the editor to render the 28-s vertical video.
3. Tap **Launch to the World** → confirm the picker shows TikTok / Reels / Shorts pre-selected (Day-1 v2.0 default).
4. Tap **Publish**.

**Pass criteria — wait up to 90 s, then check the platforms:**

| Platform | Where to verify | Expected |
|---|---|---|
| TikTok | Sandbox Inbox in TikTok Developers Portal → Content Posting | New `publish_id` row, status `PROCESSING_DOWNLOAD` → `PUBLISH_COMPLETE` |
| Instagram | Sandbox test account → Reels tab | New Reel visible (only the test account can see it) |
| YouTube | studio.youtube.com under the test channel → Content | New video, **Visibility: Private** (sandbox safety) |

**In-app verification:** the post-publish recap card must show 3 rows, each with `posted` status, the orange `Sandbox` badge, and a tappable URL/remoteId. **No row should say `Compliance Shield blocked` or `Connect your account` — those are bugs.**

### 4.3 Token refresh smoke test

1. In the app: **Profile → Connected Accounts → TikTok → Force expire** (dev-only debug button).
2. Trigger another post (any cached video).
3. Watch logs — expect:

```
[oauth] tiktok access_token expires in 30s — refreshing
[oauth] tiktok refresh OK — new expiry +3600s
[publisher] tiktok posted publish_id=...
```

If you instead see `NotAuthenticatedError`, the refresh token wasn't issued — re-check that `prompt=consent` (Google) and `scope=video.publish` (TikTok) are in the auth URL.

---

## Phase 5 — Sign-off

Tick every box before declaring v2.0 beta-ready:

- [ ] Phase 0 — `pnpm test` shows 22 PASS, lumina typecheck clean.
- [ ] Phase 1 — both EAS builds completed without errors; artifacts downloaded.
- [ ] Phase 2 — app launches on iPhone **and** Pixel; OTA model bundle verified.
- [ ] Phase 3 — Style Twin trains in airplane mode; logs show `[executorch]` not `[mock]`.
- [ ] Phase 4.1 — all three platforms show **Connected · Sandbox**.
- [ ] Phase 4.2 — all three sandbox accounts received the test post within 90 s.
- [ ] Phase 4.3 — forced token expiry triggers a successful silent refresh.
- [ ] Screen-recording of Phases 3–4 archived to `launch/evidence/v2.0-beta-readiness-<date>.mp4`.

When all boxes are ticked, file the **"v2.0 Beta-Ready"** issue and tag `@compliance` for the Phase-5 privacy + posting audit (see `docs/EAS_DEV_BUILD_RUNBOOK.md` §9).

---

## Failure modes & quick recovery

| Symptom | Likely cause | Fix |
|---|---|---|
| App crashes on launch with `executorch: model not found` | OTA bundle didn't reach device | Re-run `eas update --branch models@v2`; force-quit + reopen app |
| Style Twin training stalls at "vision" stage | Llama `.pte` failed SHA-256 | Compare against `docs/audits/MODEL_HASHES.txt`; re-export + republish |
| `[mock] inference` in logs despite `executorch` flag | `.env.development` not picked up at build time | Re-run `eas build --profile development --platform <ios\|android> --clear-cache` |
| OAuth browser closes immediately with no callback | Redirect URI mismatch | URI in dev console must be exactly `lumina://oauth/<platform>` (lowercase, no trailing slash) |
| TikTok post returns `unaudited_client_can_only_post_to_private_accounts` | Sandbox tester not added | TikTok Devs Portal → Sandbox → Add tester username |
| YouTube post returns `403 youtubeSignupRequired` | Test channel not created | Sign in to youtube.com once with the test account, create a channel |
| Instagram `media_publish` returns `subcode 2207052` | Container still uploading | The publisher polls `status_code=FINISHED`; a real-world fix is to retry after 10 s |
