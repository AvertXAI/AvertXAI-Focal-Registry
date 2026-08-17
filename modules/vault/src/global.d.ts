/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// LANE-ONLY ambient — stays behind on copy-back, like the db/utils shims. The shell types
// window.api in its own src/global.d.ts as the full Api; this lane compiles without that file,
// so when the 08-14 reshape deleted vaultApi.ts's old declare-global (two Window augmentations
// of `api` will not merge once mounted), the lane lost window.api entirely and tsc went red.
// This declares ONLY the members the module touches, with shapes matching src/shared/types.ts
// (vault: VaultApi; dataviewer.getDevMode at types.ts:1147). The root tsconfig never includes
// this file, so the two augmentations never meet in one program.
import type { VaultApi } from "./modules/vault/vaultApi";

declare global {
  interface Window {
    api: {
      vault: VaultApi;
      /** Absent in the lane dev host — VaultModule optional-chains it for the dev-mode probe. */
      dataviewer?: { getDevMode: () => Promise<boolean> };
    };
  }
}

export {};
