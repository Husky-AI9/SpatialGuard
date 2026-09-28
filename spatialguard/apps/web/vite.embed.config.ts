import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Builds the home map as one self-contained script and stylesheet for the
 * native app's WebView (see src/embed and apps/expo-go/scripts/build-map-embed.mjs).
 * Fonts are inlined so the page needs no network access.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom", "three"] },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist-embed",
    emptyOutDir: true,
    copyPublicDir: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    lib: {
      entry: "src/embed/main.tsx",
      formats: ["iife"],
      name: "SpatialGuardMap",
      fileName: () => "map.js",
      cssFileName: "map",
    },
  },
});
