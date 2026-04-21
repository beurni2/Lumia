import colors from "@/constants/colors";

/**
 * Returns the design tokens for the current color scheme.
 * Lumina is dark-first by design — we always return the dark palette.
 */
export function useColors() {
  return { ...colors.dark, radius: colors.radius };
}
