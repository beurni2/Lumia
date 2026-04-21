/**
 * Shared monetizer types. Kept in a leaf module so the brand graph,
 * pitch deck, DM draft, and Earnings agent can import without circulars
 * through `index.ts`.
 */

export type CulturalRegion =
  | "br" | "mx" | "co" | "ar"
  | "id" | "ph" | "vn" | "th";

/**
 * Sprint 4 Deal Router contract — re-declared here (mirrored in index.ts)
 * so storage backends can implement against `./types` without pulling the
 * full public surface.
 */
export interface DealRouter {
  matchBrands(videoId: string, region: string): Promise<Array<{ brandId: string; score: number }>>;
  draftPitch(videoId: string, brandId: string): Promise<string>;
}
