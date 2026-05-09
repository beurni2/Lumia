/**
 * PHASE W2-AUTHOR HYBRID — wtsHtfQualityGate.ts
 *
 * Deterministic, log-/rotate-only quality gate for the
 * `whatToShow` and `howToFilm` user-facing trust-signal fields.
 *
 * USAGE
 *   passesV2Gate(wts, htf): boolean
 *     Pure predicate. Rejects an enumerated set of generic
 *     boilerplate phrases (case-insensitive), the
 *     `show the <noun> on camera` placeholder pattern, and any
 *     pair where `wts` and `htf` are byte-identical.
 *
 *   pickFromPoolWithGate(pool, idx, render, retries=4): T
 *     Rotates through `pool` starting at `idx` (mod pool.length)
 *     and returns the first item whose rendered (wts, htf) pair
 *     passes the gate. After `retries` failed attempts, FALLS
 *     THROUGH to the original `pool[idx]` candidate so the caller
 *     never under-fills.
 *
 * SCOPE
 *   This file does not change validators, schemas, prod flags,
 *   model usage, or corpus literals. It is purely a quality-axis
 *   tightening over generated `wts` / `htf` strings.
 */

const BANNED_PATTERNS: ReadonlyArray<string> = [
  String.raw`phone on a tripod`,
  String.raw`single static shot`,
  String.raw`single locked[- ]off shot`,
  String.raw`locked[- ]off on tripod`,
  String.raw`let the joke land`,
  String.raw`film yourself reacting`,
  String.raw`creator reacts`,
  // `show the <noun> on camera` placeholder. Single-token noun is
  // the dominant offender; the [a-z]+ class (case-insensitive flag
  // applied at compile site) catches every variant.
  String.raw`show the [a-z]+ on camera`,
];

export const WTS_HTF_BANNED_RE: RegExp = new RegExp(
  BANNED_PATTERNS.join("|"),
  "i",
);

/** Pure predicate. True iff the (wts, htf) pair contains no
 *  banned boilerplate phrase AND `wts !== htf`. */
export function passesV2Gate(
  whatToShow: string,
  howToFilm: string,
): boolean {
  if (typeof whatToShow !== "string" || typeof howToFilm !== "string") {
    return false;
  }
  // Byte-identical wts/htf is a sign the author copy-pasted one
  // surface into the other — drop the pair regardless of whether
  // either side trips a banned phrase.
  if (whatToShow === howToFilm) {
    return false;
  }
  if (WTS_HTF_BANNED_RE.test(whatToShow)) return false;
  if (WTS_HTF_BANNED_RE.test(howToFilm)) return false;
  return true;
}

/** Rotate through a pool of candidate items starting at `idx`,
 *  attempting up to `retries` items. Returns the first whose
 *  rendered (wts, htf) pair passes `passesV2Gate`. If every
 *  attempt fails, returns the original `pool[idx]` so the caller
 *  never under-fills.
 *
 *  - `pool` MUST be non-empty.
 *  - `idx` may be any integer; wrapped into [0, pool.length).
 *  - `render(item, absoluteIdx)` MUST be deterministic for the
 *    same `(item, absoluteIdx)` pair.
 *  - `retries` is clamped to `[1, pool.length]`. */
export function pickFromPoolWithGate<T>(
  pool: readonly T[],
  idx: number,
  render: (
    item: T,
    absoluteIdx: number,
  ) => { value: T; whatToShow: string; howToFilm: string },
  retries = 4,
): T {
  if (pool.length === 0) {
    throw new Error("pickFromPoolWithGate: pool must be non-empty");
  }
  const len = pool.length;
  const start = ((idx % len) + len) % len;
  const attempts = Math.min(Math.max(retries, 1), len);
  for (let i = 0; i < attempts; i++) {
    const at = (start + i) % len;
    const item = pool[at]!;
    const r = render(item, at);
    if (passesV2Gate(r.whatToShow, r.howToFilm)) {
      return r.value;
    }
  }
  // Fall through to the original candidate. NEVER under-fill.
  return pool[start]!;
}
