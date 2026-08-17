// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: LANE SHIM, NOT PRODUCT CODE. ipc.ts imports `../dataviewer` for the main-side
//              developer-mode gate on the lock-screen reveal — this file makes that specifier
//              resolve while it lives in the lane, by re-exporting the REAL root service. It stays
//              behind on copy-back; nothing here ships.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/electron/core/services/dataviewer/index.ts
//------------------------------------------------------------
export { getDevMode } from "../../../../../../electron/core/services/dataviewer";
