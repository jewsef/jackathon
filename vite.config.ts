import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
  test: { environment: "node", testTimeout: 60000 }
} as any);
