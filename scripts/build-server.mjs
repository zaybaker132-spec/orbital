// Bundles the API server into a single ESM file for the desktop app.
// Third-party packages stay external (shipped in node_modules) — PGlite loads its WASM from its package dir.
import { build } from "esbuild";
import fs from "node:fs";

const out = "desktop-build/server";
fs.rmSync("desktop-build", { recursive: true, force: true });
await build({
  entryPoints: ["server/main.ts"],
  outfile: `${out}/main.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  sourcemap: "linked",
  logLevel: "info",
});
fs.cpSync("server/db/migrations", `${out}/migrations`, { recursive: true });
console.log("server bundle ->", out);
