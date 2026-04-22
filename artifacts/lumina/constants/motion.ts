/**
 * Lumina motion tokens — the spring curves and durations that give every
 * animation in the app the same "settle" feel.
 *
 * Brief specifies: 280–420 ms transitions with custom spring curves
 * (0.8 damping, 180 stiffness) for the premium "bloom and overshoot" feel.
 *
 * Every Reanimated `withSpring` / `withTiming` call should pull from here.
 */

import { Easing } from "react-native-reanimated";

/** Spring curves — the heart of Lumina motion. */
export const spring = {
  /** Default: gentle overshoot, 280–340 ms perceptual settle. */
  settle: { damping: 14, stiffness: 180, mass: 1 },
  /** Snappier — for taps and tight feedback. */
  tap: { damping: 18, stiffness: 280, mass: 0.8 },
  /** Bigger, looser — for hero blooms (orb expansion, agent emergence). */
  bloom: { damping: 11, stiffness: 140, mass: 1.1 },
  /** Slow heartbeat — for ambient pulses (Soul Check orb, breathing borders). */
  heartbeat: { damping: 8, stiffness: 60, mass: 1.4 },
} as const;

/** Linear timing curves with named easings — for color/opacity tweens. */
export const timing = {
  fast: { duration: 180, easing: Easing.out(Easing.cubic) },
  base: { duration: 280, easing: Easing.out(Easing.cubic) },
  slow: { duration: 420, easing: Easing.bezier(0.22, 1, 0.36, 1) },
  ambient: { duration: 1800, easing: Easing.inOut(Easing.sin) },
} as const;

/** Durations for non-Reanimated paths (LayoutAnimation, CSS-like animations). */
export const duration = {
  instant: 120,
  fast: 180,
  base: 280,
  slow: 420,
  ambient: 1800,
  recap: 3200,
} as const;

/** Reduced-motion fallback — same shape, no overshoot. */
export const reducedMotion = {
  spring: { damping: 30, stiffness: 220, mass: 1 },
  timing: { duration: 200, easing: Easing.linear },
} as const;
