import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { output: { manualChunks: { cytoscape: ["cytoscape"] } } },
  },
  server: { proxy: { "/api": "http://127.0.0.1:8484" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    clearMocks: true,
  },
});
