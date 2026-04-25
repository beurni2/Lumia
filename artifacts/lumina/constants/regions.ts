/**
 * Region bundle definitions — the single source of truth for the
 * 7 supported countries and the 4 trend bundles they map onto.
 *
 * Both `MvpOnboarding` and `deriveStyleProfile` import `Bundle` from
 * here so we can't drift into having two slightly-different unions.
 *
 * The bundle strings must match `Region` in `@workspace/lumina-trends`
 * — server endpoints validate against that union, so a typo here
 * surfaces as a 400 from `/api/style-profile`.
 */

export type Bundle = "western" | "india" | "philippines" | "nigeria";

export type Country = {
  code: string;
  name: string;
  bundle: Bundle;
};

export const COUNTRIES: readonly Country[] = [
  { code: "US", name: "United States", bundle: "western" },
  { code: "GB", name: "United Kingdom", bundle: "western" },
  { code: "CA", name: "Canada", bundle: "western" },
  { code: "AU", name: "Australia", bundle: "western" },
  { code: "IN", name: "India", bundle: "india" },
  { code: "PH", name: "Philippines", bundle: "philippines" },
  { code: "NG", name: "Nigeria", bundle: "nigeria" },
];

const REGION_LABELS: Record<Bundle, string> = {
  western: "Western (US/UK/CA/AU)",
  india: "India",
  philippines: "Philippines",
  nigeria: "Nigeria",
};

export function regionLabel(b: Bundle): string {
  return REGION_LABELS[b];
}
