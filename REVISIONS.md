# Focal Registry — Revisions

Newest first. The **Summary** block (400 characters max) is what the in-app Software Update window
shows; the **Details** sections are for the website changelog. `scripts/release.mjs` parses this file,
injects the current version's Summary into the update feed, and publishes this file to the feed root.

## 0.2.5 — July 26, 2026

**Summary:** New Migrate module — find brushes, presets, plugins, scripts and fonts scattered across a drive and copy them onto another, verified file by file. Helpful tips can now be switched off in Settings, and Settings shows this computer's identifiers.

### Details

#### Added

- Migrate: choose what to look for, scan a whole drive or specific folders, review what was found grouped by type, and copy a selection into a dated bundle on another drive — every file checksum-verified, originals never moved or changed.
- Migrate identifies removable drives and shows free space before copying, refusing to start if there is not enough room or if the destination sits inside the source.
- Settings: a single switch turns helpful tips on or off across the whole application.
- Settings: "This device" shows the machine name and its identifiers, recorded locally and never transmitted.

#### Changed

- Nothing changes in Scan, Rename, MindMerge or Scout Viewer.

## 0.2.4 — July 26, 2026

**Summary:** Updates now open in a dedicated Software Update window instead of a corner notification — release notes shown in-app, with a link to the full changelog. Major-version updates are marked required, and versions that are no longer maintained show a notice.

### Details

#### Added

- A dedicated Software Update window: version-to-version pills, in-app release notes with a "Show full details" panel, download progress with percent and megabytes, and Skip this version / Remind me later / Install update actions.
- Release notes travel with every update — the update feed now carries each version's summary, and the full changelog is one click away at focalregistry.com/releases.
- Required-update handling: a new major version must be installed to continue — the window offers only Install now or Quit.
- An unmaintained-version notice when the installed version has fallen well behind the current release.

#### Changed

- The old corner update notification is retired; the small toast now only answers the Settings "Check for updates" button (checking, up to date, or connection trouble).
- Updates remain consent-first: nothing downloads until Install is clicked, and installation happens on restart.

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
