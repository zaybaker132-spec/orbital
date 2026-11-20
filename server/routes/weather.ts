import { Router } from "express";
import { z } from "zod/v4";
import { config } from "../config.js";
import { ah, HttpError, parse } from "../lib/http.js";
import { rateLimit } from "../lib/rateLimit.js";
import { log } from "../lib/log.js";

/**
 * Weather for the sidebar, from Open-Meteo (free, no API key). The app asks this server, which asks
 * Open-Meteo: the app's content-security policy stays closed to other sites, and only the place the
 * person chose (a name to search for, or its coordinates) is sent. Answers are cached briefly.
 */
export const weather = Router();

const TIMEOUT_MS = 6000;
async function getJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json", "user-agent": "Orbital (weather)" } });
  if (!res.ok) throw new Error(`weather service answered ${res.status}`);
  return res.json() as Promise<any>;
}
const unavailable = (e: unknown) => {
  log.warn("weather unavailable", { err: e });
  return new HttpError(502, "Weather isn't available right now. Try again in a few minutes.", "weather_unavailable");
};
function requireEnabled() {
  if (!config.weather.enabled) throw new HttpError(404, "Weather is turned off on this server.", "weather_disabled");
}

const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const data = await load();
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return data;
}

/** Places matching what someone typed ("Lisbon", "Paris, Texas", a postcode in some countries). */
weather.get("/weather/places", rateLimit({ windowMs: 60_000, max: 30, key: "user", name: "weather-places" }), ah(async (req, res) => {
  requireEnabled();
  const { q, lang } = parse(z.object({ q: z.string().trim().min(2).max(100), lang: z.enum(["en", "es", "fr", "pt", "de"]).default("en") }), req.query);
  try {
    const data = await cached(`p:${lang}:${q.toLowerCase()}`, 24 * 3600_000, () =>
      getJson(`${config.weather.geocodeUrl}/v1/search?name=${encodeURIComponent(q)}&count=6&language=${lang}&format=json`));
    res.json((data.results ?? []).map((p: any) => ({
      name: String(p.name ?? "").slice(0, 80), region: String(p.admin1 ?? "").slice(0, 80), country: String(p.country ?? "").slice(0, 80),
      lat: Number(p.latitude), lon: Number(p.longitude), timezone: typeof p.timezone === "string" ? p.timezone.slice(0, 64) : "",
    })).filter((p: any) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon)));
  } catch (e) { throw unavailable(e); }
}));

/** Now and today at a place: temperature, conditions (WMO code), day or night, high and low. */
weather.get("/weather", rateLimit({ windowMs: 60_000, max: 30, key: "user", name: "weather" }), ah(async (req, res) => {
  requireEnabled();
  const b = parse(z.object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180), unit: z.enum(["c", "f"]).default("c") }), req.query);
  // Rounded to ~1 km: plenty for weather, and nearby requests share a cache entry.
  const lat = Math.round(b.lat * 100) / 100, lon = Math.round(b.lon * 100) / 100;
  try {
    const data = await cached(`w:${lat}:${lon}:${b.unit}`, 10 * 60_000, () => getJson(
      `${config.weather.forecastUrl}/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day` +
      `&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto${b.unit === "f" ? "&temperature_unit=fahrenheit" : ""}`));
    const cur = data.current ?? {};
    if (!Number.isFinite(cur.temperature_2m)) throw new Error("no current temperature");
    res.json({
      temperature: Math.round(cur.temperature_2m), code: Number(cur.weather_code ?? 0), isDay: cur.is_day !== 0, unit: b.unit,
      high: Number.isFinite(data.daily?.temperature_2m_max?.[0]) ? Math.round(data.daily.temperature_2m_max[0]) : null,
      low: Number.isFinite(data.daily?.temperature_2m_min?.[0]) ? Math.round(data.daily.temperature_2m_min[0]) : null,
      timezone: typeof data.timezone === "string" ? data.timezone : null,
    });
  } catch (e) { throw unavailable(e); }
}));
