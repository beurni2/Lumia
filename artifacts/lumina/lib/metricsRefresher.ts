import {
  TikTokPostingClient,
  InstagramPostingClient,
  YouTubePostingClient,
  type PlatformAuthId,
} from "@workspace/swarm-studio";
import {
  getPlatformAuthRegistry,
  type PlatformAuthRegistry,
} from "./oauth/platformAuthRegistry";

export interface PublicationLite {
  readonly id: string;
  readonly platform: string;
  readonly status: string;
  readonly platformPostId?: string | null;
  readonly metrics?: unknown;
}

export interface PlatformMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

export type MetricsPatchFn = (args: {
  pubId: string;
  data: PlatformMetrics;
}) => Promise<unknown>;

/** Map publisher platform ids → OAuth client ids. */
function authIdFor(platform: string): PlatformAuthId | null {
  if (platform === "tiktok") return "tiktok";
  if (platform === "reels") return "instagram";
  if (platform === "shorts") return "youtube";
  return null;
}

/**
 * Walks the publications list for a video, fetches fresh metrics from each
 * supported platform via the corresponding OAuth posting client, and PATCHes
 * the result back to the API. Silently skips rows without a platformPostId
 * (mock-mode publications) or when the OAuth provider isn't configured.
 *
 * Returns the number of rows successfully refreshed so the UI can surface
 * a small "Refreshed N" toast.
 */
export async function refreshAllMetricsForVideo(
  publications: readonly PublicationLite[],
  patch: MetricsPatchFn,
  registry: PlatformAuthRegistry = getPlatformAuthRegistry(),
  igExtras?: () => Promise<{ igUserId: string }>,
): Promise<{ refreshed: number; skipped: number }> {
  let refreshed = 0;
  let skipped = 0;

  await Promise.all(
    publications.map(async (pub) => {
      const authId = authIdFor(pub.platform);
      if (!authId || !pub.platformPostId) {
        skipped += 1;
        return;
      }
      if (!registry.providers[authId]) {
        skipped += 1;
        return;
      }
      try {
        let data: PlatformMetrics;
        if (authId === "tiktok") {
          const c = new TikTokPostingClient(registry.tokens);
          data = await c.fetchMetrics(pub.platformPostId);
        } else if (authId === "instagram") {
          if (!igExtras) {
            skipped += 1;
            return;
          }
          const c = new InstagramPostingClient(registry.tokens, igExtras);
          data = await c.fetchMetrics(pub.platformPostId);
        } else {
          const c = new YouTubePostingClient(registry.tokens);
          data = await c.fetchMetrics(pub.platformPostId);
        }
        await patch({ pubId: pub.id, data });
        refreshed += 1;
      } catch {
        // Token refresh failures, network blips, sandbox accounts without
        // analytics access — all non-fatal. Skip and let the next tick try.
        skipped += 1;
      }
    }),
  );

  return { refreshed, skipped };
}
