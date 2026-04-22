/**
 * Lumina 2026 Bioluminescent Design System — single source of truth.
 *
 * Mood: a private midnight greenhouse where Studio Ghibli fireflies meet
 * Apple Vision Pro spatial depth. Every token below feeds the
 * `<CosmicBackdrop>`, `<GlassSurface>`, `<FireflyParticles>` foundation
 * primitives and the per-agent visualization layer.
 *
 * If you change a hex here, audit `useColors()` consumers — the whole app
 * pulls from this file.
 */

export const lumina = {
  /** Deep electric amethyst — the heart of the brand. Pulses brighter on wins. */
  core: "#6B1EFF",
  coreSoft: "#8B4DFF",
  coreDeep: "#3B0DA8",

  /** Vibrant cyan-teal — Firefly Energy, reacts to agent activity. */
  firefly: "#00FFCC",
  fireflySoft: "#5CFFE0",

  /** Hot magenta — Cheeky Spark for delight moments, confetti, CTAs. */
  spark: "#FF1E9E",
  sparkSoft: "#FF6BBD",

  /** Victory Gold gradient (from → to) with soft radial bloom. */
  goldFrom: "#FFEA80",
  goldTo: "#FFD700",
} as const;

/** Cosmic Void Base — the dark canvas. */
export const cosmic = {
  voidTop: "#0A0824",
  voidBottom: "#1F1B45",
  voidMid: "#15123A",
} as const;

/** Dawn Light — warm, alive, with micro bioluminescent veins. */
export const dawn = {
  top: "#F9F6FF",
  bottom: "#FFF8EB",
  mid: "#FCF1F0",
} as const;

/**
 * Per-agent color identity. Used by avatars, reasoning bubbles, neural
 * threads, and the chromatic edge of GlassSurface when an agent is active.
 */
export const agents = {
  ideator: { hex: "#00FFCC", name: "Firefly", glow: "rgba(0,255,204,0.45)" },
  director: { hex: "#FF1E9E", name: "Spark", glow: "rgba(255,30,158,0.45)" },
  editor: { hex: "#FFD700", name: "Gold", glow: "rgba(255,215,0,0.45)" },
  monetizer: { hex: "#6B1EFF", name: "Amethyst", glow: "rgba(107,30,255,0.45)" },
} as const;

export type AgentKey = keyof typeof agents;

const colors = {
  light: {
    text: "#0B0824",
    tint: lumina.core,

    background: dawn.top,
    backgroundAlt: dawn.bottom,
    foreground: "#0B0824",

    card: "rgba(255,255,255,0.65)",
    cardForeground: "#0B0824",

    primary: lumina.core,
    primaryForeground: "#FFFFFF",

    secondary: "#F0E9FF",
    secondaryForeground: "#3B0DA8",

    muted: "#F0E9FF",
    mutedForeground: "#6B6485",

    accent: lumina.spark,
    accentForeground: "#FFFFFF",

    firefly: lumina.firefly,
    spark: lumina.spark,
    gold: lumina.goldTo,

    destructive: "#EF4444",
    destructiveForeground: "#FFFFFF",

    border: "rgba(107,30,255,0.18)",
    borderGlow: "rgba(107,30,255,0.35)",
    input: "rgba(107,30,255,0.18)",
  },

  dark: {
    text: "#F6F3FF",
    tint: lumina.core,

    background: cosmic.voidTop,
    backgroundAlt: cosmic.voidBottom,
    foreground: "#F6F3FF",

    /** Glassmorphism 2.0 default surface — 25% opacity over the void. */
    card: "rgba(255,255,255,0.06)",
    cardForeground: "#F6F3FF",

    primary: lumina.core,
    primaryForeground: "#FFFFFF",

    secondary: "#1F1A4A",
    secondaryForeground: "#E9E3FF",

    muted: "#1A1740",
    mutedForeground: "#9B95C2",

    accent: lumina.spark,
    accentForeground: "#FFFFFF",

    firefly: lumina.firefly,
    spark: lumina.spark,
    gold: lumina.goldTo,

    destructive: "#F87171",
    destructiveForeground: "#1A0820",

    /** 0.8 px neon border with 8 % opacity inner glow. */
    border: "rgba(255,255,255,0.08)",
    borderGlow: "rgba(0,255,204,0.22)",
    input: "rgba(255,255,255,0.08)",
  },

  radius: 22,
  radiusLg: 32,
  radiusFull: 999,
} as const;

export type LuminaColorScheme = "light" | "dark";
export default colors;
