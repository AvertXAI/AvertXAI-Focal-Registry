# Focal Registry — Revisions

Newest first. The **Summary** block (400 characters max) is what the in-app Software Update window
shows; the **Details** sections are for the website changelog. `scripts/release.mjs` parses this file,
injects the current version's Summary into the update feed, and publishes this file to the feed root.

## 0.2.9 — August 20, 2026

**Summary:** Sample data is now a developer tool only. Until now the vault's settings offered a button that loaded forty-six made-up logins with deliberately weak passwords straight into your vault. It is hidden, and refused outright unless developer mode is on. If you already loaded it, Purge is still there and still removes exactly what it added.

### Details

#### Fixed

- The Seed data card in the vault's settings was visible to everyone. It loads a sample workbook of forty-six invented logins, chosen to have poor passwords so the health check has something to report — useful while building the app, and something no one else should be able to put into a real vault by accident. It now appears only in developer mode, and the app refuses the request outright if it arrives any other way.
- Purging is deliberately left alone. If a previous version put sample data in your vault, the Purge button is still there and still removes exactly what was loaded and nothing you created yourself.

## 0.2.8 — August 20, 2026

**Summary:** Your saved accounts now show the real company logo instead of coloured initials — more than a thousand of them, from banks and airlines to camera shops and photo labs. Open an entry and the company's name mark sits across the top. It all ships inside the app, so nothing is fetched while you browse and no one learns which companies you hold accounts with.

### Details

#### Added

- Real company logos on your saved accounts. Over a thousand marks are included, covering banks, airlines, insurers, retailers, camera shops, photo labs and the software you sign in to — not just the well-known technology names.
- Opening an entry shows that company's full name mark across the top of the detail panel, where there is room for it to be read.

#### Changed

- An account with no logo still shows its coloured initials, exactly as before. A missing logo is only ever cosmetic.

#### Notes

- The artwork is installed with the app. Nothing is looked up while you browse, so opening the vault cannot tell anyone — us included — which companies you keep accounts with.
- New logos can arrive later without waiting for an app update. The app asks our server once at startup whether a newer set exists; that request is identical for everyone and says nothing about your vault.

## 0.2.7 — August 19, 2026

**Summary:** New Scan Notes: keep notes and the scan report with each folder, and rename folders from inside the app with their old names kept on record. Browse a folder's photos, video and audio as thumbnails and open them in a built-in viewer and player. Search folder names old and new, your notes and your reports. Recent Work shows where you left off.

### Details

#### Added

- Scan Notes: every folder you have scanned keeps its own notes and its own scan report, side by side. Write as much or as little as you like; nothing is ever written into the folder itself.
- Rename a folder from inside the app. Every name it has ever had is kept on record, so a shoot renamed twice can still be found under the name you gave it first.
- Browse a folder's media as a wall of thumbnails — photographs, video and audio together. A RAW shows the preview your camera put inside it; the RAW itself is never altered.
- Show RAW files is a switch: leave it off and you see one tile per photograph instead of two.
- A built-in viewer for stills, and a player for video and audio, without leaving the app.
- Search across folder names old and new, your notes and your reports, from the box at the top.
- Recent Work shows the folders you were last in, so you can pick up where you left off.

#### Changed

- Folders holding no media are kept out of the tree, so what you see is what you can open. A line tells you how many were hidden.
- Clicking a folder opens its report first. Media is one button away and stays one button away.
- Thumbnails are kept on this computer only, in a hidden folder under Documents, and are cleaned up automatically once they pass 500 MB. Nothing is ever written onto the drive being browsed.

## 0.2.6 — July 31, 2026

**Summary:** New TimeTracker module — track hours per project, watch what you have earned as the clock runs, and see it all in charts you can export. A floating timer window stays on top while you work, and break reminders tell you when to step away. The sidebar is now grouped by what each module does.

### Details

#### Added

- TimeTracker: a full per-project time tracker — projects grouped into folders, live timers with a running dollar figure at your hourly rate, pause and resume, and session notes.
- TimeTracker: Logbook, Activity and Archive views, plus Adjustments for correcting hours you forgot to log without ever altering a saved session.
- TimeTracker: Analytics with hours over time, value against costs, hours by project and costs by category — exportable to PDF straight to your Downloads folder.
- TimeTracker: a value ledger that never overwrites a previous amount, cost line items, and a grand total across every project.
- A floating mini timer window that stays above other applications, with per-timer pause and stop.
- Break reminders with a choice of seventeen alert sounds, plus idle detection that asks before discarding time you did not work.
- Marketplace: a placeholder for modules you will be able to add later.

#### Changed

- The sidebar is grouped: Archive Media holds Scan, Rename and Migrate; Applications holds TimeTracker; Tools holds MindMerge and Scout Viewer. Secured Vault and Marketplace sit on their own.
- Secure Vault is now shown as "Secured Vault".

#### Fixed

- Settings now reopens on the section you were last using.
- Alert sounds play correctly.
- Buttons in the light theme are legible against their background.

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
