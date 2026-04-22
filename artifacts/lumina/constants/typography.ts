/**
 * Lumina typography scale — the 2026 Bioluminescent system in type form.
 *
 * Brief specifies Clash Display + Satoshi (commercial fonts). Until those
 * licenses are procured, we substitute:
 *   • Display → Space Grotesk (Google Fonts, geometric, free)
 *   • Body / Subhead → Inter (already loaded, exceptional readability)
 *
 * To swap in real Clash/Satoshi later, only the `display` and `subhead`
 * fontFamily entries below need to change. Every screen reads from here.
 */

import { TextStyle } from "react-native";

export const fontFamily = {
  display: "SpaceGrotesk_700Bold",
  displayHeavy: "SpaceGrotesk_700Bold",
  subhead: "SpaceGrotesk_500Medium",
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemiBold: "Inter_600SemiBold",
  bodyBold: "Inter_700Bold",
  italic: "Inter_400Regular",
} as const;

/**
 * Text styles, named by intent, not by size. Components should reference
 * `type.heroDisplay` not "56pt bold".
 */
export const type = {
  /** 56–92 pt collapsing-star headline. -2% tracking, outer glow on key moments. */
  heroDisplay: {
    fontFamily: fontFamily.displayHeavy,
    fontSize: 64,
    lineHeight: 68,
    letterSpacing: -1.3,
  } satisfies TextStyle,

  display: {
    fontFamily: fontFamily.displayHeavy,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -0.9,
  } satisfies TextStyle,

  /** 28–36 pt agent names + section heads. */
  subhead: {
    fontFamily: fontFamily.subhead,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.4,
  } satisfies TextStyle,

  subheadSm: {
    fontFamily: fontFamily.subhead,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.2,
  } satisfies TextStyle,

  /** 17 pt body + reasoning bubbles, 1.4 line-height, warm off-white. */
  body: {
    fontFamily: fontFamily.body,
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: -0.1,
  } satisfies TextStyle,

  bodyEmphasis: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: -0.1,
  } satisfies TextStyle,

  /** Used for button labels + small UI affordances. */
  label: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.1,
  } satisfies TextStyle,

  /** 14 pt micro-delight copy — light italic with subtle scale-in. */
  microDelight: {
    fontFamily: fontFamily.italic,
    fontStyle: "italic",
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0,
    opacity: 0.85,
  } satisfies TextStyle,

  /** Numerics for earnings, counters — tabular feel. */
  numeric: {
    fontFamily: fontFamily.displayHeavy,
    fontSize: 56,
    lineHeight: 60,
    letterSpacing: -1.5,
  } satisfies TextStyle,
} as const;

export type TypeKey = keyof typeof type;
