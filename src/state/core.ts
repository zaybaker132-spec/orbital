import { create } from "zustand";

export type CoreState = "idle" | "thinking" | "researching" | "learning" | "connecting" | "opportunity";

/** Knowledge kinds → brain regions (thematic): memories grow the temporal lobe, research the occipital, and so on. */
export const KIND_TO_CLUSTER: Record<string, number> = {
  project: 0, opportunity: 0, note: 1, document: 1, concept: 2, research: 3, finding: 3, memory: 4,
};

interface CoreStore {
  /** States can overlap (e.g. researching in the background while chatting); the most recent wins visually. */
  active: Partial<Record<CoreState, number>>; // state → expiry timestamp (ms) or Infinity
  detail: string;
  lobeCounts: number[]; // per cluster
  edgeCount: number;
  /** Increment to replay the formation intro. */
  introNonce: number;
  replayIntro(): void;
  set(state: CoreState, on: boolean, opts?: { ttl?: number; detail?: string }): void;
  pulse(state: CoreState, ms: number): void;
  setKnowledge(kinds: Record<string, number>, edges: number): void;
  bump(kind: string, n?: number): void;
  bumpEdges(n?: number): void;
  current(): CoreState;
}

const PRIORITY: CoreState[] = ["opportunity", "connecting", "learning", "researching", "thinking"];

export const useCore = create<CoreStore>((set, get) => ({
  active: {},
  detail: "",
  lobeCounts: [0, 0, 0, 0, 0, 0, 0, 0],
  edgeCount: 0,
  introNonce: 0,
  replayIntro() { set((s) => ({ introNonce: s.introNonce + 1 })); },
  set(state, on, opts) {
    set((s) => {
      const active = { ...s.active };
      if (on) active[state] = opts?.ttl ? Date.now() + opts.ttl : Infinity;
      else delete active[state];
      return { active, detail: opts?.detail ?? s.detail };
    });
  },
  pulse(state, ms) {
    get().set(state, true, { ttl: ms });
  },
  setKnowledge(kinds, edges) {
    const counts = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const [k, n] of Object.entries(kinds)) counts[KIND_TO_CLUSTER[k] ?? 2] += n;
    counts[5] = edges; // cerebellum grows with connections
    counts[6] = Math.round(edges / 2);
    set({ lobeCounts: counts, edgeCount: edges });
  },
  bump(kind, n = 1) {
    set((s) => {
      const c = s.lobeCounts.slice();
      c[KIND_TO_CLUSTER[kind] ?? 2] += n;
      return { lobeCounts: c };
    });
  },
  bumpEdges(n = 1) {
    set((s) => {
      const c = s.lobeCounts.slice();
      c[5] += n;
      return { lobeCounts: c, edgeCount: s.edgeCount + n };
    });
  },
  current() {
    const now = Date.now();
    const a = get().active;
    for (const st of PRIORITY) {
      const exp = a[st];
      if (exp && exp > now) return st;
    }
    return "idle";
  },
}));
