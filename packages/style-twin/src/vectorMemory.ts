import { configureBackend, type SecureBackend } from "./storage";
import { cosineSimilarity } from "./similarity";

/**
 * Encrypted on-device vector memory.
 *
 * Stores per-video embeddings (timbre vectors, visual CLIP embeddings,
 * vocabulary one-hot signatures) so the Style Twin can grow incrementally
 * without re-processing the entire corpus. Backed by the same SecureBackend
 * (iOS Keychain / Android Keystore) as the Style Twin itself — see
 * `storage.ts` for the encryption envelope.
 *
 * Privacy invariant: vectors never leave the device. The Compliance Shield
 * audits any code path that reads from this store and emits any network call.
 */

const VECTOR_STORE_KEY = "lumina.styleTwin.vectors.v1";
const VECTOR_STORE_SCHEMA = 1;

export interface VectorEntry {
  readonly sampleId: string;
  readonly capturedAt: number;
  readonly kind: "voice-timbre" | "visual-clip" | "vocab-signature";
  readonly vector: readonly number[];
}

interface VectorEnvelope {
  readonly schema: number;
  readonly entries: VectorEntry[];
}

let backend: SecureBackend | null = null;

export function configureVectorBackend(impl: SecureBackend): void {
  backend = impl;
  configureBackend(impl);
}

function requireBackend(): SecureBackend {
  if (!backend) {
    throw new Error(
      "@workspace/style-twin/vectorMemory: backend not configured. " +
        "Call configureVectorBackend() at app startup.",
    );
  }
  return backend;
}

export async function loadVectors(): Promise<VectorEntry[]> {
  const raw = await requireBackend().getItem(VECTOR_STORE_KEY);
  if (!raw) return [];
  try {
    const env = JSON.parse(raw) as VectorEnvelope;
    if (env.schema !== VECTOR_STORE_SCHEMA) return [];
    return env.entries;
  } catch {
    return [];
  }
}

export async function appendVectors(entries: readonly VectorEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const existing = await loadVectors();
  const seen = new Set(existing.map((e) => `${e.sampleId}:${e.kind}`));
  const next = existing.slice();
  for (const e of entries) {
    if (!seen.has(`${e.sampleId}:${e.kind}`)) next.push(e);
  }
  const env: VectorEnvelope = { schema: VECTOR_STORE_SCHEMA, entries: next };
  await requireBackend().setItem(VECTOR_STORE_KEY, JSON.stringify(env));
}

export async function wipeVectors(): Promise<void> {
  await requireBackend().deleteItem(VECTOR_STORE_KEY);
}

export interface NeighborMatch {
  readonly entry: VectorEntry;
  readonly score: number;
}

/**
 * k-nearest-neighbors against the encrypted vector store. Used by the
 * Director agent to retrieve the creator's most stylistically similar past
 * videos when storyboarding a new one ("you crushed it last time you opened
 * with this kind of hook — try a variant").
 */
export async function nearest(
  query: readonly number[],
  kind: VectorEntry["kind"],
  k = 5,
): Promise<NeighborMatch[]> {
  const all = (await loadVectors()).filter((e) => e.kind === kind);
  return all
    .map((entry) => ({ entry, score: cosineSimilarity(query, entry.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, k));
}
