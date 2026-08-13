// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: LANE SHIM, NOT PRODUCT CODE. The vault services import `../db` exactly as they will
//              once copied into electron/core/services/vault/ — this file makes that specifier
//              resolve while they live in the lane, by re-exporting the REAL root data layer.
//              It stays behind on copy-back; nothing here ships.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/electron/core/services/db/index.ts
//------------------------------------------------------------
export { closeAllDbs, compactDb, createTable, getDb, initDb, openDb } from "../../../../../../electron/core/services/db";
