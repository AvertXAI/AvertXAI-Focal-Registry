// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: LANE SHIM, NOT PRODUCT CODE. Re-exports the real platform registry so vault/ipc.ts
//              can import `../db/registry` at the same specifier it will use after copy-back.
//              Stays behind on copy; nothing here ships.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/electron/core/services/db/registry.ts
//------------------------------------------------------------
export { getActiveOrg, initRegistry } from "../../../../../../electron/core/services/db/registry";
