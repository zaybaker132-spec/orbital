// Builds the standalone Neural Core used by the preview page and the public website (site/) into one script file.
import { build } from "esbuild";
import { copyFileSync } from "node:fs";
await build({
  entryPoints: ["src/preview/main.ts"],
  outfile: "preview-site/neural-core.js",
  bundle: true, format: "iife", minify: true, target: "es2020", legalComments: "none", logLevel: "info",
});
copyFileSync("preview-site/neural-core.js", "site/neural-core.js");
