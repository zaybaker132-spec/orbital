import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, ChevronDown, Code, Highlighter, ImagePlus, IndentDecrease, IndentIncrease,
  Italic, Link2, List, ListChecks, ListOrdered, MessageSquarePlus, Mic, Minus, Plus, Printer, Quote, Redo2, RemoveFormatting, Sparkles,
  Strikethrough, Table, Underline, Undo2,
} from "lucide-react";
import { cx } from "@/components/ui";
import { isMac } from "@/lib/format";
import { tx } from "@/i18n";
import { FONTS } from "./extensions";

const mod = isMac ? "⌘" : "Ctrl+";
const alt = isMac ? "⌥" : "Alt+";
const shift = isMac ? "⇧" : "Shift+";
export const keys = { mod, alt, shift };

// ── Menus ───────────────────────────────────────────────────────────────────
export type MenuItem = { label: string; shortcut?: string; run: () => void; disabled?: boolean; checked?: boolean; icon?: ReactNode } | "-";
export interface MenuDef { label: string; items: MenuItem[] }

/** File · Edit · View · Insert · Format · Tools, like a word processor. Hovering moves between open menus. */
export function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="flex items-center" role="menubar">
      {menus.map((m, i) => (
        <div key={m.label} className="relative">
          <button role="menuitem" aria-haspopup="menu" aria-expanded={open === i}
            onMouseDown={(e) => { e.preventDefault(); setOpen(open === i ? null : i); }}
            onMouseEnter={() => open !== null && setOpen(i)}
            className={cx("rounded px-2 py-0.5 text-[0.82rem] transition-colors", open === i ? "bg-white/10 text-white" : "text-mute-bright hover:bg-white/[0.06] hover:text-white")}>{tx(m.label)}</button>
          {open === i && (
            <div role="menu" className="absolute left-0 top-7 z-40 min-w-[250px] rounded-lg border border-line-strong bg-ink-2 py-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.6)]">
              {m.items.map((it, j) => it === "-" ? <div key={j} className="my-1.5 border-t border-line" /> : (
                <button key={j} role="menuitem" disabled={it.disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setOpen(null); it.run(); }}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[0.82rem] text-white/85 hover:bg-white/[0.07] disabled:opacity-35 disabled:hover:bg-transparent">
                  <span className="grid w-4 place-items-center text-mute">{it.checked ? "✓" : it.icon}</span>
                  <span className="flex-1">{tx(it.label)}</span>
                  {it.shortcut && <span className="font-mono text-[0.7rem] text-mute">{it.shortcut}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Toolbar ─────────────────────────────────────────────────────────────────
const COLORS = ["#000000", "#434343", "#666666", "#999999", "#cccccc", "#ffffff", "#ff1f2e", "#ff5a1f", "#ff9a1a", "#ffd23a", "#a6ff2e", "#2cff7a", "#1fd0ff", "#2f7dff", "#7a2cff", "#b02bff", "#ff2bd6", "#c0392b", "#d35400", "#b7950b", "#1e8449", "#117a65", "#1f618d", "#6c3483"];
const HIGHLIGHTS = ["#fff3a3", "#ffd8a8", "#ffc9c9", "#d3f9d8", "#c5f6fa", "#d0ebff", "#e5dbff", "#fcc2d7"];

function Btn({ label, shortcut, active, disabled, onClick, children }: { label: string; shortcut?: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  const title = shortcut ? `${tx(label)} (${shortcut})` : tx(label);
  return (
    <button type="button" aria-label={tx(label)} title={title} aria-pressed={active} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={cx("grid h-7 min-w-7 place-items-center rounded px-1 transition-colors disabled:opacity-30", active ? "bg-sky-400/20 text-sky-200" : "text-white/80 hover:bg-white/[0.08] hover:text-white")}>
      {children}
    </button>
  );
}
const Sep = () => <div className="mx-1 h-5 w-px shrink-0 bg-white/10" />;

function Popover({ button, children, label }: { button: ReactNode; children: (close: () => void) => ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={tx(label)} title={tx(label)} aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}
        className="flex h-7 items-center gap-0.5 rounded px-1 text-white/80 hover:bg-white/[0.08] hover:text-white">{button}<ChevronDown size={11} className="opacity-60" /></button>
      {open && <div className="absolute left-0 top-8 z-40 rounded-lg border border-line-strong bg-ink-2 p-2 shadow-2xl">{children(() => setOpen(false))}</div>}
    </div>
  );
}

const STYLES = [
  { value: "p", label: "Normal text" }, { value: "1", label: "Heading 1" }, { value: "2", label: "Heading 2" },
  { value: "3", label: "Heading 3" }, { value: "4", label: "Heading 4" }, { value: "code", label: "Code block" },
];
const ptOf = (size?: string | null) => (size ? (size.endsWith("pt") ? parseFloat(size) : Math.round(parseFloat(size) * 0.75)) : 12);

export function Toolbar({ editor, canWrite, zoom, setZoom, onPrint, onLink, onImage, onComment, onAssist, onVoice, voiceActive }: {
  editor: Editor; canWrite: boolean; zoom: number; setZoom: (z: number) => void; onPrint: () => void; onLink: () => void; onImage: () => void;
  onComment: () => void; onAssist: () => void; onVoice: () => void; voiceActive: boolean;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"), code: e.isActive("code"),
      link: e.isActive("link"), bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), task: e.isActive("taskList"), quote: e.isActive("blockquote"),
      style: e.isActive("codeBlock") ? "code" : ([1, 2, 3, 4].find((l) => e.isActive("heading", { level: l }))?.toString() ?? "p"),
      align: (["center", "right", "justify"].find((a) => e.isActive({ textAlign: a })) ?? "left"),
      font: (e.getAttributes("textStyle").fontFamily as string | undefined) ?? "",
      size: ptOf(e.getAttributes("textStyle").fontSize),
      color: (e.getAttributes("textStyle").color as string | undefined) ?? "",
      lineHeight: (e.getAttributes("paragraph").lineHeight as string | undefined) ?? (e.getAttributes("heading").lineHeight as string | undefined) ?? "",
      canUndo: e.can().undo?.() ?? false, canRedo: e.can().redo?.() ?? false,
      empty: e.state.selection.empty,
    }),
  });
  const c = () => editor.chain().focus();
  const setStyle = (v: string) => {
    if (v === "p") c().setParagraph().run();
    else if (v === "code") c().toggleCodeBlock().run();
    else c().setHeading({ level: Number(v) as 1 | 2 | 3 | 4 }).run();
  };
  const setSize = (pt: number) => { const v = Math.max(6, Math.min(96, Math.round(pt))); c().setFontSize(`${v}pt`).run(); };
  const sel = "h-7 rounded bg-transparent px-1.5 text-[0.8rem] text-white/85 outline-none hover:bg-white/[0.08] focus:bg-white/[0.08] [&>option]:bg-ink-2";

  return (
    <div className="flex h-10 items-center gap-0.5 overflow-x-auto rounded-full border border-line bg-white/[0.035] px-3" role="toolbar" aria-label={tx("Formatting")}>
      {canWrite && <>
        <Btn label="Undo" shortcut={`${mod}Z`} disabled={!s.canUndo} onClick={() => c().undo().run()}><Undo2 size={15} /></Btn>
        <Btn label="Redo" shortcut={`${mod}${shift}Z`} disabled={!s.canRedo} onClick={() => c().redo().run()}><Redo2 size={15} /></Btn>
      </>}
      <Btn label="Print" shortcut={`${mod}P`} onClick={onPrint}><Printer size={15} /></Btn>
      <select aria-label={tx("Zoom")} title={tx("Zoom")} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className={cx(sel, "w-[4.4rem]")}>
        {[50, 75, 90, 100, 125, 150, 200].map((z) => <option key={z} value={z}>{z}%</option>)}
      </select>
      {canWrite && <>
        <Sep />
        <select aria-label={tx("Styles")} title={tx("Styles")} value={s.style} onChange={(e) => setStyle(e.target.value)} className={cx(sel, "w-[7.6rem]")}>
          {STYLES.map((o) => <option key={o.value} value={o.value}>{tx(o.label)}</option>)}
        </select>
        <Sep />
        <select aria-label={tx("Font")} title={tx("Font")} value={s.font} onChange={(e) => (e.target.value ? c().setFontFamily(e.target.value).run() : c().unsetFontFamily().run())} className={cx(sel, "w-[7.2rem]")}>
          {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>
        <Sep />
        <Btn label="Decrease font size" onClick={() => setSize(s.size - 1)}><Minus size={13} /></Btn>
        <input aria-label={tx("Font size")} title={tx("Font size")} key={s.size} defaultValue={s.size} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setSize(Number((e.target as HTMLInputElement).value) || 12); } }}
          onBlur={(e) => { const v = Number(e.target.value); if (v && v !== s.size) setSize(v); }}
          className="h-6 w-9 rounded border border-white/15 bg-transparent text-center text-[0.8rem] text-white outline-none focus:border-sky-400" />
        <Btn label="Increase font size" onClick={() => setSize(s.size + 1)}><Plus size={13} /></Btn>
        <Sep />
        <Btn label="Bold" shortcut={`${mod}B`} active={s.bold} onClick={() => c().toggleBold().run()}><Bold size={15} /></Btn>
        <Btn label="Italic" shortcut={`${mod}I`} active={s.italic} onClick={() => c().toggleItalic().run()}><Italic size={15} /></Btn>
        <Btn label="Underline" shortcut={`${mod}U`} active={s.underline} onClick={() => c().toggleUnderline().run()}><Underline size={15} /></Btn>
        <Btn label="Strikethrough" shortcut={`${mod}${shift}S`} active={s.strike} onClick={() => c().toggleStrike().run()}><Strikethrough size={15} /></Btn>
        <Popover label="Text color" button={<span className="relative"><Baseline size={15} /><span className="absolute -bottom-0.5 left-0 h-[3px] w-full rounded" style={{ background: s.color || "currentColor" }} /></span>}>
          {(close) => <Swatches colors={COLORS} onPick={(col) => { c().setColor(col).run(); close(); }} onReset={() => { c().unsetColor().run(); close(); }} />}
        </Popover>
        <Popover label="Highlight color" button={<Highlighter size={15} />}>
          {(close) => <Swatches colors={HIGHLIGHTS} onPick={(col) => { c().setHighlight({ color: col }).run(); close(); }} onReset={() => { c().unsetHighlight().run(); close(); }} />}
        </Popover>
        <Sep />
        <Btn label="Insert link" shortcut={`${mod}K`} active={s.link} onClick={onLink}><Link2 size={15} /></Btn>
        <Btn label="Add comment" shortcut={`${mod}${alt}M`} disabled={s.empty} onClick={onComment}><MessageSquarePlus size={15} /></Btn>
        <Btn label="Insert image" onClick={onImage}><ImagePlus size={15} /></Btn>
        <Btn label="Insert table" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table size={15} /></Btn>
        <Sep />
        <Btn label="Left align" shortcut={`${mod}${shift}L`} active={s.align === "left"} onClick={() => c().setTextAlign("left").run()}><AlignLeft size={15} /></Btn>
        <Btn label="Center align" shortcut={`${mod}${shift}E`} active={s.align === "center"} onClick={() => c().setTextAlign("center").run()}><AlignCenter size={15} /></Btn>
        <Btn label="Right align" shortcut={`${mod}${shift}R`} active={s.align === "right"} onClick={() => c().setTextAlign("right").run()}><AlignRight size={15} /></Btn>
        <Btn label="Justify" shortcut={`${mod}${shift}J`} active={s.align === "justify"} onClick={() => c().setTextAlign("justify").run()}><AlignJustify size={15} /></Btn>
        <select aria-label={tx("Line spacing")} title={tx("Line spacing")} value={s.lineHeight} onChange={(e) => (e.target.value ? c().setLineHeight(e.target.value).run() : c().unsetLineHeight().run())} className={cx(sel, "w-[3.6rem]")}>
          <option value="">↕</option>{["1", "1.15", "1.5", "2"].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <Sep />
        <Btn label="Checklist" shortcut={`${mod}${shift}9`} active={s.task} onClick={() => c().toggleTaskList().run()}><ListChecks size={15} /></Btn>
        <Btn label="Bulleted list" shortcut={`${mod}${shift}8`} active={s.bullet} onClick={() => c().toggleBulletList().run()}><List size={15} /></Btn>
        <Btn label="Numbered list" shortcut={`${mod}${shift}7`} active={s.ordered} onClick={() => c().toggleOrderedList().run()}><ListOrdered size={15} /></Btn>
        <Btn label="Decrease indent" onClick={() => (editor.isActive("listItem") ? c().liftListItem("listItem").run() : editor.isActive("taskItem") ? c().liftListItem("taskItem").run() : c().outdent().run())}><IndentDecrease size={15} /></Btn>
        <Btn label="Increase indent" onClick={() => (editor.isActive("listItem") ? c().sinkListItem("listItem").run() : editor.isActive("taskItem") ? c().sinkListItem("taskItem").run() : c().indent().run())}><IndentIncrease size={15} /></Btn>
        <Btn label="Quote" active={s.quote} onClick={() => c().toggleBlockquote().run()}><Quote size={15} /></Btn>
        <Btn label="Inline code" active={s.code} onClick={() => c().toggleCode().run()}><Code size={15} /></Btn>
        <Btn label="Clear formatting" shortcut={`${mod}\\`} onClick={() => c().unsetAllMarks().clearNodes().run()}><RemoveFormatting size={15} /></Btn>
        <Sep />
        <Btn label="Voice typing" active={voiceActive} onClick={onVoice}><Mic size={15} /></Btn>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onAssist} title={tx("Ask Orbital to write or edit")}
          className="ml-1 flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-sky-500/25 to-fuchsia-500/25 px-2.5 text-[0.78rem] text-white hover:from-sky-500/40 hover:to-fuchsia-500/40">
          <Sparkles size={13} />{tx("Ask Orbital")}
        </button>
      </>}
    </div>
  );
}

function Swatches({ colors, onPick, onReset }: { colors: string[]; onPick: (c: string) => void; onReset: () => void }) {
  return (
    <div className="w-[196px]">
      <button onClick={onReset} className="mb-2 w-full rounded px-2 py-1 text-left text-[0.76rem] text-mute-bright hover:bg-white/[0.07]">{tx("Reset")}</button>
      <div className="grid grid-cols-6 gap-1.5">
        {colors.map((col) => <button key={col} aria-label={col} title={col} onClick={() => onPick(col)} className="h-6 w-6 rounded-full border border-white/20 hover:scale-110" style={{ background: col }} />)}
      </div>
    </div>
  );
}
