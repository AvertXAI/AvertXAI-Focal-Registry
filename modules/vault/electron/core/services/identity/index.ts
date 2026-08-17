// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: LANE SHIM, NOT PRODUCT CODE. lock.ts imports `../identity` exactly as it will once
//              copied into electron/core/services/vault/ — this file makes that specifier resolve
//              while it lives in the lane, by re-exporting the REAL root identity service (the ONE
//              reader of MachineGuid + SMBIOS). It stays behind on copy-back; nothing here ships.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/electron/core/services/identity/index.ts
//------------------------------------------------------------
export { readDeviceIdentity } from "../../../../../../electron/core/services/identity";
export type { DeviceIdentity } from "../../../../../../electron/core/services/identity";
