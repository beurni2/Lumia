/**
 * Maps stable string keys returned by the API (e.g. "creator-1") to the
 * locally bundled Metro asset references. The API returns metadata only;
 * images stay bundled into the app for offline / performance reasons.
 */
import { ImageSourcePropType } from "react-native";

const IMAGES: Record<string, ImageSourcePropType> = {
  "creator-1": require("@/assets/images/creator-1.png") as ImageSourcePropType,
  "creator-2": require("@/assets/images/creator-2.png") as ImageSourcePropType,
  "creator-3": require("@/assets/images/creator-3.png") as ImageSourcePropType,
};

const FALLBACK = IMAGES["creator-1"]!;

export function getImage(key: string | undefined | null): ImageSourcePropType {
  if (!key) return FALLBACK;
  return IMAGES[key] ?? FALLBACK;
}
