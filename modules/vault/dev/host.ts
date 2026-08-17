// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: DEV HOST — a tiny Electron main process that opens ONE window showing the Vault
//              module, so the interface can be looked at before it is mounted in the real shell.
//              It runs the REAL services and the REAL vault IPC file, so what you see is what the
//              app will do — but against a THROWAWAY userData folder inside this lane, never the
//              real one. Delete `dev/.userdata` and it starts over from nothing.
//              This file never ships and is not part of the module; it stays behind on copy-back.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/dev/host.ts
//------------------------------------------------------------
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { addOrg, getActiveOrg, initRegistry } from "../electron/core/services/db/registry";
import { initDb, closeAllDbs } from "../electron/core/services/db";
import { registerVaultIpc } from "../electron/core/services/vault/ipc";

// A fixed org id, so the same throwaway database is reused between runs and the seed survives.
const DEV_ORG = "01990000-0000-7000-8000-00000000dev1";

app.whenReady().then(() => {
  // THROWAWAY userData inside the lane — the real %APPDATA%\Focal Registry is never touched.
  const dataDir = path.join(__dirname, ".userdata");
  // Electron creates its OWN userData folder but not one it is pointed at — make it, or the very
  // first database open fails with "the directory does not exist".
  fs.mkdirSync(dataDir, { recursive: true });
  app.setPath("userData", dataDir);

  initRegistry();
  if (!getActiveOrg()) {
    // The shared org database has to exist because the platform registry routes on it; the vault's
    // own encrypted file is created lazily by the module's own context, exactly as in the app.
    initDb(path.join(dataDir, `focalregistry_${DEV_ORG}.db`));
    addOrg(DEV_ORG, "focalregistry", "Vault Dev");
  }
  registerVaultIpc();

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: "#0d1320",
    title: "Secured Vault — dev host",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // the preload needs require(); this host is a developer tool, not the product
    },
  });
  void win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.on("did-finish-load", () => win.show());
});

// Checkpoint and close every connection BEFORE the process goes, so the WAL sidecar is folded into
// the database file and what is on disk after quit is the complete story (Jason 08-12-2026).
app.on("will-quit", () => closeAllDbs());
app.on("window-all-closed", () => app.quit());
