// -----------------------------------------------------------------------------
// Scene-object taxonomy — SCENE-OBJECT TAG spec
// -----------------------------------------------------------------------------
// 53-value tag enum + 5-value environment cluster, layered ON TOP OF
// the existing 25 rich SCENARIOS without adding new scenarios. Each
// existing scenarioFamily resolves to ONE primary `SceneObjectTag`,
// and each tag belongs to exactly ONE `SceneEnvCluster`. The
// selector enforces:
//
//   * Per-batch: max 1 sceneObjectTag, max 1 sceneEnvCluster.
//   * Cross-batch: -3 if tag in immediate-prior batch, -2 if in
//                  frequent-last-3, +3 boost when tag is in unused-
//                  in-last-3 (analogous to the scriptType tiered
//                  history).
//   * Regen: ≥1 pick must carry a sceneObjectTag NOT in the
//            immediate-prior batch (rescue then best-effort).
//
// The 53 tag ids and 5 cluster ids are spec-supplied verbatim. The
// 25 family→tag and 53 tag→cluster mappings are hand-tuned so
// (a) every existing scenarioFamily resolves to a UNIQUE primary
// tag (no two scenarios share a tag) and (b) every tag is assigned
// to exactly one of the 5 clusters.

// -----------------------------------------------------------------------------
// Cluster + tag literal types
// -----------------------------------------------------------------------------

export type SceneEnvCluster =
  | "kitchen"
  | "bedroom"
  | "phone_digital"
  | "outside"
  | "bathroom";

export const SCENE_ENV_CLUSTERS: readonly SceneEnvCluster[] = [
  "kitchen",
  "bedroom",
  "phone_digital",
  "outside",
  "bathroom",
] as const;

export type SceneObjectTag =
  | "fridge"
  | "sink"
  | "laundry"
  | "bed"
  | "phone"
  | "mirror"
  | "closet"
  | "car"
  | "desk"
  | "door"
  | "gym_bag"
  | "coffee"
  | "skincare"
  | "notifications"
  | "unread_messages"
  | "food_delivery"
  | "keys"
  | "shoes"
  | "playlist"
  | "calendar"
  | "to_do_list"
  | "alarm"
  | "water_bottle"
  | "couch"
  | "tv"
  | "laptop"
  | "bathroom"
  | "window"
  | "light_switch"
  | "trash"
  | "mail"
  | "packages"
  | "groceries"
  | "pantry"
  | "dishes"
  | "towel"
  | "outfit"
  | "hoodie"
  | "mirror_self"
  | "group_chat"
  | "notes_app"
  | "reminder"
  | "work_tab"
  | "spotify"
  | "youtube"
  | "doomscroll"
  | "bedroom_floor"
  | "kitchen_counter"
  | "dashboard"
  | "parking_spot"
  | "hallway"
  | "stairs"
  | "front_door";

export const SCENE_OBJECT_TAGS: readonly SceneObjectTag[] = [
  "fridge", "sink", "laundry", "bed", "phone", "mirror", "closet", "car",
  "desk", "door", "gym_bag", "coffee", "skincare", "notifications",
  "unread_messages", "food_delivery", "keys", "shoes", "playlist", "calendar",
  "to_do_list", "alarm", "water_bottle", "couch", "tv", "laptop", "bathroom",
  "window", "light_switch", "trash", "mail", "packages", "groceries", "pantry",
  "dishes", "towel", "outfit", "hoodie", "mirror_self", "group_chat",
  "notes_app", "reminder", "work_tab", "spotify", "youtube", "doomscroll",
  "bedroom_floor", "kitchen_counter", "dashboard", "parking_spot", "hallway",
  "stairs", "front_door",
] as const;

// -----------------------------------------------------------------------------
// Tag → environment cluster (1:1 — every tag in exactly one cluster)
// -----------------------------------------------------------------------------
// Cluster determines the FEEL of the scene, not strictly the
// physical room. e.g. `outfit` lives in the bedroom cluster even
// though the existing `outfit` scenario is filmed in the bathroom —
// the act of getting dressed reads as a bedroom-cluster moment.
// Same logic: `couch` in bedroom (lounge surface), `gym_bag` in
// bedroom (where the bag sits), `alarm` in phone_digital (alarms
// are phone-based for the audience).

export const ENV_CLUSTER_BY_TAG: Readonly<Record<SceneObjectTag, SceneEnvCluster>> = {
  // kitchen (10)
  fridge: "kitchen",
  sink: "kitchen",
  coffee: "kitchen",
  food_delivery: "kitchen",
  pantry: "kitchen",
  dishes: "kitchen",
  groceries: "kitchen",
  kitchen_counter: "kitchen",
  water_bottle: "kitchen",
  trash: "kitchen",
  // bedroom (13)
  bed: "bedroom",
  closet: "bedroom",
  alarm: "bedroom",
  bedroom_floor: "bedroom",
  outfit: "bedroom",
  hoodie: "bedroom",
  mirror_self: "bedroom",
  mirror: "bedroom",
  gym_bag: "bedroom",
  couch: "bedroom",
  laundry: "bedroom",
  desk: "bedroom",
  tv: "bedroom",
  // phone_digital (14)
  phone: "phone_digital",
  notifications: "phone_digital",
  unread_messages: "phone_digital",
  group_chat: "phone_digital",
  notes_app: "phone_digital",
  reminder: "phone_digital",
  work_tab: "phone_digital",
  spotify: "phone_digital",
  youtube: "phone_digital",
  doomscroll: "phone_digital",
  calendar: "phone_digital",
  playlist: "phone_digital",
  to_do_list: "phone_digital",
  laptop: "phone_digital",
  // bathroom (4)
  bathroom: "bathroom",
  towel: "bathroom",
  light_switch: "bathroom",
  skincare: "bathroom",
  // outside (12)
  car: "outside",
  dashboard: "outside",
  parking_spot: "outside",
  front_door: "outside",
  hallway: "outside",
  stairs: "outside",
  door: "outside",
  mail: "outside",
  packages: "outside",
  keys: "outside",
  window: "outside",
  shoes: "outside",
};

// Reverse lookup: cluster → tags. Built once at module load.
export const TAGS_BY_CLUSTER: Readonly<Record<SceneEnvCluster, readonly SceneObjectTag[]>> = (() => {
  const m: Record<SceneEnvCluster, SceneObjectTag[]> = {
    kitchen: [],
    bedroom: [],
    phone_digital: [],
    outside: [],
    bathroom: [],
  };
  for (const tag of SCENE_OBJECT_TAGS) {
    m[ENV_CLUSTER_BY_TAG[tag]].push(tag);
  }
  return m;
})();

// -----------------------------------------------------------------------------
// scenarioFamily → primary SceneObjectTag (25 mappings, all distinct)
// -----------------------------------------------------------------------------
// Each of the 25 existing rich scenarios resolves to ONE primary
// sceneObjectTag. Distinctness ensures the per-batch "max 1 same
// tag" guard always has effective discrimination on the existing
// pool — no two scenarios in the candidate pool share a tag, so
// the guard is effectively "max 1 per scenarioFamily" PLUS the tag
// dimension which lets us stack the cluster guard on top.
//
// Cluster distribution across the 25 families:
//   kitchen        : 5  (coffee, fridge, snack, hydration, dishes)
//   bedroom        : 7  (sleep, gym, laundry, outfit, cleaning,
//                        mirror_pep_talk, closet_pile)
//   phone_digital  : 8  (texting, emails, weekend_plans, productivity,
//                        morning, shopping, social_post, podcast)
//   outside        : 4  (errands, social_call, walk, doom_scroll_car)
//   bathroom       : 1  (skincare)
//   TOTAL          : 25 ✓

export const SCENE_OBJECT_TAG_BY_FAMILY: Record<string, SceneObjectTag> = {
  sleep: "bed",
  coffee: "coffee",
  gym: "gym_bag",
  laundry: "laundry",
  texting: "unread_messages",
  emails: "work_tab",
  fridge: "fridge",
  outfit: "outfit",
  errands: "car",
  weekend_plans: "group_chat",
  productivity: "doomscroll",
  cleaning: "bedroom_floor",
  social_call: "hallway",
  snack: "pantry",
  hydration: "water_bottle",
  morning: "alarm",
  shopping: "notifications",
  social_post: "phone",
  dishes: "dishes",
  podcast: "spotify",
  skincare: "skincare",
  mirror_pep_talk: "mirror",
  walk: "front_door",
  doom_scroll_car: "dashboard",
  closet_pile: "closet",
};

// -----------------------------------------------------------------------------
// Public lookups
// -----------------------------------------------------------------------------

/**
 * Resolve the primary scene-object tag for a scenario family.
 * Returns null on unknown families (Claude/Llama fallback whose
 * "scenarioFamily" is a free-form string we never registered).
 */
export function lookupSceneObjectTag(
  family: string | undefined | null,
): SceneObjectTag | null {
  if (!family) return null;
  return SCENE_OBJECT_TAG_BY_FAMILY[family] ?? null;
}

/**
 * Resolve the environment cluster for a tag. Returns null when the
 * tag isn't in the taxonomy (defensive — the union type makes this
 * unreachable for known callers, but cached-batch lookup paths pass
 * through arbitrary strings).
 */
export function lookupSceneEnvCluster(
  tag: SceneObjectTag | string | undefined | null,
): SceneEnvCluster | null {
  if (!tag) return null;
  return (
    (ENV_CLUSTER_BY_TAG as Record<string, SceneEnvCluster | undefined>)[tag] ??
    null
  );
}

/**
 * Convenience: resolve cluster directly from a scenarioFamily.
 * Returns null on unknown families.
 */
export function lookupSceneEnvClusterForFamily(
  family: string | undefined | null,
): SceneEnvCluster | null {
  const tag = lookupSceneObjectTag(family);
  if (!tag) return null;
  return ENV_CLUSTER_BY_TAG[tag];
}
