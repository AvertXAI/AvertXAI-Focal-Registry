/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// DEV HOST renderer — mounts the Vault module and nothing else, so the screens can be looked at
// before the module is wired into the real shell. Never ships; stays behind on copy-back.
import { createRoot } from "react-dom/client";
import VaultModule from "../src/modules/vault/VaultModule";

const el = document.getElementById("root");
if (el) createRoot(el).render(<VaultModule />);
