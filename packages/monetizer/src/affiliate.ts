/**
 * Affiliate detection.
 *
 * Scans video metadata (caption, hook, description) for affiliate links
 * and partner-program codes, normalises them, and returns a deterministic
 * `AffiliateMatch[]`. Used by the Earnings Engine to attribute incremental
 * revenue back to a specific Lumina-generated video.
 *
 * Sprint 4 starter — covers the canonical SEA/LATAM affiliate networks our
 * 1K–50K creators actually use. Sprint 5 will swap the static program table
 * for the live brand-graph reputation index.
 */

export type AffiliateNetwork =
  | "amazon-associates"
  | "shopee-affiliate"
  | "lazada-affiliate"
  | "tokopedia-affiliate"
  | "magalu-parceiro"
  | "mercado-livre"
  | "tiktok-shop"
  | "kwai-shop"
  | "rakuten"
  | "linktree-monetized";

export interface AffiliateMatch {
  readonly network: AffiliateNetwork;
  /** Normalised tracking code or tag identifier extracted from the URL. */
  readonly trackingCode: string;
  /** Canonical URL, lowercased, with non-tracking query params stripped. */
  readonly canonicalUrl: string;
  /** Where the link was found, in deterministic scan order. */
  readonly source: "caption" | "hook" | "description";
  /** Position of the match in source text (0-indexed) for stable sorting. */
  readonly position: number;
}

interface ProgramRule {
  readonly network: AffiliateNetwork;
  readonly hostPattern: RegExp;
  readonly trackingParam: string;
}

/**
 * Static program table. Order matters — first match wins for a given URL.
 * All hostPatterns anchor on the host portion only (after `://`), case-insensitive.
 */
const PROGRAMS: readonly ProgramRule[] = [
  { network: "amazon-associates",  hostPattern: /^(www\.)?amazon\.[a-z.]+$/i,    trackingParam: "tag" },
  { network: "shopee-affiliate",   hostPattern: /^(.+\.)?shopee\.[a-z.]+$/i,     trackingParam: "af_id" },
  { network: "lazada-affiliate",   hostPattern: /^(.+\.)?lazada\.[a-z.]+$/i,     trackingParam: "sub_aff_id" },
  { network: "tokopedia-affiliate",hostPattern: /^(.+\.)?tokopedia\.com$/i,      trackingParam: "aff_unique_id" },
  { network: "magalu-parceiro",    hostPattern: /^(.+\.)?magazinevoce\.com\.br$/i, trackingParam: "partner_id" },
  { network: "mercado-livre",      hostPattern: /^(.+\.)?mercadolivre\.com(\.[a-z]+)?$/i, trackingParam: "matt_word" },
  { network: "tiktok-shop",        hostPattern: /^(.+\.)?tiktok\.com$/i,         trackingParam: "shop_aff" },
  { network: "kwai-shop",          hostPattern: /^(.+\.)?kwai\.com$/i,           trackingParam: "kshop_aff" },
  { network: "rakuten",            hostPattern: /^(.+\.)?rakuten\.[a-z.]+$/i,    trackingParam: "scid" },
  { network: "linktree-monetized", hostPattern: /^(.+\.)?linktr\.ee$/i,          trackingParam: "ref" },
];

const URL_RE = /\bhttps?:\/\/[^\s)]+/gi;

export interface ScanInput {
  readonly caption: string;
  readonly hook: string;
  readonly description?: string;
}

/**
 * Pure scan. Returns matches sorted by (source, position) for stable
 * deduplication downstream. Same canonicalUrl appearing twice yields two
 * matches — the ledger collapses them; the scanner does not.
 */
export function detectAffiliates(input: ScanInput): AffiliateMatch[] {
  const matches: AffiliateMatch[] = [];
  const sources: Array<["caption" | "hook" | "description", string]> = [
    ["caption", input.caption],
    ["hook", input.hook],
  ];
  if (input.description) sources.push(["description", input.description]);

  for (const [source, text] of sources) {
    URL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_RE.exec(text)) !== null) {
      const raw = m[0];
      const parsed = tryParseUrl(raw);
      if (!parsed) continue;
      const program = PROGRAMS.find((p) => p.hostPattern.test(parsed.host));
      if (!program) continue;
      const trackingCode = parsed.params.get(program.trackingParam) ?? "";
      if (!trackingCode) continue;
      matches.push({
        network: program.network,
        trackingCode,
        canonicalUrl: canonicalise(parsed, program.trackingParam),
        source,
        position: m.index,
      });
    }
  }
  return matches.sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.position - b.position;
  });
}

interface ParsedUrl {
  readonly host: string;
  readonly path: string;
  readonly params: URLSearchParams;
  readonly raw: string;
}

function tryParseUrl(raw: string): ParsedUrl | null {
  try {
    const u = new URL(raw);
    return {
      host: u.host.toLowerCase(),
      path: u.pathname,
      params: u.searchParams,
      raw,
    };
  } catch {
    return null;
  }
}

function canonicalise(parsed: ParsedUrl, trackingParam: string): string {
  const keep = new URLSearchParams();
  const tracking = parsed.params.get(trackingParam);
  if (tracking !== null) keep.set(trackingParam, tracking);
  const qs = keep.toString();
  return `https://${parsed.host}${parsed.path}${qs ? `?${qs}` : ""}`.toLowerCase();
}
