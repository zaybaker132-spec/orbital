import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }>(
  ({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-normal transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed select-none whitespace-nowrap",
        size === "sm" ? "h-7 px-2.5 text-[0.8rem]" : "h-9 px-3.5 text-[0.88rem]",
        variant === "primary" && "bg-white text-black hover:bg-white/90",
        variant === "secondary" && "bg-white/[0.06] text-white hover:bg-white/[0.1] border border-line",
        variant === "ghost" && "text-mute-bright hover:text-white hover:bg-white/[0.06]",
        variant === "danger" && "text-red-300 hover:bg-red-500/10 border border-red-400/20",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  ),
);

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }>(({ label, active, className, children, ...rest }, ref) => (
  <button
    ref={ref}
    aria-label={label}
    title={label}
    className={cx("inline-flex h-8 w-8 items-center justify-center rounded-lg text-mute transition-colors hover:bg-white/[0.07] hover:text-white", active && "bg-white/[0.08] text-white", className)}
    {...rest}
  >
    {children}
  </button>
));

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...rest }, ref) => <input ref={ref} className={cx("input", className)} {...rest} />);
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...rest }, ref) => <textarea ref={ref} className={cx("input resize-none leading-relaxed", className)} {...rest} />);

export function Select({ value, onChange, options, className, label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; label?: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cx("input h-9 py-0 pr-8 cursor-pointer appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5l3 3 3-3' stroke='%23888' fill='none' stroke-width='1.3'/%3E%3C/svg%3E\")" }}>
      {options.map((o) => <option key={o.value} value={o.value} className="bg-ink-2">{o.label}</option>)}
    </select>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-3.5 w-3.5 animate-spin rounded-full border border-white/20 border-t-white/80", className)} aria-hidden />;
}

/** Dots that breathe — the app's loading signature, echoing the Neural Core. */
export function Pulse({ label = "Loading" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1" role="status" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="h-1 w-1 rounded-full bg-white/70" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.18 }} />
      ))}
    </span>
  );
}

export function Badge({ children, tone = "default", className }: { children: ReactNode; tone?: "default" | "ai" | "warn" | "ok" | "info"; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[0.7rem] leading-5 border",
      tone === "default" && "border-line text-mute-bright",
      tone === "ai" && "border-violet-300/20 text-violet-200/90",
      tone === "warn" && "border-amber-300/25 text-amber-200/90",
      tone === "ok" && "border-emerald-300/25 text-emerald-200/90",
      tone === "info" && "border-sky-300/25 text-sky-200/90",
      className)}>
      {children}
    </span>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-5 grid grid-cols-5 gap-1.5 opacity-60" aria-hidden>
        {Array.from({ length: 15 }, (_, i) => (
          <span key={i} className="h-1 w-1 rounded-full bg-white" style={{ opacity: 0.15 + ((i * 37) % 10) / 14 }} />
        ))}
      </div>
      <h3 className="text-[0.95rem] text-white">{title}</h3>
      {children && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-mute">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error?: Error | string | null }) {
  if (!error) return null;
  return <p role="alert" className="rounded-lg border border-red-400/20 bg-red-500/[0.06] px-3 py-2 text-sm text-red-200">{typeof error === "string" ? error : error.message}</p>;
}

export function Dialog({ open, onClose, title, children, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("input,textarea,select,button:not([data-close])")?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab" && ref.current) {
        const els = [...ref.current.querySelectorAll<HTMLElement>("a,button,input,textarea,select,[tabindex]:not([tabindex='-1'])")].filter((el) => !el.hasAttribute("disabled"));
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[12vh] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx("w-full rounded-xl border border-line-strong bg-ink-1 shadow-2xl", width)}
            initial={{ y: 8, scale: 0.985 }} animate={{ y: 0, scale: 1 }} exit={{ y: 6, opacity: 0 }} transition={{ duration: 0.16 }}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="text-[0.95rem] font-normal">{title}</h2>
              <IconButton label="Close" onClick={onClose} data-close><X size={15} /></IconButton>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cx("flex items-center gap-5 border-b border-line", className)}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cx("relative -mb-px pb-2.5 pt-1 text-[0.86rem] transition-colors", value === t.value ? "text-white" : "text-mute hover:text-white/80")}>
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="ml-1.5 text-mute">{t.count}</span>}
          {value === t.value && <motion.span layoutId={`tab-${tabs.map((x) => x.value).join()}`} className="absolute inset-x-0 -bottom-px h-px bg-white" />}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-6 px-8 pb-5 pt-7">
      <div className="min-w-0">
        <h1 className="text-[1.35rem] font-normal tracking-[-0.015em] text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-mute">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="text-[1.6rem] font-light tabular-nums tracking-tight text-white">{value}</div>
      <div className="mt-0.5 text-[0.78rem] text-mute">{label}</div>
    </div>
  );
}
