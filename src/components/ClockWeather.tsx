import { useEffect, useRef, useState } from "react";
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSun, MapPin, Moon, Search, Snowflake, Sun, X } from "lucide-react";
import { language, locale, tx } from "@/i18n";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { useApp, type ClockPrefs, type WeatherPlace, type WeatherPrefs } from "@/state/app";
import { toastError } from "@/state/ui";

/** The sidebar's small clock and weather. Click the weather (or "Add weather") to choose a place. */
export function ClockWeather({ collapsed }: { collapsed: boolean }) {
  const prefs = useApp((s) => s.prefs);
  const clock: ClockPrefs = prefs.clock ?? { show: true, hour12: "auto" };
  const wx: WeatherPrefs = prefs.weather ?? { place: null, unit: defaultUnit() };
  const now = useNow();
  const [open, setOpen] = useState(false);
  if (!clock.show && !wx.place) return collapsed ? null : <AddWeather onOpen={() => setOpen(true)} open={open} onClose={() => setOpen(false)} wx={wx} />;

  const hour12 = clock.hour12 === "auto" ? undefined : clock.hour12 === "12";
  const time = now.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit", hour12 });
  const date = now.toLocaleDateString(locale(), { weekday: "short", month: "short", day: "numeric" });

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 py-2 text-center" title={`${date} · ${time}`}>
        {clock.show && <span className="text-[0.7rem] tabular-nums text-mute-bright">{now.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit", hour12: false })}</span>}
        {wx.place && <WeatherNow wx={wx} compact />}
      </div>
    );
  }
  return (
    <div className="relative mx-2.5 mb-2">
      <div className="flex items-center gap-3 rounded-lg px-2.5 py-2">
        {clock.show && (
          <div className="min-w-0">
            <div className="text-[1.05rem] font-light tabular-nums leading-tight text-white" aria-label={tx("Time")}>{time}</div>
            <div className="text-[0.72rem] text-mute">{date}</div>
          </div>
        )}
        {wx.place ? (
          <button onClick={() => setOpen(!open)} aria-expanded={open} title={tx("Change the weather location")}
            className="ml-auto flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-right hover:bg-white/[0.05]">
            <WeatherNow wx={wx} />
          </button>
        ) : (
          <button onClick={() => setOpen(!open)} className="ml-auto flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[0.74rem] text-mute hover:bg-white/[0.05] hover:text-white">
            <CloudSun size={14} /> {tx("Add weather")}
          </button>
        )}
      </div>
      {open && <WeatherPicker wx={wx} onClose={() => setOpen(false)} />}
    </div>
  );
}

function AddWeather({ onOpen, open, onClose, wx }: { onOpen: () => void; open: boolean; onClose: () => void; wx: WeatherPrefs }) {
  return (
    <div className="relative mx-2.5 mb-2">
      <button onClick={onOpen} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.74rem] text-mute hover:bg-white/[0.05] hover:text-white"><CloudSun size={14} /> {tx("Add weather")}</button>
      {open && <WeatherPicker wx={wx} onClose={onClose} />}
    </div>
  );
}

function WeatherNow({ wx, compact = false }: { wx: WeatherPrefs; compact?: boolean }) {
  const p = wx.place!;
  const { data, error } = useResource<{ temperature: number; code: number; isDay: boolean; high: number | null; low: number | null }>(
    `/weather?lat=${p.lat}&lon=${p.lon}&unit=${wx.unit}`);
  // Fresh conditions every 15 minutes (the server caches for 10).
  useEffect(() => { const t = setInterval(() => invalidate("/weather?"), 15 * 60_000); return () => clearInterval(t); }, []);
  const Icon = data ? iconFor(data.code, data.isDay) : Cloud;
  const label = data ? `${conditionFor(data.code)}, ${data.temperature}°` : "";
  if (compact) {
    return (
      <span className="flex flex-col items-center text-[0.7rem] text-mute-bright" title={data ? `${p.name}: ${label}` : p.name}>
        <Icon size={14} strokeWidth={1.6} />{data ? `${data.temperature}°` : "–"}
      </span>
    );
  }
  return (
    <>
      <span className="min-w-0">
        <span className="block text-[0.95rem] font-light leading-tight text-white">{data ? `${data.temperature}°${wx.unit.toUpperCase()}` : error ? "–" : "…"}</span>
        <span className="block max-w-[7.5rem] truncate text-[0.7rem] text-mute" title={error ? tx("Weather isn't available right now") : data ? `${conditionFor(data.code)} · ${tx("H {high}° L {low}°", { high: data.high ?? "–", low: data.low ?? "–" })}` : undefined}>{p.name}</span>
      </span>
      <Icon size={20} strokeWidth={1.4} className="shrink-0 text-mute-bright" aria-label={label} />
    </>
  );
}

/** Type a place, pick it from the matches; switch °C / °F; or remove the weather. */
function WeatherPicker({ wx, onClose }: { wx: WeatherPrefs; onClose: () => void }) {
  const setPrefs = useApp((s) => s.setPrefs);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<WeatherPlace[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const save = (w: WeatherPrefs) => setPrefs({ weather: w }).catch(toastError);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    setTimeout(() => document.addEventListener("mousedown", away));
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [onClose]);

  // Search as you type, a moment after you stop.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); setProblem(""); return; }
    let live = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await api.get<WeatherPlace[]>(`/weather/places?q=${encodeURIComponent(term)}&lang=${language()}`);
        if (live) { setResults(r); setProblem(""); }
      } catch (e: any) { if (live) { setResults(null); setProblem(e?.message ?? tx("Weather isn't available right now")); } }
      finally { if (live) setBusy(false); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  return (
    <div ref={box} role="dialog" aria-label={tx("Weather location")}
      className="absolute bottom-full left-0 right-0 z-30 mb-1 rounded-xl border border-line-strong bg-ink-2 p-2.5 shadow-2xl">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="label">{tx("Weather location")}</span>
        <button onClick={onClose} className="rounded p-0.5 text-mute hover:text-white" aria-label={tx("Close")}><X size={13} /></button>
      </div>
      <label className="flex items-center gap-2 rounded-lg border border-line bg-black/30 px-2.5 focus-within:border-white/30">
        <Search size={13} className="shrink-0 text-mute" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Type a city or town")} aria-label={tx("Type a city or town")}
          className="h-8 min-w-0 flex-1 bg-transparent text-[0.82rem] text-white placeholder:text-mute-soft focus:outline-none" />
      </label>
      <ul className="mt-1.5 max-h-52 overflow-y-auto">
        {busy && <li className="px-2 py-1.5 text-[0.76rem] text-mute">{tx("Searching…")}</li>}
        {!busy && problem && <li className="px-2 py-1.5 text-[0.76rem] text-amber-300">{problem}</li>}
        {!busy && results?.length === 0 && <li className="px-2 py-1.5 text-[0.76rem] text-mute">{tx("No places found. Try another spelling, or add the country.")}</li>}
        {results?.map((p, i) => (
          <li key={`${p.lat},${p.lon},${i}`}>
            <button onClick={() => { save({ ...wx, place: p }); onClose(); }} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/[0.06]">
              <MapPin size={13} className="mt-0.5 shrink-0 text-mute" />
              <span className="min-w-0"><span className="block truncate text-[0.82rem] text-white">{p.name}</span><span className="block truncate text-[0.7rem] text-mute">{[p.region, p.country].filter(Boolean).join(", ")}</span></span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2 border-t border-line px-0.5 pt-2">
        <div role="radiogroup" aria-label={tx("Temperature unit")} className="flex rounded-md border border-line">
          {(["c", "f"] as const).map((u) => (
            <button key={u} role="radio" aria-checked={wx.unit === u} onClick={() => save({ ...wx, unit: u })}
              className={wx.unit === u ? "bg-white px-2 py-0.5 text-[0.72rem] text-black" : "px-2 py-0.5 text-[0.72rem] text-mute hover:text-white"}>°{u.toUpperCase()}</button>
          ))}
        </div>
        {wx.place && <span className="min-w-0 flex-1 truncate text-[0.72rem] text-mute">{tx("Now: {place}", { place: wx.place.name })}</span>}
        {wx.place && <button onClick={() => { save({ ...wx, place: null }); onClose(); }} className="ml-auto text-[0.72rem] text-mute hover:text-red-300">{tx("Remove")}</button>}
      </div>
    </div>
  );
}

/** The time, updated on the minute. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { setNow(new Date()); t = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50); };
    t = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => clearTimeout(t);
  }, []);
  return now;
}

/** Fahrenheit where people use it (US and a few others); Celsius elsewhere. */
function defaultUnit(): "c" | "f" {
  const region = (navigator.language.split("-")[1] ?? "").toUpperCase();
  return ["US", "LR", "MM", "BS", "BZ", "KY", "PW"].includes(region) ? "f" : "c";
}

/** WMO weather codes (Open-Meteo) → icon and words. */
function iconFor(code: number, day: boolean) {
  if (code === 0) return day ? Sun : Moon;
  if (code <= 2) return day ? CloudSun : CloudMoon;
  if (code === 3) return Cloud;
  if (code === 45 || code === 48) return CloudFog;
  if (code >= 51 && code <= 57) return CloudDrizzle;
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return CloudRain;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return Snowflake;
  if (code >= 95) return CloudLightning;
  return Cloud;
}
function conditionFor(code: number) {
  if (code === 0) return tx("Clear");
  if (code <= 2) return tx("Partly cloudy");
  if (code === 3) return tx("Overcast");
  if (code === 45 || code === 48) return tx("Fog");
  if (code >= 51 && code <= 57) return tx("Drizzle");
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return tx("Rain");
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return tx("Snow");
  if (code >= 95) return tx("Thunderstorm");
  return tx("Cloudy");
}
