// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Module registry service — reads the org DB's `modules` table (seeded by the
//              First-Run wizard); rows drive the renderer's nav and view routing.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/modules/index.ts
//------------------------------------------------------------
import { getDb } from "../db";
import type { ModuleRow } from "../../../../src/shared/types";

export function listModules(): ModuleRow[] {
  // SELECT * carries the additive nav_group column (grouped-nav sections) with no query change.
  return getDb().prepare("SELECT * FROM modules ORDER BY display_order ASC").all() as ModuleRow[];
}
