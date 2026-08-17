// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: LANE SHIM, NOT PRODUCT CODE. The root project gets `import "./x.css"` from Vite's
//              own ambient types; this lane compiles standing alone, so it declares the same thing
//              for itself. Stays behind on copy-back.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/src/vite-env.d.ts
//------------------------------------------------------------
declare module "*.css";
