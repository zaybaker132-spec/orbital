import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Video, Brain, Compass, FileText, FolderKanban, Lightbulb, MessageSquare, MessageSquarePlus, Network, PanelLeft, PanelRight, Search, Settings, StickyNote, Sparkles, BookOpen, Upload, Scissors, Target, Bell, Mic, GraduationCap, Scale, FlaskConical, HeartPulse } from "lucide-react";
import { useApp } from "@/state/app";
import { api } from "@/lib/api";
import { invalidate } from "@/lib/resource";
import { modKey } from "@/lib/format";
import { toastError } from "@/state/ui";
import { cx } from "./ui";
import { tx } from "@/i18n";

interface Item { id: string; label: string; hint?: string; group: string; icon: any; run: () => void | Promise<void>; keywords?: string }

const TYPE_META: Record<string, { icon: any; group: string; to: (id: string) => string }> = {
  document: { icon: FileText, group: "Knowledge", to: (id) => `/knowledge/${id}` },
  memory: { icon: Brain, group: "Memories", to: () => `/knowledge?tab=memory` },
  node: { icon: Network, group: "Concepts", to: (id) => `/connections?node=${id}` },
  conversation: { icon: MessageSquare, group: "Conversations", to: (id) => `/c/${id}` },
  project: { icon: FolderKanban, group: "Projects", to: (id) => `/projects/${id}` },
  research: { icon: Compass, group: "Research", to: (id) => `/research/${id}` },
  opportunity: { icon: Lightbulb, group: "Opportunities", to: () => `/opportunities` },
};

/** Global command palette (⌘K / Ctrl K): search everything, navigate, and run actions — fully keyboard-driven. */
export function CommandPalette() {
  const { paletteOpen, setPalette, toggleSidebar, toggleRightPanel } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (paletteOpen) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 20); }
  }, [paletteOpen]);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const t = setTimeout(() => api.get(`/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults([])), 120);
    return () => clearTimeout(t);
  }, [q]);

  const close = () => setPalette(false);
  const go = (to: string) => () => { navigate(to); close(); };

  const actions: Item[] = useMemo(() => [
    { id: "new-chat", label: "New conversation", hint: "⌥N", group: "Actions", icon: MessageSquarePlus, run: go("/") },
    { id: "research", label: q.trim().length > 7 ? `Research: "${q.trim()}"` : "Start deep research…", group: "Actions", icon: Compass, keywords: "research investigate sources",
      run: async () => {
        if (q.trim().length > 7) {
          try { const r = await api.post("/research", { question: q.trim() }); invalidate("/research"); navigate(`/research/${r.id}`); } catch (e) { toastError(e); }
        } else navigate("/research?new=1");
        close();
      } },
    { id: "note", label: q.trim() ? `Create note "${q.trim()}"` : "Create note", group: "Actions", icon: StickyNote, keywords: "new note write",
      run: async () => {
        try { const d = await api.post("/documents", { title: q.trim() || "Untitled", body: "" }); invalidate("/documents"); navigate(`/knowledge/${d.id}`); } catch (e) { toastError(e); }
        close();
      } },
    { id: "search-all", label: q.trim() ? `Search everything for "${q.trim()}"` : "Search everything", group: "Actions", icon: Search, keywords: "find search all full", run: go(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search") },
    { id: "import", label: "Import a file (PDF, Word, Excel, PowerPoint, image)", group: "Actions", icon: Upload, keywords: "upload pdf import docx xlsx pptx image word excel", run: go("/knowledge?import=1") },
    { id: "clip", label: "Clip a web page", group: "Actions", icon: Scissors, keywords: "clipper web save article url bookmark", run: go("/knowledge?clip=1") },
    { id: "focus", label: "Start focus mode", group: "Actions", icon: Target, keywords: "focus timer pomodoro distraction deep work", run: go("/focus") },
    { id: "reminder", label: "Set a reminder", group: "Actions", icon: Bell, keywords: "remind reminder alarm later", run: go("/reminders") },
    { id: "learn", label: q.trim() ? `Learn about "${q.trim()}"` : "Learn something (Learning mode)", group: "Actions", icon: GraduationCap, keywords: "learn teach explain study understand",
      run: () => { navigate(q.trim() ? `/?mode=learning&q=${encodeURIComponent(q.trim())}` : "/?mode=learning"); close(); } },
    { id: "lab", label: q.trim() ? `Contradiction lab: "${q.trim()}"` : "Open the contradiction lab", group: "Actions", icon: Scale, keywords: "contradiction disagree debate opposing views lab",
      run: () => { navigate(`/research?kind=contradiction${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`); close(); } },
    { id: "hypothesis", label: q.trim() ? `Test hypothesis: "${q.trim()}"` : "Test a hypothesis", group: "Actions", icon: FlaskConical, keywords: "hypothesis test evidence for against verdict",
      run: () => { navigate(`/hypotheses${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`); close(); } },
    { id: "health", label: "Knowledge health and cleanup", group: "Actions", icon: HeartPulse, keywords: "maintenance cleanup duplicates conflicts outdated tidy health", run: go("/maintenance") },
    { id: "voice", label: "Talk to Orbital", group: "Actions", icon: Mic, keywords: "voice speak talk microphone", run: go("/?voice=1") },
    { id: "project", label: "New project", group: "Actions", icon: FolderKanban, keywords: "create project", run: go("/projects?new=1") },
    { id: "meeting-new", label: "Start a meeting", group: "Actions", icon: Video, keywords: "call video zoom meet",
      run: async () => { try { const r = await api.post("/meetings", {}); navigate(`/m/${r.code}`); } catch (e) { toastError(e); } close(); } },
    { id: "meeting-join", label: q.trim().match(/[a-z]{3}-?[a-z]{4}-?[a-z]{3}/i) ? `Join meeting ${q.trim()}` : "Join a meeting…", group: "Actions", icon: Video, keywords: "call video join code",
      run: () => { const m = q.trim().toLowerCase().match(/([a-z]{3})-?([a-z]{4})-?([a-z]{3})/); navigate(m ? `/m/${m[1]}-${m[2]}-${m[3]}` : "/meetings"); close(); } },
    { id: "discover", label: "Discover opportunities", group: "Actions", icon: Sparkles, keywords: "opportunity engine business", run: go("/opportunities?discover=1") },
    { id: "nav-core", label: "Neural Core", hint: "g n", group: "Go to", icon: Brain, run: go("/core") },
    { id: "nav-research", label: "Research", hint: "g r", group: "Go to", icon: Compass, run: go("/research") },
    { id: "nav-knowledge", label: "Knowledge", hint: "g k", group: "Go to", icon: BookOpen, run: go("/knowledge") },
    { id: "nav-memory", label: "Memory", group: "Go to", icon: Brain, keywords: "remember memories", run: go("/knowledge?tab=memory") },
    { id: "nav-graph", label: "Connections", hint: "g g", group: "Go to", icon: Network, keywords: "graph", run: go("/connections") },
    { id: "nav-projects", label: "Projects", hint: "g p", group: "Go to", icon: FolderKanban, run: go("/projects") },
    { id: "nav-opps", label: "Opportunities", hint: "g o", group: "Go to", icon: Lightbulb, run: go("/opportunities") },
    { id: "nav-reminders", label: "Reminders", hint: "g t", group: "Go to", icon: Bell, run: go("/reminders") },
    { id: "nav-focus", label: "Focus", hint: "g f", group: "Go to", icon: Target, run: go("/focus") },
    { id: "nav-settings", label: "Settings", hint: "g s", group: "Go to", icon: Settings, run: go("/settings") },
    { id: "toggle-sidebar", label: "Toggle sidebar", hint: `${modKey} \\`, group: "View", icon: PanelLeft, run: () => { toggleSidebar(); close(); } },
    { id: "toggle-panel", label: "Toggle context panel", hint: `${modKey} .`, group: "View", icon: PanelRight, run: () => { toggleRightPanel(); close(); } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [q]);

  const items: Item[] = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const found: Item[] = results.map((r) => {
      const meta = TYPE_META[r.type];
      return { id: `${r.type}-${r.id}`, label: r.title, hint: r.snippet && r.type !== "document" ? String(r.snippet).slice(0, 40) : undefined, group: meta.group, icon: meta.icon, run: go(meta.to(r.id)) };
    });
    const acts = actions.filter((a) => !needle || a.id === "search-all" || a.id === "research" || a.id === "note" || a.id === "learn" || a.id === "lab" || a.id === "hypothesis" || `${a.label} ${tx(a.label)} ${a.keywords ?? ""}`.toLowerCase().includes(needle));
    return needle ? [...found, ...acts.filter((a) => a.id === "search-all"), ...acts.filter((a) => a.id !== "search-all")] : acts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, actions, q]);

  useEffect(() => setSel(0), [q, results.length]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  let lastGroup = "";
  return (
    <AnimatePresence>
      {paletteOpen && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[14vh] backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
          onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <motion.div role="dialog" aria-modal="true" aria-label={tx("Command palette")} className="w-full max-w-[600px] overflow-hidden rounded-xl border border-line-strong bg-ink-1 shadow-[0_30px_80px_rgba(0,0,0,0.8)]"
            initial={{ y: -6, scale: 0.99 }} animate={{ y: 0, scale: 1 }} exit={{ y: -4, opacity: 0 }} transition={{ duration: 0.14 }}>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search size={15} className="text-mute" />
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={tx("Search knowledge, projects, conversations… or type a command")}
                role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[sel] ? `pi-${sel}` : undefined}
                className="h-12 flex-1 bg-transparent text-[0.95rem] outline-none placeholder:text-mute-soft" />
              <span className="kbd">{tx("esc")}</span>
            </div>
            <ul id="palette-list" ref={listRef} role="listbox" className="max-h-[420px] overflow-y-auto p-1.5">
              {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-mute">{tx("No results")}</li>}
              {items.map((it, i) => {
                const header = it.group !== lastGroup ? it.group : null;
                lastGroup = it.group;
                return (
                  <li key={it.id} role="presentation">
                    {header && <div className="label px-3 pb-1.5 pt-2.5">{tx(header)}</div>}
                    <div id={`pi-${i}`} data-idx={i} role="option" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => it.run()}
                      className={cx("flex h-9 cursor-pointer items-center gap-3 rounded-lg px-3 text-[0.88rem]", i === sel ? "bg-white/[0.08] text-white" : "text-white/80")}>
                      <it.icon size={15} strokeWidth={1.6} className="shrink-0 text-mute" />
                      <span className="truncate">{tx(it.label)}</span>
                      {it.hint && <span className="ml-auto shrink-0 text-[0.72rem] text-mute">{tx(it.hint)}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
