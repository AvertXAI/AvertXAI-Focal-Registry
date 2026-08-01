/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// base "./" so the renderer loads over file:// inside the packaged Electron app.
// Three entries: the shell (index.html), the Software Update window (update.html), and the
// TimeTracker mini timer (mini.html).
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        update: fileURLToPath(new URL("./update.html", import.meta.url)),
        mini: fileURLToPath(new URL("./mini.html", import.meta.url)),
      },
    },
  },
});
