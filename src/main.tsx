/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./globals.css";

// Boot theme (recon 3b): main resolves the persisted theme before the window loads and hands it
// over as ?theme=. Setting data-theme BEFORE the first React paint means the first frame is
// already the right mode — App's effect remains the runtime-switch path.
const bootTheme = new URLSearchParams(window.location.search).get("theme");
if (bootTheme === "light" || bootTheme === "dark") document.documentElement.dataset.theme = bootTheme;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
