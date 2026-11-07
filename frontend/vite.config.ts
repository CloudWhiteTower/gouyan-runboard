import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "../src/runboard/web",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("echarts") || id.includes("zrender")) return "charts";
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
  server: { proxy: { "/api": "http://127.0.0.1:7310" } },
});
