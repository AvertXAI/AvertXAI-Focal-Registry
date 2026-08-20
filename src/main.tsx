/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./globals.css";
// AFTER globals.css — LOAD-BEARING. shell.css resets `body{padding-left}` and `.app-footer{left}`,
// which globals.css sets at the SAME specificity, so this wins on SOURCE ORDER only. Reversed, the
// content area stays permanently offset and the footer gap becomes permanent.
import "./shell.css";

// Boot theme (recon 3b): main resolves the persisted theme before the window loads and hands it
// over as ?theme=. Setting data-theme BEFORE the first React paint means the first frame is
// already the right mode — App's effect remains the runtime-switch path.
const bootTheme = new URLSearchParams(window.location.search).get("theme");
// An explicit "system" clears the attribute and falls through to the :root Hybrid block — that is a
// CHOICE and is honoured. Anything else, INCLUDING A MISSING PARAM, lands on light: the product
// default is light (Jason 08-19-2026), so the first painted frame must be light too, or a new
// install flashes navy for a frame before the settings read catches up.
document.documentElement.dataset.theme = bootTheme === "system" ? "" : bootTheme === "dark" ? "dark" : "light";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
