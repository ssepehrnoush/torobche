import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // API_TARGET points the dev server at another local backend (several checkouts run side by side)
    proxy: { "/api": { target: process.env.API_TARGET || "http://localhost:8077", changeOrigin: true } },
  },
  build: { target: "es2020", chunkSizeWarningLimit: 900 },
});
