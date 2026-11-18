import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
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
