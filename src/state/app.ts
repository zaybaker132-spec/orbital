import { create } from "zustand";
import { useEffect, useState } from "react";
import { api, getWorkspaceId, setWorkspaceId } from "@/lib/api";
import { invalidate } from "@/lib/resource";

export interface User { id: string; email: string; displayName: string }
export interface AiStatus { provider: "anthropic" | "openai" | "none"; model: string | null; webSearch: boolean; embeddings: string }
export type Role = "owner" | "admin" | "member" | "viewer";
export interface Workspace { id: string; name: string; kind: "personal" | "business"; role: Role }
export interface Preferences {
  reducedMotion?: "system" | "on" | "off"; particleDensity?: "auto" | "low" | "medium" | "high"; defaultMode?: string; autoExtractMemories?: boolean;
  speakAnswers?: boolean; voiceName?: string; voiceRate?: number; focusMinutes?: 25 | 50 | 90; nudges?: boolean;
}
export interface ServerInfo { version: string; database: "embedded" | "postgres"; transcription: boolean; turn: boolean; maxParticipants: number }

interface AppStore {
  loaded: boolean;
  user: User | null;
  ai: AiStatus | null;
  prefs: Preferences;
  workspaces: Workspace[];
  workspace: Workspace | null;
  desktop: boolean;
  downloadUrl: string;
  serverAdmin: boolean;
  server: ServerInfo | null;
  setUser(patch: Partial<User>): void;
  switchWorkspace(id: string): void;
  refreshWorkspaces(): Promise<void>;
  signupAllowed: boolean;
  rightPanel: boolean;
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  load(): Promise<void>;
  setPrefs(p: Partial<Preferences>): Promise<void>;
  toggleRightPanel(v?: boolean): void;
  toggleSidebar(v?: boolean): void;
  setPalette(v: boolean): void;
}

const stored = (k: string, d: boolean) => {
  try { const v = localStorage.getItem(k); return v === null ? d : v === "1"; } catch { return d; }
};
const store = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* private mode */ } };

export const useApp = create<AppStore>((set, get) => ({
  loaded: false,
  user: null,
  ai: null,
  prefs: {},
  workspaces: [],
  workspace: null,
  desktop: false,
  downloadUrl: "",
  serverAdmin: false,
  server: null,
  setUser(patch) { const u = get().user; if (u) set({ user: { ...u, ...patch } }); },
  signupAllowed: true,
  rightPanel: stored("orbital.rightPanel", true),
  sidebarCollapsed: stored("orbital.sidebarCollapsed", false),
  paletteOpen: false,
  async load() {
    const me = await api.get("/auth/me");
    const workspaces: Workspace[] = me.workspaces ?? [];
    const current = workspaces.find((w) => w.id === getWorkspaceId()) ?? workspaces[0] ?? null;
    setWorkspaceId(current?.id ?? null);
    set({ loaded: true, user: me.user, ai: me.ai, prefs: me.preferences ?? {}, signupAllowed: me.signupAllowed, workspaces, workspace: current, desktop: !!me.desktop, downloadUrl: me.downloadUrl ?? "", serverAdmin: !!me.serverAdmin, server: me.server ?? null });
  },
  async setPrefs(p) {
    set({ prefs: { ...get().prefs, ...p } });
    const saved = await api.put("/preferences", p);
    set({ prefs: saved });
  },
  toggleRightPanel(v) {
    const next = v ?? !get().rightPanel;
    store("orbital.rightPanel", next);
    set({ rightPanel: next });
  },
  toggleSidebar(v) {
    const next = v ?? !get().sidebarCollapsed;
    store("orbital.sidebarCollapsed", next);
    set({ sidebarCollapsed: next });
  },
  setPalette(v) { set({ paletteOpen: v }); },
  switchWorkspace(id) {
    const w = get().workspaces.find((x) => x.id === id);
    if (!w) return;
    setWorkspaceId(id);
    set({ workspace: w });
    invalidate("/"); // every cached view belongs to the previous workspace
  },
  async refreshWorkspaces() {
    const list: Workspace[] = await api.get("/workspaces");
    const cur = list.find((w) => w.id === get().workspace?.id) ?? list[0];
    setWorkspaceId(cur?.id ?? null);
    set({ workspaces: list, workspace: cur ?? null });
  },
}));

/** Reduced motion honours the user's setting, falling back to the OS preference. */
export function useMotionPrefs() {
  const prefs = useApp((s) => s.prefs);
  const [system, setSystem] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setSystem(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const mode = prefs.reducedMotion ?? "system";
  return { reducedMotion: mode === "on" || (mode === "system" && system), density: prefs.particleDensity ?? "auto" };
}

/** Role-aware UI: hide controls the server would refuse. */
export function useCan() {
  const role = useApp((s) => s.workspace?.role ?? "owner");
  const rank = { viewer: 0, member: 1, admin: 2, owner: 3 }[role];
  return { write: rank >= 1, admin: rank >= 2, owner: rank >= 3, role };
}
