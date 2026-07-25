// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: MindMerge config manifest — the "Expose, Don't Connect" merge handshake.
//              Declares the module's namespaced setting keys + defaults + types. Root owns
//              persistence and wires these at merge; in standalone dev the service consumes
//              defaultSettings() as the local mock. This module NEVER touches root app_settings.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/mindmerge/config.manifest.ts
//------------------------------------------------------------

// The typed settings the service consumes via injected props. Single source of truth for the shape.
export interface MindMergeSettings {
  "mindmerge.watch_enabled": boolean;
  "mindmerge.watch_path": string;
  "mindmerge.auto_reparse": boolean;
  "mindmerge.rail_collapsed": boolean;
  "mindmerge.font_size": number;
}

export interface ConfigEntry {
  type: "boolean" | "string" | "number";
  default: boolean | string | number;
  label: string;
  description: string;
}

export const CONFIG_MANIFEST: Record<keyof MindMergeSettings, ConfigEntry> = {
  "mindmerge.watch_enabled": {
    type: "boolean",
    default: true,
    label: "Watch folder",
    description: "Auto-ingest .md notes when the watched folder changes on disk.",
  },
  "mindmerge.watch_path": {
    type: "string",
    default: "",
    label: "Notes folder",
    description: "Absolute path to the folder of .md notes to ingest.",
  },
  "mindmerge.auto_reparse": {
    type: "boolean",
    default: true,
    label: "Auto re-parse",
    description: "Re-parse a note when its file changes on disk (off = only new/deleted files act).",
  },
  "mindmerge.rail_collapsed": {
    type: "boolean",
    default: false,
    label: "Collapse list rail",
    description: "Collapse the note list to a thin strip; the detail pane takes the width.",
  },
  "mindmerge.font_size": {
    type: "number",
    default: 13,
    label: "Detail font size",
    description: "Body text size (px) in the note detail pane; headings scale proportionally.",
  },
};

// Standalone-dev / merge default settings. Root replaces this with persisted values at merge time.
export function defaultSettings(): MindMergeSettings {
  return {
    "mindmerge.watch_enabled": CONFIG_MANIFEST["mindmerge.watch_enabled"].default as boolean,
    "mindmerge.watch_path": CONFIG_MANIFEST["mindmerge.watch_path"].default as string,
    "mindmerge.auto_reparse": CONFIG_MANIFEST["mindmerge.auto_reparse"].default as boolean,
    "mindmerge.rail_collapsed": CONFIG_MANIFEST["mindmerge.rail_collapsed"].default as boolean,
    "mindmerge.font_size": CONFIG_MANIFEST["mindmerge.font_size"].default as number,
  };
}
