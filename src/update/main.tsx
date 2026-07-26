/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Software Update window — second renderer entry (update.html). Reuses globals.css for the theme
// tokens; update.css resets the shell-layout body offsets (rail/footer padding) that don't apply here.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import UpdateWindow from "./UpdateWindow";
import "../globals.css";
import "./update.css";

// Same pre-paint theme handshake as the main window: main resolves the persisted theme and hands it
// over as ?theme= so the first frame is already the right mode. Absent/system → hybrid :root block.
const theme = new URLSearchParams(window.location.search).get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UpdateWindow />
  </StrictMode>
);
