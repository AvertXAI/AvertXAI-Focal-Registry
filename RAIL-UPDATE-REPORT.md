# RAIL-UPDATE-REPORT — Persistent left rail (2026-07-03)

## Recon correction (important)
- The described collapse machinery **did not exist**: no `«` chevron, no collapsed/40px-strip or hover-peek states, no `rail_collapsed` key in `app_settings`, IPC, or the settings whitelist. Grep across `src/` + `electron/` matched only CSS `border-collapse`.
- The actual pre-existing nav was the *opposite* of the goal: a hidden overlay drawer (translateX off-screen, scrim, hamburger toggle, Escape-to-close) — i.e. menu-diving. Execution therefore converted the drawer into the persistent rail the task's goal describes.

## Changes
- `src/components/Flyout.tsx`: now a persistent `<aside>` — scrim click-away layer and `onClose` prop deleted; nav content (Home / Config-as-Data module rows / Settings) unchanged.
- `src/App.tsx`: deleted `navOpen` state, the `body.nav-open` class effect, the Escape-key close effect, and `setNavOpen` in `select()`; `onNavToggle`/`onClose` props no longer passed.
- `src/components/TopBar.tsx`: hamburger button and `onNavToggle` prop deleted (nothing to toggle); redundant brandmark removed — the rail head owns the brand now.
- `src/globals.css`: `.flyout` locked to a strictly persistent fixed rail — `width:300px` (the app's defined rail width), no `transform`/`transition`/`max-width`/drawer border-radius; deleted `.scrim` and both `body.nav-open` rules and the drawer's reduced-motion query; added `body{padding-left:300px}` so top bar, views, and Safe Mode banner clear the rail. Full-screen overlays (wizard, boot terminal) are `position:fixed` and correctly ignore the body padding.

## Verification
- `npm run build`: clean. `npx tsc --noEmit`: exit 0 — no dangling state or props.
- Launch test (10s, real app): alive until timeout kill, no renderer errors.
- Eyeball checklist for Jason: rail always visible at 300px; no hamburger in the top bar; module clicks route; Data Viewer's own 240px table rail sits inside the content area next to the app rail.
