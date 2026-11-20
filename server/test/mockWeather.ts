import http from "node:http";

/**
 * TEST-ONLY stand-in for Open-Meteo's geocoding and forecast APIs (same paths and response shapes), so
 * the weather proxy can be exercised without network access. Never used by the application at runtime.
 */
export const PLACES = [
  { name: "Lisbon", admin1: "Lisbon", country: "Portugal", latitude: 38.71667, longitude: -9.13333 },
  { name: "Lisbon", admin1: "Maine", country: "United States", latitude: 44.0312, longitude: -70.1045 },
];

export function startMockWeather(): Promise<{ url: string; calls: string[]; fail: (on: boolean) => void; close: () => void }> {
  const calls: string[] = [];
  let failing = false;
  const server = http.createServer((req, res) => {
    calls.push(req.url ?? "");
    const u = new URL(req.url ?? "/", "http://x");
    const json = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (failing) return json(503, { error: true, reason: "down" });
    if (u.pathname === "/v1/search") {
      const name = (u.searchParams.get("name") ?? "").toLowerCase();
      const results = PLACES.filter((p) => p.name.toLowerCase().startsWith(name));
      return json(200, results.length ? { results } : {});
    }
    if (u.pathname === "/v1/forecast") {
      const f = u.searchParams.get("temperature_unit") === "fahrenheit";
      return json(200, {
        timezone: "Europe/Lisbon",
        current: { temperature_2m: f ? 64.6 : 18.4, weather_code: 2, is_day: 1 },
        daily: { temperature_2m_max: [f ? 70.2 : 21.2], temperature_2m_min: [f ? 55.4 : 13.0] },
      });
    }
    json(404, { error: true });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => {
    const a = server.address();
    r({ url: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`, calls, fail: (on) => { failing = on; }, close: () => server.close() });
  }));
}
