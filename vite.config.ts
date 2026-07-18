/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the renderer loads over file:// inside the packaged Electron app.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
