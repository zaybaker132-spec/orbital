import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";

// On-device speech recognition runs ONNX Runtime as WebAssembly. Serve its files from the app itself
// (public/ort) instead of a CDN, so it works offline and within the app's content security policy.
const ortDir = path.resolve(import.meta.dirname, "node_modules/onnxruntime-web/dist");
const ortOut = path.resolve(import.meta.dirname, "public/ort");
if (fs.existsSync(ortDir)) {
  fs.mkdirSync(ortOut, { recursive: true });
  for (const f of fs.readdirSync(ortDir)) if (/^ort-wasm-simd-threaded\.asyncify\.(mjs|wasm)$/.test(f)) fs.copyFileSync(path.join(ortDir, f), path.join(ortOut, f));
}

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  server: {
    port: 5173,
    host: true,
    // Previews reach the dev server through a proxy hostname; Vite would otherwise reject them.
    allowedHosts: true,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "@react-three/fiber"],
          markdown: ["react-markdown", "remark-gfm", "rehype-highlight"],
          react: ["react", "react-dom", "react-router-dom", "framer-motion", "zustand"],
        },
      },
    },
  },
});
