/**
 * Cache today's 3 region-conditioned ideas in AsyncStorage so the
 * Home screen renders instantly after onboarding (and on every
 * subsequent open within the same UTC day) without burning the
 * Ideator quota on every mount.
 *
 * The key includes the UTC day stamp so a midnight rollover
 * naturally invalidates the cache and we'll fetch a fresh batch.
 * It also includes the region — if the user re-runs onboarding
 * with a different region, the new region's ideas don't appear
 * to "miss" because they were keyed under the old region.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { IdeaCardData } from "@/components/IdeaCard";
import type { Bundle } from "@/constants/regions";

// Cache shape mirrors what the card actually renders. Aliasing
// rather than redeclaring keeps the two in lockstep — when the
// card grows a new field, the cache grows it for free with no
// risk of drift.
export type CachedIdea = IdeaCardData;

type Envelope = {
  region: Bundle;
  utcDay: string;
  ideas: CachedIdea[];
  cachedAt: string;
};

const KEY = "lumina:home-ideas:v1";

function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function readDailyIdeas(region: Bundle): Promise<CachedIdea[] | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const env: Envelope = JSON.parse(raw);
    if (env.region !== region) return null;
    if (env.utcDay !== utcDayKey()) return null;
    if (!Array.isArray(env.ideas) || env.ideas.length === 0) return null;
    return env.ideas;
  } catch {
    // Corrupted cache — treat as empty. The Home screen will fetch
    // fresh and overwrite on success.
    return null;
  }
}

export async function writeDailyIdeas(
  region: Bundle,
  ideas: CachedIdea[],
): Promise<void> {
  const env: Envelope = {
    region,
    utcDay: utcDayKey(),
    ideas,
    cachedAt: new Date().toISOString(),
  };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(env));
  } catch {
    // Best-effort — Home will simply re-fetch on next open if the
    // write was lost.
  }
}

export async function clearDailyIdeas(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // No-op — the worst case is a stale cache that gets
    // overwritten on the next successful fetch anyway.
  }
}
