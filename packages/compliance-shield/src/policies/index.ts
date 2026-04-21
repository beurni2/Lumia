import type { PlatformId, PolicyPack } from "../types";
import { TIKTOK_PACK } from "./tiktok";
import { REELS_PACK } from "./reels";
import { SHORTS_PACK } from "./shorts";
import { KWAI_PACK } from "./kwai";
import { GOPLAY_PACK } from "./goplay";
import { KUMU_PACK } from "./kumu";

export const POLICY_PACKS: Record<PlatformId, PolicyPack> = {
  tiktok: TIKTOK_PACK,
  reels: REELS_PACK,
  shorts: SHORTS_PACK,
  kwai: KWAI_PACK,
  goplay: GOPLAY_PACK,
  kumu: KUMU_PACK,
};

export const ALL_PLATFORMS: readonly PlatformId[] = [
  "tiktok",
  "reels",
  "shorts",
  "kwai",
  "goplay",
  "kumu",
];

export { TIKTOK_PACK, REELS_PACK, SHORTS_PACK, KWAI_PACK, GOPLAY_PACK, KUMU_PACK };
