import type { MemoryGraph, MemoryGraphNode } from "./types";

/**
 * In-memory MemoryGraph for the MockOrchestrator.
 *
 * Sprint 2 stores graph state in process memory only — the Sprint 3 cloud
 * burst layer adds the encrypted persistence envelope (using the same
 * SecureBackend the Style Twin uses). For now, restart = fresh graph.
 */
export class InMemoryMemoryGraph implements MemoryGraph {
  private nodes: MemoryGraphNode[] = [];

  async read(filter: { kind?: MemoryGraphNode["kind"]; limit?: number }): Promise<MemoryGraphNode[]> {
    let out = this.nodes;
    if (filter.kind) out = out.filter((n) => n.kind === filter.kind);
    out = out.slice().sort((a, b) => b.createdAt - a.createdAt);
    if (filter.limit && filter.limit > 0) out = out.slice(0, filter.limit);
    return out;
  }

  async write(node: Omit<MemoryGraphNode, "createdAt">): Promise<void> {
    this.nodes.push({ ...node, createdAt: Date.now() });
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
