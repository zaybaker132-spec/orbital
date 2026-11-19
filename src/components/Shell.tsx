import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain, Compass, FileText, FolderKanban, Lightbulb, LogOut, MessageSquarePlus, Network, PanelLeft, PanelRight, Search, Settings, BookOpen, Workflow, Video, Bell, Target, X,
} from "lucide-react";
import { useApp } from "@/state/app";
import { useCore } from "@/state/core";
import { useToasts } from "@/state/ui";
import { useResource, invalidate } from "@/lib/resource";
import { api } from "@/lib/api";
import { modKey, timeAgo } from "@/lib/format";
import { IconButton, cx } from "./ui";
import { RightPanel } from "./RightPanel";
import { CommandPalette } from "./CommandPalette";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { tx } from "@/i18n";

export const NAV = [
  { to: "/core", label: "Neural Core", icon: Brain, key: "n" },
  { to: "/research", label: "Research", icon: Compass, key: "r" },
  { to: "/papers", label: "Papers", icon: FileText, key: "d" },
  { to: "/knowledge", label: "Knowledge", icon: BookOpen, key: "k" },
  { to: "/connections", label: "Connections", icon: Network, key: "g" },
  { to: "/projects", label: "Projects", icon: FolderKanban, key: "p" },
  { to: "/reminders", label: "Reminders", icon: Bell, key: "t" },
  { to: "/focus", label: "Focus", icon: Target, key: "f" },
  { to: "/opportunities", label: "Opportunities", icon: Lightbulb, key: "o" },
  { to: "/meetings", label: "Meetings", icon: Video, key: "m" },
  { to: "/operations", label: "Operations", icon: Workflow, key: "w" },
] as const;

const STATE_LABEL: Record<string, string> = { idle: "Idle", thinking: "Thinking", researching: "Researching", learning: "Learning", connecting: "Connecting", opportunity: "Opportunity detected" };

export function Shell({ children }: { children: ReactNode }) {
  const { sidebarCollapsed, rightPanel, toggleSidebar, toggleRightPanel, setPalette } = useApp();
  const navigate = useNavigate();
  const [width, setWidth] = useState(() => {
    try { return Number(localStorage.getItem("orbital.sidebarWidth")) || 252; } catch { return 252; }
  });

  // Global keyboard: ⌘K palette, ⌘\ sidebar, ⌘. context panel, ⌥N new conversation, "g x" navigation.
  useEffect(() => {
    let gPending = 0;
    const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(!useApp.getState().paletteOpen); return; }
      if (mod && e.key === "\\") { e.preventDefault(); toggleSidebar(); return; }
      if (mod && e.key === ".") { e.preventDefault(); toggleRightPanel(); return; }
      if (e.altKey && e.code === "KeyN") { e.preventDefault(); navigate("/"); return; }
      if (typing(e.target) || mod || e.altKey) return;
      if (e.key === "g") { gPending = Date.now(); return; }
      if (Date.now() - gPending < 1200) {
        gPending = 0;
        const hit = NAV.find((n) => n.key === e.key) ?? (e.key === "c" ? { to: "/" } : e.key === "s" ? { to: "/settings" } : null);
        if (hit) { e.preventDefault(); navigate(hit.to); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, setPalette, toggleSidebar, toggleRightPanel]);

  return (
    <div className="flex h-full bg-black">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-1.5 focus:text-black">{tx("Skip to content")}</a>
      <Sidebar width={width} collapsed={sidebarCollapsed} onResize={(w) => { setWidth(w); try { localStorage.setItem("orbital.sidebarWidth", String(w)); } catch { /* ignore */ } }} />
      <main id="main" className="relative flex min-w-0 flex-1 flex-col border-l border-line bg-ink-1/40">
        <TopBar />
        <div className="min-h-0 flex-1">{children}</div>
      </main>
      <AnimatePresence initial={false}>
        {rightPanel && (
          <motion.aside key="rp" aria-label={tx("Context")} initial={{ width: 0, opacity: 0 }} animate={{ width: 320, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="shrink-0 overflow-hidden border-l border-line bg-black">
            <div className="h-full w-[320px]"><RightPanel /></div>
          </motion.aside>
        )}
      </AnimatePresence>
      <CommandPalette />
      <Toaster />
    </div>
  );
}

function TopBar() {
  const { sidebarCollapsed, rightPanel, toggleSidebar, toggleRightPanel, setPalette } = useApp();
  const state = useCore((s) => { void s.active; return s.current(); });
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 px-2.5">
      <IconButton label={sidebarCollapsed ? tx("Expand sidebar ({modKey}\\)", { modKey }) : tx("Collapse sidebar ({modKey}\\)", { modKey })} onClick={() => toggleSidebar()}><PanelLeft size={15} /></IconButton>
      <button onClick={() => setPalette(true)} className="ml-1 flex h-7 w-72 items-center gap-2 rounded-lg border border-line bg-white/[0.02] px-2.5 text-[0.82rem] text-mute transition-colors hover:border-line-strong hover:text-white/80">
        <Search size={13} className="shrink-0" /> <span className="truncate">{tx("Search or run a command")}</span> <span className="kbd ml-auto shrink-0 whitespace-nowrap">{modKey} K</span>
      </button>
      <div className="ml-auto flex items-center gap-3">
        <span className="flex items-center gap-2 text-[0.75rem] text-mute" aria-live="polite">
          <span className={cx("h-1.5 w-1.5 rounded-full transition-colors", state === "idle" ? "bg-white/30" : "bg-white animate-pulse")} />
          {tx(STATE_LABEL[state])}
        </span>
        <IconButton label={rightPanel ? tx("Hide context panel ({modKey}.)", { modKey }) : tx("Show context panel ({modKey}.)", { modKey })} active={rightPanel} onClick={() => toggleRightPanel()}><PanelRight size={15} /></IconButton>
      </div>
    </div>
  );
}

function Sidebar({ width, collapsed, onResize }: { width: number; collapsed: boolean; onResize: (w: number) => void }) {
  const user = useApp((s) => s.user);
  const navigate = useNavigate();
  const loc = useLocation();
  const { data: convs } = useResource<any[]>("/conversations");
  const { data: actions } = useResource<any[]>("/actions?status=proposed");
  const pending = actions?.length ?? 0;
  const { data: reminders } = useResource<any[]>("/reminders");
  const due = reminders?.filter((r) => r.status === "fired").length ?? 0;
  const dragging = useRef(false);

  const startDrag = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);
  const onDrag = useCallback((e: React.PointerEvent) => {
    if (dragging.current) onResize(Math.max(208, Math.min(380, e.clientX)));
  }, [onResize]);

  const logout = async () => {
    await api.post("/auth/logout");
    invalidate("/");
    location.href = "/";
  };

  const w = collapsed ? 56 : width;
  return (
    <nav aria-label={tx("Primary")} className="relative flex h-full shrink-0 flex-col bg-black transition-[width] duration-200" style={{ width: w }}>
      <div className={cx("flex h-11 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}>
        <OrbitalMark />
        {!collapsed && <span className="text-[0.82rem] tracking-[0.28em] text-white">{tx("ORBITAL")}</span>}
      </div>
      <WorkspaceSwitcher collapsed={collapsed} />
      <div className={cx("px-2.5 pt-2", collapsed && "px-2")}>
        <button onClick={() => navigate("/")} title={tx("New conversation (⌥N)")}
          className={cx("flex h-8 w-full items-center gap-2.5 rounded-lg border border-line px-2.5 text-[0.85rem] text-white transition-colors hover:bg-white/[0.06]", collapsed && "justify-center px-0")}>
          <MessageSquarePlus size={15} className="shrink-0 text-mute-bright" />
          {!collapsed && <>{tx("New conversation")} <span className="kbd ml-auto">⌥N</span></>}
        </button>
      </div>
      <ul className={cx("mt-3 space-y-px px-2.5", collapsed && "px-2")}>
        {NAV.map((n) => (
          <li key={n.to}>
            <NavLink to={n.to} title={`${tx(n.label)} (g ${n.key})`}
              className={({ isActive }) => cx("group relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[0.86rem] transition-colors", collapsed && "justify-center px-0",
                isActive ? "text-white" : "text-mute hover:bg-white/[0.04] hover:text-white/90")}>
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-white/[0.07]" transition={{ duration: 0.2 }} />}
                  <n.icon size={15} className="relative shrink-0" strokeWidth={1.6} />
                  {!collapsed && <span className="relative">{tx(n.label)}</span>}
                  {n.to === "/reminders" && due > 0 && <span className={cx("relative rounded-full bg-white px-1.5 text-[0.66rem] leading-4 text-black", collapsed ? "absolute right-1 top-0.5" : "ml-auto")} aria-label={tx("{due} due", { due: due })}>{due}</span>}
                  {n.to === "/operations" && pending > 0 && <span className={cx("relative rounded-full bg-white px-1.5 text-[0.66rem] leading-4 text-black", collapsed ? "absolute right-1 top-0.5" : "ml-auto")} aria-label={tx("{pending} awaiting approval", { pending: pending })}>{pending}</span>}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
      {!collapsed && (
        <div className="mt-6 flex min-h-0 flex-1 flex-col">
          <div className="label px-5 pb-2">{tx("Conversations")}</div>
          <ul className="min-h-0 flex-1 space-y-px overflow-y-auto px-2.5 pb-3">
            {convs?.length === 0 && <li className="px-2.5 py-1 text-[0.8rem] text-mute-soft">{tx("No conversations yet")}</li>}
            {convs?.map((c) => {
              const active = loc.pathname === `/c/${c.id}`;
              return (
                <li key={c.id}>
                  <NavLink to={`/c/${c.id}`} className={cx("flex h-8 items-center gap-2 rounded-lg px-2.5 text-[0.83rem] transition-colors", active ? "bg-white/[0.07] text-white" : "text-mute-bright hover:bg-white/[0.04] hover:text-white")}>
                    <span className="truncate">{c.title}</span>
                    <span className="ml-auto shrink-0 text-[0.68rem] text-mute-soft">{timeAgo(c.updated_at)}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {collapsed && <div className="flex-1" />}
      <div className={cx("flex items-center gap-1 border-t border-line px-2.5 py-2", collapsed && "flex-col px-2")}>
        <NavLink to="/settings" title={tx("Settings (g s)")} className={({ isActive }) => cx("flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 text-[0.84rem] transition-colors", collapsed && "w-full justify-center px-0", isActive ? "bg-white/[0.07] text-white" : "text-mute hover:bg-white/[0.04] hover:text-white")}>
          <Settings size={15} strokeWidth={1.6} className="shrink-0" />
          {!collapsed && <span className="truncate">{user?.displayName || user?.email}</span>}
        </NavLink>
        <IconButton label={tx("Sign out")} onClick={logout}><LogOut size={14} /></IconButton>
      </div>
      {!collapsed && (
        <div role="separator" aria-orientation="vertical" aria-label={tx("Resize sidebar")} tabIndex={0}
          onKeyDown={(e) => { if (e.key === "ArrowLeft") onResize(Math.max(208, width - 16)); if (e.key === "ArrowRight") onResize(Math.min(380, width + 16)); }}
          onPointerDown={startDrag} onPointerMove={onDrag} onPointerUp={() => (dragging.current = false)}
          className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize opacity-0 transition-opacity hover:opacity-100 focus:opacity-100">
          <div className="mx-auto h-full w-px bg-white/25" />
        </div>
      )}
    </nav>
  );
}

export function OrbitalMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        return <circle key={i} cx={12 + Math.cos(a) * 9} cy={12 + Math.sin(a) * 9} r={i % 3 === 0 ? 1.1 : 0.7} fill="#fff" opacity={0.35 + (i % 4) * 0.18} />;
      })}
      <circle cx="12" cy="12" r="2.6" fill="#fff" />
    </svg>
  );
}

function Toaster() {
  const { toasts, dismiss } = useToasts();
  const navigate = useNavigate();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
            className={cx("pointer-events-auto flex items-center gap-3 rounded-xl border bg-ink-2/95 px-4 py-2.5 text-[0.85rem] shadow-2xl backdrop-blur", t.tone === "error" ? "border-red-400/25 text-red-100" : "border-line-strong text-white")}>
            <span>{t.message}</span>
            {t.action && <button className="text-white underline decoration-white/30 underline-offset-2 hover:decoration-white" onClick={() => { navigate(t.action!.to); dismiss(t.id); }}>{tx(t.action.label)}</button>}
            {t.sticky && <button aria-label={tx("Dismiss")} className="-mr-1 text-mute hover:text-white" onClick={() => dismiss(t.id)}><X size={14} /></button>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
