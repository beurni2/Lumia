/**
 * Web QA mode — temporary, flag-gated, single source of truth.
 *
 * Returns true ONLY when the app is running on web AND the env var
 * `EXPO_PUBLIC_WEB_QA_MODE` is the string "true". Native builds
 * (Expo Go, dev client, Simulator, real device) always return false
 * regardless of the env var, so this can never silently affect a
 * shipped binary.
 *
 * Why it exists
 * -------------
 * The Clerk web JS SDK fails to load through the current api-server
 * proxy (the proxy forwards Clerk's frontend API but not the CDN
 * `/npm/...` bundle path), which makes mobile-Safari sign-in
 * impossible without a deeper fix to the proxy. Combined with the
 * fact that the project requires a dev client (so Expo Go is also
 * out), there is currently no way to smoke-test the Phase 1
 * onboarding loop in a browser.
 *
 * QA mode opens a temporary path:
 *   - Skips Clerk entirely on web (the root layout swaps in
 *     `QaAwareRouter` instead of `AuthAwareRouter` and never mounts
 *     `ClerkProvider`).
 *   - Sends no Bearer token. The api-server's `resolveCreator`
 *     transparently maps un-authed requests to the seeded demo
 *     creator (`is_demo = TRUE`, name "Alex"), so every route still
 *     returns real data and writes to a real DB row.
 *   - Native modules need no extra mocking — `expo-camera` doesn't
 *     exist in the project (everything goes through
 *     `expo-image-picker`, which already has a `Platform.OS === "web"`
 *     branch in every callsite that returns a synthetic clip), and
 *     review's MediaLibrary save already early-returns with a
 *     friendly "open the app on your phone" message on web.
 *
 * Exit criteria
 * -------------
 * Remove the `EXPO_PUBLIC_WEB_QA_MODE=true` from `package.json` `dev`
 * (or set it to anything other than "true") once either:
 *   1. The iOS dev client is buildable (Apple Developer approval +
 *      `eas build --profile development --platform ios`), at which
 *      point the real Clerk native flow is the source of truth, or
 *   2. The Clerk proxy in `api-server/src/middlewares/clerkProxyMiddleware.ts`
 *      is extended to forward the CDN bundle path so Clerk web works
 *      in mobile Safari natively.
 *
 * After either of those, this whole file (and the `QaAwareRouter` +
 * the `(auth)` screen guards) can be deleted in one revert commit.
 */

import { Platform } from "react-native";

export function isWebQaMode(): boolean {
  return (
    Platform.OS === "web" &&
    process.env.EXPO_PUBLIC_WEB_QA_MODE === "true"
  );
}
