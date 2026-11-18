import { create } from "zustand";
import type { ReactNode } from "react";

export interface Toast { id: number; message: string; tone?: "info" | "error"; action?: { label: string; to: string } }
interface ToastStore { toasts: Toast[]; push(t: Omit<Toast, "id">): void; dismiss(id: number): void }
let n = 0;
export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push(t) {
    const id = ++n;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.tone === "error" ? 7000 : 4500);
  },
  dismiss(id) { set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })); },
}));
export const toast = (message: string, extra: Partial<Omit<Toast, "id" | "message">> = {}) => useToasts.getState().push({ message, ...extra });
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), { tone: "error" });

/** Context shown in the right panel: the retrieval behind an answer, or page-provided content. */
export interface AnswerContext {
  memories: { ref: string; id: string; content: string; category: string; score: number }[];
  nodes: { ref: string; id: string; kind: string; title: string; score: number }[];
  connected: { ref: string; id: string; kind: string; title: string; via: string }[];
  documents: { ref: string; id: string; title: string; excerpt: string }[];
  gaps: { id: string; question: string }[];
  project: { id: string; name: string } | null;
}
interface PanelStore {
  answer: AnswerContext | null;
  highlight: string | null;
  content: ReactNode | null;
  title: string;
  setAnswer(a: AnswerContext | null, highlight?: string | null): void;
  setContent(title: string, c: ReactNode | null): void;
}
export const usePanel = create<PanelStore>((set) => ({
  answer: null,
  highlight: null,
  content: null,
  title: "",
  setAnswer(answer, highlight = null) { set({ answer, highlight }); },
  setContent(title, content) { set({ title, content }); },
}));

/** Background work driven by server events (e.g. opportunity discovery). */
export const useJobs = create<{ discovering: boolean; setDiscovering(v: boolean): void }>((set) => ({
  discovering: false,
  setDiscovering(v) { set({ discovering: v }); },
}));
