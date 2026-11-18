import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, Check, ChevronsUpDown, Plus, User, Users } from "lucide-react";
import { useApp } from "@/state/app";
import { api } from "@/lib/api";
import { toastError } from "@/state/ui";
import { Button, Dialog, Input, cx } from "./ui";

/** Switch between the personal workspace and business workspaces; create a new business workspace. */
export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { workspaces, workspace, switchWorkspace, refreshWorkspaces } = useApp();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [open]);

  const go = (id: string) => { switchWorkspace(id); setOpen(false); navigate("/"); };
  const create = async () => {
    try {
      const w = await api.post("/workspaces", { name: name.trim() });
      await refreshWorkspaces();
      setCreating(false); setName("");
      go(w.id);
      navigate("/team");
    } catch (e) { toastError(e); }
  };

  const Icon = workspace?.kind === "business" ? Building2 : User;
  return (
    <div ref={ref} className={cx("relative px-2.5", collapsed && "px-2")}>
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title={workspace?.name}
        className={cx("flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors hover:bg-white/[0.05]", collapsed && "justify-center px-0")}>
        <Icon size={15} strokeWidth={1.6} className="shrink-0 text-mute-bright" />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.85rem] text-white">{workspace?.name ?? "…"}</span>
              <span className="block text-[0.68rem] text-mute">{workspace?.kind === "business" ? `Business · ${workspace.role}` : "Private"}</span>
            </span>
            <ChevronsUpDown size={13} className="shrink-0 text-mute" />
          </>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}
            className="absolute left-2.5 top-11 z-40 w-64 rounded-xl border border-line-strong bg-ink-1 p-1.5 shadow-2xl">
            <div className="label px-2.5 pb-1 pt-1.5">Workspaces</div>
            {workspaces.map((w) => (
              <button key={w.id} role="menuitem" onClick={() => go(w.id)} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.85rem] hover:bg-white/[0.06]">
                {w.kind === "business" ? <Building2 size={14} className="text-mute" /> : <User size={14} className="text-mute" />}
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                <span className="text-[0.68rem] text-mute">{w.kind === "business" ? w.role : "private"}</span>
                {w.id === workspace?.id && <Check size={13} />}
              </button>
            ))}
            <div className="my-1 h-px bg-line" />
            {workspace?.kind === "business" && (
              <button role="menuitem" onClick={() => { setOpen(false); navigate("/team"); }} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.85rem] text-mute-bright hover:bg-white/[0.06] hover:text-white">
                <Users size={14} /> Team & workspace settings
              </button>
            )}
            <button role="menuitem" onClick={() => { setOpen(false); setCreating(true); }} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.85rem] text-mute-bright hover:bg-white/[0.06] hover:text-white">
              <Plus size={14} /> New business workspace
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <Dialog open={creating} onClose={() => setCreating(false)} title="New business workspace">
        <p className="text-[0.84rem] leading-relaxed text-mute">A shared space for a company or team: shared knowledge, research and projects, automations that run the business on a schedule, approvals, and an API for your other tools. Your personal workspace stays private.</p>
        <Input className="mt-4" placeholder="Company or team name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && create()} aria-label="Workspace name" />
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={create}>Create workspace</Button></div>
      </Dialog>
    </div>
  );
}
