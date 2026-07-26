# Focal Registry — Revisions

Newest first. The **Summary** block (400 characters max) is what the in-app Software Update window
shows; the **Details** sections are for the website changelog. `scripts/release.mjs` parses this file,
injects the current version's Summary into the update feed, and publishes this file to the feed root.

## 0.2.4 — July 26, 2026

**Summary:** Placeholder — replace before releasing 0.2.4.

### Details

#### Added

- Placeholder.

#### Changed

- Placeholder.

#### Fixed

- Placeholder.

## 0.2.3 — July 25, 2026

**Summary:** Secure Note is now MindMerge. The app is now simply "Focal Registry" everywhere — window, tray, installer. Settings toggles no longer jump after a refresh, and module names sit indented under Applications in the sidebar.

### Details

#### Added

- Sidebar: module names are indented beneath the Applications header so the group reads as parent and children.

#### Changed

- The Secure Note module is renamed MindMerge end to end: navigation, module slug, service, database, and settings keys (existing settings migrate automatically).
- Product identity is now "Focal Registry": window title, taskbar name, tray tooltip (with "Photography Archive Tools" as the second line), installer artifact names, and the first-run welcome screen.
- The internal shell bridge was renamed from the legacy RunBooks name; boot behavior is unchanged.

#### Fixed

- Settings toggles rendered in their default position and visibly flipped after a refresh (Ctrl+R); the toggle state is now warmed at boot and paints correctly on the first frame.

#### Removed

- The legacy RunBooks-era database migration and its last remnants — no existing install carries data that needs it.
