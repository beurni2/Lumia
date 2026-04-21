import { useColorScheme } from "react-native";
import colors from "@/constants/colors";

/**
 * Returns the design tokens for the current color scheme.
 * Force dark mode for Lumina.
 */
export function useColors() {
  const palette = "dark" in colors ? (colors as any).dark : colors.light;
  return { ...palette, radius: colors.radius };
}
