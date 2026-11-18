// Builds the standalone Neural Core used by the public preview page into one script file.
import { build } from "esbuild";
await build({
  entryPoints: ["src/preview/main.ts"],
  outfile: "preview-site/neural-core.js",
  bundle: true, format: "iife", minify: true, target: "es2020", legalComments: "none", logLevel: "info",
});
