// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The developer-tools shortcut, owned by the window instead of by a menu.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/devtools.ts
//------------------------------------------------------------
//
// WHY THIS FILE EXISTS, and it is NOT the reason that was expected.
//
// The expectation was that something called `Menu.setApplicationMenu(null)` and took the default
// accelerators down with it. It did not. Measured across the WHOLE history of this repo:
//
//     git log -S"setApplicationMenu" --all   -> no commits
//     git log -S"before-input-event"  --all  -> no commits
//     git log -S"openDevTools"        --all  -> no commits
//     git log -S"devTools"            --all  -> no commits
//
// NONE OF THOSE STRINGS HAS EVER EXISTED IN THIS TREE. Nothing was removed, because nothing was
// ever there. Ctrl+Shift+I was working on Electron's DEFAULT application menu — the one Electron
// installs by itself when an app never sets one — and that menu is not this codebase's to keep.
// The shortcut was never owned; it was borrowed, from a default that this app does not control,
// on a window that is `titleBarStyle: "hidden"` and so never draws a menu bar to hang it from.
//
// So the fix is not to restore something. It is to OWN it. `before-input-event` fires in the main
// process on raw key input, ahead of both the page and any menu, and it needs no menu to exist —
// which is the property that makes it survive the shell revamp.
import type { BrowserWindow } from "electron";

/**
 * Open developer tools, or close them if they are already open.
 *
 * THE SINGLE DEFINITION OF WHAT THE SHORTCUT DOES. When the shell revamp adds a View menu, its
 * item calls THIS — see the warning on `attachDevToolsShortcut` about not giving that item an
 * accelerator.
 *
 * No `mode` is passed on purpose: Electron reuses whichever dock the user last chose, so this
 * reopens the tools exactly where they were rather than relocating them on Jason's behalf.
 */
export function toggleDevTools(win: BrowserWindow): void {
  const wc = win.webContents;
  if (wc.isDevToolsOpened()) wc.closeDevTools();
  else wc.openDevTools();
}

/**
 * Bind Ctrl+Shift+I and F12 on a window, without depending on a menu.
 *
 * NOT GATED ON `DIAG`, NODE_ENV, OR `app.isPackaged` — Jason ruled on 08-18-2026 that it stays
 * available. A diagnostic that needs a second command remembered before it can be reached is a
 * diagnostic nobody reaches at the moment they need it.
 *
 * TWO BINDINGS. Ctrl+Shift+I is what Electron's default menu used; F12 is the muscle memory half
 * the world has, and it costs one comparison.
 *
 * ---------------------------------------------------------------------------------------------
 * WHEN THE VIEW MENU ARRIVES, DO NOT GIVE ITS ITEM AN ACCELERATOR.
 *
 * `event.preventDefault()` below stops the keystroke reaching the PAGE. It does NOT stop a menu
 * accelerator, which Windows dispatches through the menu itself — so a View item carrying
 * `accelerator: "Ctrl+Shift+I"` alongside this handler would fire twice on one keypress, which
 * toggles the tools open and straight back shut and reads as "the shortcut is broken again".
 *
 * The rule that avoids it: the menu item calls `toggleDevTools` and declares NO accelerator. This
 * handler stays the one and only thing that turns a keystroke into a toggle, and the menu is one
 * more way to ask for the same toggle.
 */
export function attachDevToolsShortcut(win: BrowserWindow): void {
  win.webContents.on("before-input-event", (event, input) => {
    // keyUp fires for the same chord; acting on both would toggle twice per press.
    if (input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    // `input.key` is already the resolved character, so Shift+i arrives as "I" — lowercased here so
    // the comparison does not depend on which of those two the platform reports.
    const wanted = key === "f12" || (input.control && input.shift && key === "i");
    if (!wanted) return;
    event.preventDefault();
    toggleDevTools(win);
  });
}
