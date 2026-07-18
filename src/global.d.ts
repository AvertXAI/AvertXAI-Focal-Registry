/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Renderer global augmentation — types the preload bridges (window.api, window.runbooks).
import type { Api } from "./shared/types";

declare global {
  interface Window {
    api: Api;
    runbooks: { version: string; phase: number; bootDone(): void; bootStart(): void };
  }
}

export {};
