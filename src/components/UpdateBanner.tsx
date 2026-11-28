import { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { cx } from "./ui";
import { tx } from "@/i18n";

/**
 * Desktop app: a newer Orbital is out. Windows/Linux have already downloaded it ("Restart to
 * update"); a Mac without an Apple-signed build gets a link to the download page instead.
 */
export function UpdateBanner({ collapsed }: { collapsed: boolean }) {
  const bridge = window.orbitalDesktop;
  const [u, setU] = useState<{ state: "available" | "ready"; version: string } | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!bridge?.getUpdate) return;
    void bridge.getUpdate().then((x) => x && setU(x)).catch(() => {});
    return bridge.onUpdate?.((x) => { setU(x); setHidden(false); });
  }, [bridge]);
  if (!u || hidden || collapsed) return null;
  const ready = u.state === "ready";
  return (
    <div className={cx("mx-2.5 mb-2 flex items-center gap-2 rounded-lg border border-white/30 px-3 py-2 text-[0.78rem] text-white")} role="status">
      {ready ? <RefreshCw size={13} className="shrink-0" /> : <Download size={13} className="shrink-0" />}
      <button className="min-w-0 flex-1 text-left leading-snug hover:underline" onClick={() => void bridge?.installUpdate?.()}>
        {ready ? tx("Orbital {v} is ready · Restart", { v: u.version }) : tx("Orbital {v} is available · Download", { v: u.version })}
      </button>
      <button aria-label={tx("Later")} className="shrink-0 text-mute hover:text-white" onClick={() => setHidden(true)}><X size={13} /></button>
    </div>
  );
}
