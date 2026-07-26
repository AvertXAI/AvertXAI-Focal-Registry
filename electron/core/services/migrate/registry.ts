// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Migrate's registry VIEW over the SHARED extension registry (shared/assetRegistry.ts —
//              one file both Scan and Migrate consume; Phase B1 lift). This adapter flattens the
//              shared per-format shape back into Migrate's per-extension defs, so the module's IPC
//              payload, chips, groups, and engine maps are BYTE-IDENTICAL to before the lift
//              (proven against a pre-lift JSON snapshot). bundleSubfolder stays Migrate-only.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/migrate/registry.ts
//------------------------------------------------------------
import { MIGRATE_CLASSES } from "../shared/assetRegistry";

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

// Flatten shared formats → per-extension defs. Every Migrate format is single-extension by
// construction, so this is a 1:1 mapping — same labels, same order, same groups.
export const ASSET_CLASSES: MigrateClassDef[] = MIGRATE_CLASSES.map((c) => ({
  key: c.key,
  label: c.label,
  icon: c.icon,
  desc: c.desc,
  extensions: c.formats.flatMap((fmt) => fmt.extensions.map((ext) => ({ ext, label: fmt.label, group: fmt.group }))),
  folderNames: c.folderNames,
  destHint: c.destHint,
}));

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
