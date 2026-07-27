// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: THE shared extension registry — Scan's wizard categories AND Migrate's asset classes
//              in ONE file, one shape. Format = { label, extensions[], group }: Scan formats span
//              several extensions ("Canon .cr2 .cr3"); Migrate's are one-extension formats so its
//              per-extension chips are UNCHANGED by the lift. `.xmp` deliberately appears in BOTH
//              registries with different meaning (Scan: sidecar metadata · Migrate: Camera Raw
//              preset) — never dedup across categories. Scan's photos/video/audio chips are the
//              Jason-ruled selectable set; media.ts remains the CLASSIFIER, and each category's
//              "Other formats" chip covers the remaining media.ts extensions so nothing becomes
//              unreachable (ruling 2026-07-26).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/shared/assetRegistry.ts
//------------------------------------------------------------
import { AUDIO_EXTS, STILL_EXTS, VIDEO_EXTS } from "../scan/media";

export interface AssetFormat {
  label: string; // chip label ("Canon", "Brushes", "Other formats")
  extensions: string[]; // lowercase, no dot
  group: string; // results/grouping label (Migrate M2 groups; Scan reporting)
}
export interface AssetCategory {
  key: string;
  label: string;
  icon: string;
  desc: string;
  formats: AssetFormat[];
  folderNames: string[]; // dir-name matches when a folder-names option is on (lowercase)
  destHint: string; // Migrate Phase 2 install hint — stored, unused in Phase 1
  records?: string; // Scan wizard "Also recorded:" line — what metadata this category yields
}

const f = (label: string, extensions: string[], group?: string): AssetFormat => ({ label, extensions, group: group ?? label });

// ---- MIGRATE asset classes — the SAME data the module shipped with, expressed in the shared
// shape (every entry a one-extension format, so Migrate's chips are byte-identical after the lift).
const mediaFormats = (set: ReadonlySet<string>, group: string): AssetFormat[] =>
  [...set].sort().map((e) => ({ label: `.${e}`, extensions: [e], group }));

export const MIGRATE_CLASSES: AssetCategory[] = [
  {
    key: "photos", label: "Photos", icon: "🖼", desc: "Raw, jpeg, tiff, psd",
    formats: mediaFormats(STILL_EXTS, "Photos"),
    folderNames: ["photos", "pictures", "images"], destHint: "",
  },
  {
    key: "video", label: "Video", icon: "🎬", desc: "mov, mp4, mts, braw",
    formats: mediaFormats(VIDEO_EXTS, "Video"),
    folderNames: ["video", "videos", "footage"], destHint: "",
  },
  {
    key: "audio", label: "Audio", icon: "🎵", desc: "wav, mp3, aiff, flac",
    formats: mediaFormats(AUDIO_EXTS, "Audio"),
    folderNames: ["audio", "music", "sound"], destHint: "",
  },
  {
    key: "creative", label: "Creative assets", icon: "🖌",
    desc: "Brushes, actions, styles, gradients, patterns, swatches",
    formats: [
      f("Brushes", ["abr"]), f("Actions", ["atn"]), f("Layer styles", ["asl"]), f("Gradients", ["grd"]),
      f("Patterns", ["pat"]), f("Swatches", ["aco"]), f("Shapes", ["csh"]), f("Colour books", ["acb"]),
      f("Settings files", ["psp"]),
    ],
    folderNames: ["brushes", "actions", "styles", "gradients", "patterns", "swatches"],
    destHint: "%APPDATA%\\Adobe\\Adobe Photoshop <version>\\Presets",
  },
  {
    key: "plugins", label: "Plugins & scripts", icon: "🧩", desc: "Filters, panels, jsx scripts",
    formats: [
      f("Filters", ["8bf"], "Plugins"), f("Plug-ins", ["8bi"], "Plugins"), f("Plug-ins", ["8ba"], "Plugins"),
      f("Plug-ins", ["8be"], "Plugins"), f("Libraries", ["8li"], "Plugins"),
      f("Scripts", ["jsx"], "Scripts"), f("Scripts", ["jsxbin"], "Scripts"),
    ],
    folderNames: ["plug-ins", "plugins", "scripts"],
    destHint: "%ProgramFiles%\\Common Files\\Adobe",
  },
  {
    key: "presets", label: "Presets & profiles", icon: "🎚",
    desc: "Lightroom, Camera Raw, Premiere, colour lookups",
    formats: [
      f("Camera Raw presets", ["xmp"]), f("Lightroom templates", ["lrtemplate"]), f("Camera profiles", ["dcp"]),
      f("LUTs", ["cube"]), f("LUTs", ["3dl"]), f("Premiere presets", ["prfpset"]),
    ],
    folderNames: ["presets", "profiles", "luts"],
    destHint: "%APPDATA%\\Adobe\\CameraRaw",
  },
  {
    key: "fonts", label: "Fonts", icon: "🔤", desc: "TrueType, OpenType",
    formats: [f("TrueType", ["ttf"], "Fonts"), f("OpenType", ["otf"], "Fonts")],
    folderNames: ["fonts"],
    destHint: "%WINDIR%\\Fonts",
  },
  {
    key: "custom", label: "Custom", icon: "⚙", desc: "Type any extensions you want",
    formats: [],
    folderNames: [],
    destHint: "",
  },
];
