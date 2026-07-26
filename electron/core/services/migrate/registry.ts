// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The Migrate asset-class REGISTRY — data, not hardcode. Every class carries its
//              display copy, extension definitions (with per-extension group labels for the M2
//              results grouping), folder-name hints (matched when the folder-names option is on),
//              and a destination hint (STORED for Phase 2 install — unused in Phase 1). The renderer
//              fetches this over IPC (migrate:registry); the job stores the user's SELECTED subset —
//              nothing is hardcoded at scan time. Photos/Video/Audio reuse the ONE media source of
//              truth (scan/media.ts) rather than duplicating extension lists.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/migrate/registry.ts
//------------------------------------------------------------
import { AUDIO_EXTS, STILL_EXTS, VIDEO_EXTS } from "../scan/media";

export interface MigrateExtDef {
  ext: string; // lowercase, no dot
  label: string; // chip label ("Brushes")
  group: string; // M2 results group ("Brushes", "Plugins", "Scripts", "Fonts", "Settings files")
}
export interface MigrateClassDef {
  key: string;
  label: string;
  icon: string; // pictogram for the M1 category card
  desc: string; // card subtitle
  extensions: MigrateExtDef[];
  folderNames: string[]; // dir-name matches when the folder-names option is on (lowercase)
  destHint: string; // Phase 2 install hint — stored on the registry now, unused in Phase 1
}

const media = (set: ReadonlySet<string>, group: string): MigrateExtDef[] =>
  [...set].sort().map((e) => ({ ext: e, label: `.${e}`, group }));

export const ASSET_CLASSES: MigrateClassDef[] = [
  {
    key: "photos", label: "Photos", icon: "🖼", desc: "Raw, jpeg, tiff, psd",
    extensions: media(STILL_EXTS, "Photos"),
    folderNames: ["photos", "pictures", "images"], destHint: "",
  },
  {
    key: "video", label: "Video", icon: "🎬", desc: "mov, mp4, mts, braw",
    extensions: media(VIDEO_EXTS, "Video"),
    folderNames: ["video", "videos", "footage"], destHint: "",
  },
  {
    key: "audio", label: "Audio", icon: "🎵", desc: "wav, mp3, aiff, flac",
    extensions: media(AUDIO_EXTS, "Audio"),
    folderNames: ["audio", "music", "sound"], destHint: "",
  },
  {
    key: "creative", label: "Creative assets", icon: "🖌",
    desc: "Brushes, actions, styles, gradients, patterns, swatches",
    extensions: [
      { ext: "abr", label: "Brushes", group: "Brushes" },
      { ext: "atn", label: "Actions", group: "Actions" },
      { ext: "asl", label: "Layer styles", group: "Layer styles" },
      { ext: "grd", label: "Gradients", group: "Gradients" },
      { ext: "pat", label: "Patterns", group: "Patterns" },
      { ext: "aco", label: "Swatches", group: "Swatches" },
      { ext: "csh", label: "Shapes", group: "Shapes" },
      { ext: "acb", label: "Colour books", group: "Colour books" },
      { ext: "psp", label: "Settings files", group: "Settings files" },
    ],
    folderNames: ["brushes", "actions", "styles", "gradients", "patterns", "swatches"],
    destHint: "%APPDATA%\\Adobe\\Adobe Photoshop <version>\\Presets",
  },
  {
    key: "plugins", label: "Plugins & scripts", icon: "🧩", desc: "Filters, panels, jsx scripts",
    extensions: [
      { ext: "8bf", label: "Filters", group: "Plugins" },
      { ext: "8bi", label: "Plug-ins", group: "Plugins" },
      { ext: "8ba", label: "Plug-ins", group: "Plugins" },
      { ext: "8be", label: "Plug-ins", group: "Plugins" },
      { ext: "8li", label: "Libraries", group: "Plugins" },
      { ext: "jsx", label: "Scripts", group: "Scripts" },
      { ext: "jsxbin", label: "Scripts", group: "Scripts" },
    ],
    folderNames: ["plug-ins", "plugins", "scripts"],
    destHint: "%ProgramFiles%\\Common Files\\Adobe",
  },
  {
    key: "presets", label: "Presets & profiles", icon: "🎚",
    desc: "Lightroom, Camera Raw, Premiere, colour lookups",
    extensions: [
      { ext: "xmp", label: "Camera Raw presets", group: "Camera Raw presets" },
      { ext: "lrtemplate", label: "Lightroom templates", group: "Lightroom templates" },
      { ext: "dcp", label: "Camera profiles", group: "Camera profiles" },
      { ext: "cube", label: "LUTs", group: "LUTs" },
      { ext: "3dl", label: "LUTs", group: "LUTs" },
      { ext: "prfpset", label: "Premiere presets", group: "Premiere presets" },
    ],
    folderNames: ["presets", "profiles", "luts"],
    destHint: "%APPDATA%\\Adobe\\CameraRaw",
  },
  {
    key: "fonts", label: "Fonts", icon: "🔤", desc: "TrueType, OpenType",
    extensions: [
      { ext: "ttf", label: "TrueType", group: "Fonts" },
      { ext: "otf", label: "OpenType", group: "Fonts" },
    ],
    folderNames: ["fonts"],
    destHint: "%WINDIR%\\Fonts",
  },
  {
    key: "custom", label: "Custom", icon: "⚙", desc: "Type any extensions you want",
    extensions: [],
    folderNames: [],
    destHint: "",
  },
];

/** Bundle subfolder per item — mockup: .psp settings files land in settings\, classes get their own. */
export function bundleSubfolder(assetClass: string, ext: string | null): string {
  if (ext === "psp") return "settings";
  switch (assetClass) {
    case "creative": return "creative-assets";
    case "plugins": return "plugins";
    case "presets": return "presets";
    case "fonts": return "fonts";
    case "photos": return "photos";
    case "video": return "video";
    case "audio": return "audio";
    default: return "other";
  }
}
