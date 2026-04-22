import type { MemoryGraph, MemoryGraphNode } from "./types";

/**
 * In-memory MemoryGraph for the MockOrchestrator.
 *
 * Sprint 2 stores graph state in process memory only — the Sprint 3 cloud
 * burst layer adds the encrypted persistence envelope (using the same
 * SecureBackend the Style Twin uses). For now, restart = fresh graph.
 *
 * Bounded by `maxNodes` (default 500) so long-lived sessions that re-run
 * the swarm many times don't grow the graph without bound. When the cap
 * is exceeded the oldest nodes are evicted FIFO, preserving the most
 * recent (and therefore most relevant) history for nearest-neighbour
 * lookups and timeline rendering.
 */
export interface InMemoryMemoryGraphOptions {
  /** Maximum number of nodes retained. Older nodes are evicted FIFO. */
  maxNodes?: number;
}

export class InMemoryMemoryGraph implements MemoryGraph {
  private nodes: MemoryGraphNode[] = [];
  private readonly maxNodes: number;

  constructor(opts: InMemoryMemoryGraphOptions = {}) {
    this.maxNodes = Math.max(1, opts.maxNodes ?? 500);
  }

  async read(filter: { kind?: MemoryGraphNode["kind"]; limit?: number }): Promise<MemoryGraphNode[]> {
    let out = this.nodes;
    if (filter.kind) out = out.filter((n) => n.kind === filter.kind);
    out = out.slice().sort((a, b) => b.createdAt - a.createdAt);
    if (filter.limit && filter.limit > 0) out = out.slice(0, filter.limit);
    return out;
  }

  async write(node: Omit<MemoryGraphNode, "createdAt">): Promise<void> {
    this.nodes.push({ ...node, createdAt: Date.now() });
    // FIFO evict the oldest entries once we exceed the cap. Cheap because
    // writes are amortised and the cap is small relative to the array.
    if (this.nodes.length > this.maxNodes) {
      this.nodes.splice(0, this.nodes.length - this.maxNodes);
    }
  }

  /** Sprint-2-only helper for the UI to render the timeline. */
  snapshot(): readonly MemoryGraphNode[] {
    return this.nodes.slice();
  }
}

export class AlwaysAllowConsent {
  async request(_action: "burst-render" | "send-dm" | "publish"): Promise<boolean> {
    return true;
  }
}
