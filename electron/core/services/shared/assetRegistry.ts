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

// ---- SCAN wizard categories (mockup "cards tight" tab B, 2026-07-26) — every media.ts extension
// is a NAMED format (the "Other formats" mystery bucket is deleted); `group` is the panel column.
export const SCAN_CATEGORIES: AssetCategory[] = [
  {
    key: "photos", label: "Photos", icon: "🖼", desc: "Camera raw, jpeg, tiff, png, heic, layered",
    records: "Camera, lens, dimensions, capture date, orientation",
    formats: [
      f("Canon", ["cr2", "cr3"], "Camera raw"), f("Nikon", ["nef", "nrw"], "Camera raw"),
      f("Sony", ["arw"], "Camera raw"), f("Fujifilm", ["raf"], "Camera raw"),
      f("Olympus", ["orf"], "Camera raw"), f("Panasonic", ["rw2"], "Camera raw"),
      f("Pentax", ["pef"], "Camera raw"), f("Adobe raw", ["dng"], "Camera raw"),
      f("Jpeg", ["jpg", "jpeg"], "Everyday"), f("Tiff", ["tif", "tiff"], "Everyday"),
      f("Png", ["png"], "Everyday"), f("Apple", ["heic", "heif"], "Everyday"),
      f("Layered", ["psd", "psb"], "Everyday"), f("Web", ["webp", "avif", "jxl"], "Everyday"),
      f("Bitmap", ["bmp"], "Everyday"), f("Animated", ["gif"], "Everyday"),
      f("Canon, older", ["crw"], "Legacy and medium format raw"),
      f("Sony, older", ["srf", "sr2"], "Legacy and medium format raw"),
      f("Samsung", ["srw"], "Legacy and medium format raw"),
      f("Hasselblad", ["3fr"], "Legacy and medium format raw"),
      f("Leica", ["rwl"], "Legacy and medium format raw"),
    ],
    folderNames: ["photos", "pictures", "images"], destHint: "",
  },
  {
    key: "video", label: "Video", icon: "🎬", desc: "Camera and camcorder video, broadcast, editing formats",
    records: "Video and audio codec, duration, bitrate, metadata date",
    formats: [
      f("QuickTime", ["mov"], "Camera and camcorder"), f("Mpeg-4", ["mp4", "m4v"], "Camera and camcorder"),
      f("Camcorder", ["mts", "m2ts", "m2t"], "Camera and camcorder"), f("Mobile", ["3gp"], "Camera and camcorder"),
      f("Insta360", ["insv"], "Camera and camcorder"),
      f("Broadcast", ["mxf"], "Professional"), f("Blackmagic raw", ["braw"], "Professional"),
      f("Red raw", ["r3d"], "Professional"),
      f("Avi", ["avi"], "Everyday"), f("Matroska", ["mkv"], "Everyday"),
      f("Windows media", ["wmv"], "Everyday"), f("Web video", ["webm"], "Everyday"),
      f("Mpeg-1 and 2", ["mpg", "mpeg", "mpe"], "Everyday"),
    ],
    folderNames: ["video", "videos", "footage"], destHint: "",
  },
  {
    key: "audio", label: "Audio", icon: "🎵", desc: "Recorder audio, compressed and uncompressed",
    records: "Duration, bitrate, sample rate",
    formats: [
      f("Wave", ["wav"], "Uncompressed"), f("Aiff", ["aif", "aiff"], "Uncompressed"),
      f("Core audio", ["caf"], "Uncompressed"),
      f("Mp3", ["mp3"], "Compressed"), f("Flac", ["flac"], "Compressed"), f("Apple", ["m4a"], "Compressed"),
      f("Aac", ["aac"], "Compressed"), f("Ogg", ["ogg"], "Compressed"), f("Opus", ["opus"], "Compressed"),
      f("Windows media", ["wma"], "Compressed"), f("Audiobook", ["m4b"], "Compressed"),
    ],
    folderNames: ["audio", "music", "sound"], destHint: "",
  },
  {
    key: "documents", label: "Documents", icon: "📄", desc: "Contracts, invoices, spreadsheets, notes, sidecars",
    records: "File size and dates only — documents are never opened or parsed",
    formats: [
      // No groups — one flat chip set (group mirrors the label; the panel renders documents flat).
      f("Portable document", ["pdf"]), f("Word", ["doc", "docx"]), f("Excel", ["xls", "xlsx", "csv"]),
      f("Plain text", ["txt"]), f("Rich text", ["rtf"]), f("Markdown", ["md"]),
      f("Sidecar metadata", ["xmp"]), // recorded kind stays 'sidecar' (ruling) — NOT 'document'
      f("Presentation", ["ppt", "pptx"]), f("OpenDocument", ["odt", "ods"]), f("Email", ["eml", "msg"]),
    ],
    folderNames: ["documents", "docs", "contracts", "invoices"], destHint: "",
  },
];

/** The Scan DEFAULT media set — Photos + Video + Audio, every format (Documents opt-in). A default
 *  run's extension set EQUALS the pre-wizard always-everything media behaviour, so default reports
 *  stay comparable run to run. */
export function defaultMediaExtensions(): string[] {
  return SCAN_CATEGORIES.filter((c) => c.key !== "documents").flatMap((c) => c.formats.flatMap((x) => x.extensions));
}

/** ext → Scan run kind for SELECTIVE runs — registry-category-driven, because the chips are the
 *  selectable truth (e.g. .aif is a chip but not in AUDIO_EXTS; the category still classes it). */
export function scanKindForExtension(ext: string): "image" | "video" | "audio" | "document" | "sidecar" | null {
  const e = ext.toLowerCase();
  if (e === "xmp") return "sidecar"; // ruling: .xmp keeps its existing kind
  for (const cat of SCAN_CATEGORIES) {
    for (const fmt of cat.formats) {
      if (fmt.extensions.includes(e)) {
        return cat.key === "photos" ? "image" : cat.key === "video" ? "video" : cat.key === "audio" ? "audio" : "document";
      }
    }
  }
  return null;
}

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
