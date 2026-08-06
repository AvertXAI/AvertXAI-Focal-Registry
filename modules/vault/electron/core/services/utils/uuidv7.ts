// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: LANE SHIM, NOT PRODUCT CODE. Re-exports the real uuid v7 generator so the vault
//              services can import `../utils/uuidv7` at the same specifier they will use after
//              copy-back. Stays behind on copy; nothing here ships.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/electron/core/services/utils/uuidv7.ts
//------------------------------------------------------------
export { generateUUIDv7 } from "../../../../../../electron/core/services/utils/uuidv7";
