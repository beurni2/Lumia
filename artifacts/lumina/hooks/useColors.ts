import colors, { agents, cosmic, dawn, lumina } from "@/constants/colors";
import type { AgentKey } from "@/constants/colors";

/**
 * Returns the active design token set. Lumina is dark-first by intent —
 * the cosmic void is the canvas — but light mode tokens are preserved
 * for the "Dawn" theme used by the Morning Recap screen.
 */
export function useColors() {
  return {
    ...colors.dark,
    radius: colors.radius,
    radiusLg: colors.radiusLg,
    radiusFull: colors.radiusFull,
    lumina,
    cosmic,
    dawn,
    agents,
  };
}

/** Convenience: get a specific agent's color identity. */
export function useAgentColor(key: AgentKey) {
  return agents[key];
}

export type LuminaColors = ReturnType<typeof useColors>;
