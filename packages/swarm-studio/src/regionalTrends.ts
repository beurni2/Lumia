import type { CulturalRegion } from "./types";

/**
 * Sprint 2 trend pool — hand-curated per region so the MockOrchestrator can
 * produce culturally plausible briefs in Expo Go without the Sprint 3 nightly
 * trend-sync (which arrives via @workspace/edge-cloud TrendSyncClient).
 *
 * The TrendSyncClient will replace this constant with encrypted on-device
 * deltas pulled from a stateless burst endpoint. Same shape, same UX.
 */
export interface RegionalTrend {
  id: string;
  hook: string;
  audioCue: string;
  culturalTag: string;
  beats: string[];
}

export const REGIONAL_TRENDS: Record<CulturalRegion, RegionalTrend[]> = {
  // Day-1 English-first markets (v2.0 GTM blueprint)
  us: [
    {
      id: "us-y2k-thrift",
      hook: "you won't believe what $20 got me at this thrift store",
      audioCue: "Olivia Rodrigo · sped up",
      culturalTag: "thrift-flip",
      beats: ["mirror reveal", "before/after cut", "outfit walk"],
    },
    {
      id: "us-grwm-nyfw",
      hook: "GRWM for my first NYFW after-party",
      audioCue: "Doja Cat · slowed",
      culturalTag: "grwm-fashion-week",
      beats: ["bare face", "outfit drop", "final twirl"],
    },
    {
      id: "us-cafe-brooklyn",
      hook: "the Brooklyn matcha that's breaking TikTok",
      audioCue: "lo-fi café",
      culturalTag: "hidden-gem-cafe",
      beats: ["walk-in shot", "menu close-up", "first sip reaction"],
    },
  ],
  gb: [
    {
      id: "gb-london-streetstyle",
      hook: "London street style under £30",
      audioCue: "UK garage edit",
      culturalTag: "streetstyle",
      beats: ["walking shot", "outfit details", "final pose"],
    },
  ],
  ca: [
    {
      id: "ca-toronto-eats",
      hook: "ranking Toronto's best $10 lunch",
      audioCue: "Drake · slowed",
      culturalTag: "food-rank",
      beats: ["spot walk-up", "bite test", "score reveal"],
    },
  ],
  au: [
    {
      id: "au-bondi-grwm",
      hook: "GRWM for a Bondi sunrise swim",
      audioCue: "indie surf-pop",
      culturalTag: "grwm-lifestyle",
      beats: ["bare face", "fit pick", "beach walk"],
    },
  ],
  in: [
    {
      id: "in-mumbai-cafe",
      hook: "the Mumbai café everyone's posting about",
      audioCue: "indie Hindi chill",
      culturalTag: "hidden-gem-cafe",
      beats: ["entry shot", "menu close-up", "first sip"],
    },
  ],
  ng: [
    {
      id: "ng-lagos-fit",
      hook: "Lagos street fits under ₦15k",
      audioCue: "Burna Boy · slowed",
      culturalTag: "streetstyle",
      beats: ["market walk", "outfit reveal", "price flash"],
    },
  ],
  // Phase 1 SEA/LATAM markets (engine-ready, layered remotely months 2–6)
  br: [
    {
      id: "br-y2k-thrift",
      hook: "you won't believe what 20 reais got me",
      audioCue: "Tubarão Te Amo · funk remix",
      culturalTag: "thrift-flip",
      beats: ["mirror reveal", "before/after cut", "outfit walk"],
    },
    {
      id: "br-grwm-spfw",
      hook: "POV: getting ready for SPFW",
      audioCue: "Anitta · slowed",
      culturalTag: "grwm-fashion-week",
      beats: ["bare face", "outfit drop", "final twirl"],
    },
    {
      id: "br-cafe-liberdade",
      hook: "the matcha that broke São Paulo",
      audioCue: "lo-fi café",
      culturalTag: "hidden-gem-cafe",
      beats: ["walk-in shot", "menu close-up", "first sip reaction"],
    },
  ],
  mx: [
    {
      id: "mx-glow-up-cdmx",
      hook: "1 mes, 0 maquillaje, todo glow",
      audioCue: "Bad Bunny · perreo",
      culturalTag: "glow-up-routine",
      beats: ["bare face", "step-by-step routine", "after reveal"],
    },
    {
      id: "mx-tianguis-haul",
      hook: "lo que encontré en el tianguis hoy",
      audioCue: "cumbia remix",
      culturalTag: "market-haul",
      beats: ["walking the stalls", "haul lay-down", "favorite pick"],
    },
  ],
  co: [
    {
      id: "co-medellin-aesthetic",
      hook: "Medellín tiene el mejor café del mundo",
      audioCue: "Karol G · slowed",
      culturalTag: "city-aesthetic",
      beats: ["wide shot", "cup pour", "final sip"],
    },
  ],
  ar: [
    {
      id: "ar-bsas-streetstyle",
      hook: "estilo porteño en 60 segundos",
      audioCue: "tango electronico",
      culturalTag: "streetstyle",
      beats: ["walking shot", "outfit details", "final pose"],
    },
  ],
  id: [
    {
      id: "id-warung-flex",
      hook: "30rb dapet apa aja di warung ini",
      audioCue: "dangdut remix",
      culturalTag: "street-food",
      beats: ["warung exterior", "food close-up", "first bite reaction"],
    },
    {
      id: "id-kos-glow-up",
      hook: "transform kamar kos jadi aesthetic",
      audioCue: "indie chill",
      culturalTag: "room-makeover",
      beats: ["before shot", "transformation timelapse", "final reveal"],
    },
  ],
  ph: [
    {
      id: "ph-jeepney-route",
      hook: "manila in one jeepney ride",
      audioCue: "OPM acoustic",
      culturalTag: "city-tour",
      beats: ["board jeepney", "window views", "final stop reveal"],
    },
  ],
  vn: [
    {
      id: "vn-banhmi-rank",
      hook: "ranking Saigon's banh mi",
      audioCue: "vietnamese chillhop",
      culturalTag: "food-rank",
      beats: ["stall walk-up", "bite test", "score reveal"],
    },
  ],
  th: [
    {
      id: "th-bkk-streetstyle",
      hook: "Bangkok fits under 500 baht",
      audioCue: "thai indie",
      culturalTag: "streetstyle",
      beats: ["market walk", "outfit reveal", "price flash"],
    },
  ],
};
