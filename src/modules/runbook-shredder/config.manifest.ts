// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Runbook Shredder config manifest — the "Expose, Don't Connect" merge handshake.
//              Declares the module's namespaced setting keys + defaults + types. Root owns
//              persistence and wires these at merge; in standalone dev the service consumes
//              defaultSettings() as the local mock. This module NEVER touches root app_settings.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/runbook-shredder/config.manifest.ts
//------------------------------------------------------------

// The typed settings the service consumes via injected props. Single source of truth for the shape.
export interface ShredderSettings {
  "runbook-shredder.watch_enabled": boolean;
  "runbook-shredder.watch_path": string;
  "runbook-shredder.auto_reparse": boolean;
  "runbook-shredder.rail_collapsed": boolean;
  "runbook-shredder.font_size": number;
}

export interface ConfigEntry {
  type: "boolean" | "string" | "number";
  default: boolean | string | number;
  label: string;
  description: string;
}

export const CONFIG_MANIFEST: Record<keyof ShredderSettings, ConfigEntry> = {
  "runbook-shredder.watch_enabled": {
    type: "boolean",
    default: true,
    label: "Watch folder",
    description: "Auto-ingest .md runbooks when the watched folder changes on disk.",
  },
  "runbook-shredder.watch_path": {
    type: "string",
    default: "",
    label: "Runbooks folder",
    description: "Absolute path to the folder of .md runbooks to ingest.",
  },
  "runbook-shredder.auto_reparse": {
    type: "boolean",
    default: true,
    label: "Auto re-parse",
    description: "Re-parse a runbook when its file changes on disk (off = only new/deleted files act).",
  },
  "runbook-shredder.rail_collapsed": {
    type: "boolean",
    default: false,
    label: "Collapse list rail",
    description: "Collapse the runbook list to a thin strip; the detail pane takes the width.",
  },
  "runbook-shredder.font_size": {
    type: "number",
    default: 13,
    label: "Detail font size",
    description: "Body text size (px) in the runbook detail pane; headings scale proportionally.",
  },
};

// Standalone-dev / merge default settings. Root replaces this with persisted values at merge time.
export function defaultSettings(): ShredderSettings {
  return {
    "runbook-shredder.watch_enabled": CONFIG_MANIFEST["runbook-shredder.watch_enabled"].default as boolean,
    "runbook-shredder.watch_path": CONFIG_MANIFEST["runbook-shredder.watch_path"].default as string,
    "runbook-shredder.auto_reparse": CONFIG_MANIFEST["runbook-shredder.auto_reparse"].default as boolean,
    "runbook-shredder.rail_collapsed": CONFIG_MANIFEST["runbook-shredder.rail_collapsed"].default as boolean,
    "runbook-shredder.font_size": CONFIG_MANIFEST["runbook-shredder.font_size"].default as number,
  };
}
