/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Mini timer window — third renderer entry (mini.html), the update-window pattern. Reuses
// globals.css for the theme tokens; mini.css resets shell offsets and lays out the strip.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MiniTimer from "./MiniTimer";
import "../globals.css";
import "./mini.css";

// Same pre-paint theme handshake as the main and update windows (?theme= from main-side).
const theme = new URLSearchParams(window.location.search).get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MiniTimer />
  </StrictMode>
);
