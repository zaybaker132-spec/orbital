import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startMockWeather } from "./mockWeather.js";

// Sidebar clock and weather: place search and conditions through the server, cached, honest when the
// weather service is down, signed-in only; the chosen place and clock format are validated preferences.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-weather-test-"));
let server: Server;
let base = "";
let mock: Awaited<ReturnType<typeof startMockWeather>>;
class Client {
  cookie = "";
  ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  async req(method: string, url: string, body?: unknown) {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-orbital-request": "1", "x-forwarded-for": this.ip, cookie: this.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text as any }; }
  }
}
let me: Client;
before(async () => {
  mock = await startMockWeather();
  Object.assign(process.env, {
    ORBITAL_DATA_DIR: dir, AI_PROVIDER: "none", DATABASE_URL: process.env.TEST_DATABASE_URL || "", ORBITAL_ALLOW_SIGNUP: "true",
    RESEARCH_WIKIPEDIA: "false", RESEARCH_OPENALEX: "false", WEATHER_API_URL: mock.url, WEATHER_GEOCODE_URL: mock.url,
  });
  const { createApp } = await import("../index.js");
  const app = await createApp();
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  me = new Client();
  assert.equal((await me.req("POST", "/api/auth/signup", { email: "wx@orbital.test", password: "long enough password" })).status, 201);
});
after(async () => {
  server?.close();
  mock?.close();
  const { db } = await import("../db/client.js");
  await db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("weather: place search returns tidy places, cached, validated", async () => {
  const r = await me.req("GET", "/api/weather/places?q=Lisb&lang=pt");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data[0], { name: "Lisbon", region: "Lisbon", country: "Portugal", lat: 38.71667, lon: -9.13333, timezone: "Europe/Lisbon" });
  assert.equal(r.data.length, 2);
  assert.match(mock.calls.at(-1)!, /language=pt/);
  const before = mock.calls.length;
  await me.req("GET", "/api/weather/places?q=lisb&lang=pt");
  assert.equal(mock.calls.length, before, "the same search is answered from the cache");
  assert.deepEqual((await me.req("GET", "/api/weather/places?q=Nowhereville")).data, []);
  assert.equal((await me.req("GET", "/api/weather/places?q=L")).status, 400, "at least two characters");
  assert.equal((await me.req("GET", "/api/weather/places?q=Lisbon&lang=xx")).status, 400);
});

test("weather: current conditions, high and low, in °C or °F, rounded and cached", async () => {
  const c = await me.req("GET", "/api/weather?lat=38.71667&lon=-9.13333&unit=c");
  assert.equal(c.status, 200);
  assert.deepEqual(c.data, { temperature: 18, code: 2, isDay: true, unit: "c", high: 21, low: 13, timezone: "Europe/Lisbon" });
  assert.match(mock.calls.at(-1)!, /latitude=38\.72&longitude=-9\.13/, "coordinates are rounded before leaving the server");
  const f = await me.req("GET", "/api/weather?lat=38.71667&lon=-9.13333&unit=f");
  assert.equal(f.data.temperature, 65);
  assert.match(mock.calls.at(-1)!, /temperature_unit=fahrenheit/);
  const before = mock.calls.length;
  await me.req("GET", "/api/weather?lat=38.7171&lon=-9.1331&unit=c");
  assert.equal(mock.calls.length, before, "a nearby request within 10 minutes is served from the cache");
  assert.equal((await me.req("GET", "/api/weather?lat=91&lon=0")).status, 400);
  assert.equal((await me.req("GET", "/api/weather?lat=abc&lon=0")).status, 400);
});

test("weather: an outage is reported honestly, and only signed-in people can use it", async () => {
  mock.fail(true);
  try {
    const r = await me.req("GET", "/api/weather?lat=10&lon=10&unit=c");
    assert.equal(r.status, 502);
    assert.equal(r.data.code, "weather_unavailable");
    assert.equal((await me.req("GET", "/api/weather/places?q=Porto")).status, 502);
  } finally { mock.fail(false); }
  assert.equal((await new Client().req("GET", "/api/weather?lat=10&lon=10")).status, 401);
  assert.equal((await new Client().req("GET", "/api/weather/places?q=Porto")).status, 401);
});

test("clock and weather preferences are validated and saved", async () => {
  const place = { name: "Lisbon", region: "Lisbon", country: "Portugal", lat: 38.71667, lon: -9.13333 };
  assert.equal((await me.req("PUT", "/api/preferences", { clock: { show: true, hour12: "24" }, weather: { place, unit: "c" } })).status, 200);
  const prefs = (await me.req("GET", "/api/auth/me")).data.preferences;
  assert.deepEqual(prefs.clock, { show: true, hour12: "24" });
  assert.deepEqual(prefs.weather, { place, unit: "c" });
  assert.equal((await me.req("PUT", "/api/preferences", { weather: { place: null, unit: "f" } })).status, 200, "weather can be removed");
  assert.equal((await me.req("PUT", "/api/preferences", { weather: { place: { ...place, lat: 200 }, unit: "c" } })).status, 400);
  assert.equal((await me.req("PUT", "/api/preferences", { weather: { place, unit: "k" } })).status, 400);
  assert.equal((await me.req("PUT", "/api/preferences", { weather: { place: { ...place, extra: 1 }, unit: "c" } })).status, 400);
  assert.equal((await me.req("PUT", "/api/preferences", { clock: { show: true, hour12: "13" } })).status, 400);
});
