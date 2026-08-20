// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Scout Viewer — Fortified Browser engine, IN-SHELL edition (ported from the
//              feature/scout-viewer standalone prototype's main.js). ONE hardened guest
//              WebContentsView layered over the Scout module's content hole inside the MAIN shell
//              window (no second BaseWindow). Canon enforced verbatim from the prototype:
//              sandboxed guest (no preload, zero bridge) · persist:client_<id> partitions ·
//              http(s)-only navigation · popups denied but kept in-session · bounds clamped ·
//              snapshot tab-swap (instant visual restore) · isolated-world DOM read (Vessel
//              pattern, zero scraper libs). IPC lives in core/ipc.ts (sender-verified there);
//              this service validates every payload again before touching an engine API.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scout-viewer/index.ts
//------------------------------------------------------------
import { app, WebContentsView, type WebContents } from "electron";
import { getMainWindow } from "../../windows";
import { getTabState, saveTabState, saveTabUrl } from "./tab-state";

// Google for now (Jason 08-05-2026) — a deliberate placeholder until a real default is ruled.
// The renderer keeps its own HOME_URL constant for the Home button; the two are the same value.
const START_URL = "https://www.google.com";
const DEFAULT_CLIENT = "halo";
// Present as stock Chrome — the default Electron UA trips SaaS bot/compat firewalls (HaloPSA, Pylon,
// etc.). Compatibility spoof for an authorized first-party tool, not evasion.
//
// DERIVED FROM THE ENGINE, NOT HARDCODED (08-20-2026). The major used to be a literal with a comment
// telling whoever read it to "bump the Chrome major occasionally" — and it had rotted from 126 to
// twenty majors behind the Chromium this Electron actually ships. Two separate signals came out of
// that, and the second is the one that actually matters:
//
//   1. "Suspiciously old browser". A UA twenty versions stale is itself a risk marker.
//   2. THE CONTRADICTION. setUserAgent() rewrites the User-Agent header and nothing else. Chromium
//      still derives the Sec-CH-UA / Sec-CH-UA-Platform client hints — and navigator.userAgentData —
//      from its REAL brand and version. So the request said Chrome/126 in one header and Chrome/146
//      in the next one down. A stale UA is a weak signal; a UA that disagrees with its own client
//      hints is a much stronger one, because no real browser can produce it.
//
// Reading the major off process.versions.chrome makes the two agree by construction and means this
// can never rot again. `.0.0.0` matches Chrome's own reduced-UA format — real Chrome freezes the
// last three components exactly like this, so the shape is right as well as the number.
const CHROME_UA =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${process.versions.chrome.split(".")[0]}.0.0.0 Safari/537.36`;
const DOM_READ_WORLD = 1013; // isolated world id — never 0 (that's the page's main world)
const SWAP_PAINT_DELAY_MS = 50; // one-two frames: let the shell paint the snapshot before the swap
const SWAP_REVEAL_TIMEOUT_MS = 10000; // hard cap — the overlay must never wedge on a dead site

let guestView: WebContentsView | null = null;
// Which client session the live guest belongs to — keys the tab-state row on save-away/quit.
let activeClientId = DEFAULT_CLIENT;
let swapping = false;
// Visibility is COMPUTED: the guest shows only while the Scout module is the active view AND no
// shell modal is open (the native view would occlude it) — the module drives both flags over IPC.
let moduleVisible = false;
let modalOpen = false;
/**
 * SHELL chrome is over the module — the peeking nav panel, or the Settings modal.
 *
 * A SECOND flag rather than reusing modalOpen, because the two have different owners: modalOpen is
 * the Scout module's own sessions/vault/gate dialogs, shellOverlay is App.tsx. One flag shared by
 * two writers is a latch bug waiting to happen — closing a module modal would clear the shell's
 * state and raise the guest straight through a peeking panel.
 *
 * WHY IT IS NEEDED AT ALL: the guest is a native WebContentsView and paints above ALL web content,
 * so nothing in the renderer can be z-indexed over it. Docking the panel is fine — that reflows the
 * layout, the module's ResizeObserver reports new bounds and the guest moves out of the way — but a
 * PEEKING panel floats and reflows nothing, so the guest sat on top of it and clipped it.
 */
let shellOverlay = false;
// Estimate only; the module's ResizeObserver corrects it on first layout (ScoutViewerModule).
let lastBounds = { x: 359, y: 165, width: 800, height: 600 };

// --- validators — every payload passes these BEFORE it touches an engine API ---------------------

function isHttpUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:"; // file:, javascript:, etc. all drop
  } catch {
    return false;
  }
}

// URL-bar convenience: a bare host ("app.halopsa.com") gets https:// prepended so a forgotten
// scheme navigates instead of silently dropping. An EXPLICIT non-http(s) scheme is still rejected
// (we only prepend when no scheme is present), so file:/javascript: can't sneak through.
// Exported: the targets CRUD (./targets.ts) validates stored URLs through this same gate.
export function normalizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return isHttpUrl(candidate) ? new URL(candidate).toString() : null;
}

/**
 * WHAT THE URL BAR DOES WITH SOMETHING THAT IS NOT A URL (Jason 08-20-2026: "im not able to search
 * the web"). Until now: nothing, silently. normalizeHttpUrl prepends https:// to anything without a
 * scheme, so "focal registry photography" became "https://focal registry photography", new URL()
 * threw on the spaces, navigate() got null and dropped it without a word. A single word was worse —
 * "cats" became the perfectly VALID https://cats/ and died on DNS instead.
 *
 * This is the omnibox rule, cut to its bones: an explicit scheme is a URL and must be http(s); a
 * whitespace-free string whose head has a dot (or is localhost) is a host; everything else is a
 * search. Deliberately NOT reusing normalizeHttpUrl — that one still gates the saved-targets CRUD,
 * where a typo silently becoming a web search would be a worse failure than a rejection.
 *
 * DUCKDUCKGO, NOT GOOGLE, and that is on purpose: Google is the engine that challenged this viewer
 * with "verify you are a human" in the first place, so defaulting searches there would walk
 * straight back into the CAPTCHA. Change the constant if you want a different engine.
 */
const SEARCH_URL = "https://duckduckgo.com/?q=";

export function resolveNavTarget(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  // Explicit scheme → it is a URL claim, so hold it to http(s). file:/javascript: still die here
  // rather than being quietly re-read as a search phrase.
  //
  // THE `(?!\d)` IS LOAD-BEARING: without it "localhost:5173" reads as scheme "localhost:", fails
  // the http(s) test and gets dropped — as does any bare host:port. No real scheme is followed by a
  // digit, so refusing that shape sends host:port down to the host branch below where it belongs.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(t)) return isHttpUrl(t) ? new URL(t).toString() : null;
  const head = t.split(/[/?#]/)[0];
  if (!/\s/.test(t) && (head.includes(".") || /^localhost(:\d+)?$/i.test(head))) {
    const candidate = `https://${t}`;
    if (isHttpUrl(candidate)) return new URL(candidate).toString();
  }
  return SEARCH_URL + encodeURIComponent(t);
}

// The ONLY string that reaches the session name (persist:client_<id>). Strict charset by design.
const CLIENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;

// Reject non-finite payloads outright, then clamp the rect into the window's content area.
function clampBounds(raw: unknown): { x: number; y: number; width: number; height: number } | null {
  const win = getMainWindow();
  if (!raw || typeof raw !== "object" || !win) return null;
  const r = raw as Record<string, unknown>;
  const nums = [r.x, r.y, r.width, r.height].map((v) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v) : NaN
  );
  if (nums.some(Number.isNaN)) return null;
  const [cw, ch] = win.getContentSize();
  const x = Math.min(Math.max(nums[0], 0), cw);
  const y = Math.min(Math.max(nums[1], 0), ch);
  const width = Math.min(Math.max(nums[2], 0), cw - x);
  const height = Math.min(Math.max(nums[3], 0), ch - y);
  if (width <= 0 || height <= 0) return null; // reject a collapsed rect → keep the last good bounds
  return { x, y, width, height };
}

// Engine → module events ride the shell window's webContents (the module subscribes via preload).
function send(channel: string, ...args: unknown[]): void {
  getMainWindow()?.webContents.send(channel, ...args);
}

function applyVisibility(): void {
  const show = moduleVisible && !modalOpen && !shellOverlay && !swapping;
  /**
   * DIAG-2 (08-20-2026) — THE FOUR FLAGS, PRINTED, and this is the instrumentation this module
   * actually needed. Nothing here has arithmetic worth a self-check the way the media wall does;
   * what it has is one boolean decided by four inputs owned by THREE different writers — the module
   * (moduleVisible, modalOpen), the shell (shellOverlay) and the tab swapper (swapping).
   *
   * Every Scout bug this session was a wrong combination of exactly these: the guest painting over
   * a peeking nav panel, over the Settings modal, and over the experimental gate. All three look
   * identical from the renderer — a native view where chrome should be — and none of them can be
   * seen in DevTools, because the WebContentsView is not in the DOM. A line per transition is the
   * difference between reading the answer and guessing at it.
   *
   * Cost when DIAG is unset: one `===` against a string, once per visibility change.
   */
  if (process.env.DIAG === "1") {
    console.info(
      `[scout] visible=${show}  module=${moduleVisible} modal=${modalOpen} shellOverlay=${shellOverlay} swapping=${swapping}`
    );
  }
  guestView?.setVisible(show);
}

// --- guest engine ---------------------------------------------------------------------------------

// The guest is a HOSTILE web page: sandboxed, no preload, zero bridge surface. Its only outputs
// are pixels (capturePage) and the isolated-world DOM read below.
function createGuestView(clientId: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      partition: `persist:client_${clientId}`, // per-client cookie/storage/cache isolation
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  view.setBackgroundColor("#00000000"); // transparent until the page paints — kills the white flash
  const wc = view.webContents;
  wc.setUserAgent(CHROME_UA); // strip the Electron signature — applied per-view so tab swaps keep it
  // Audit R3 — the guest is a HOSTILE page: deny every permission by DEFAULT on its partition session
  // (camera / microphone / geolocation / notifications …), and deny permission CHECKS too so a page
  // cannot query its way around the request handler. Set on the partition session; idempotent across
  // tab recreation. There is no reason to grant a browsed page any device permission here.
  wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  wc.session.setPermissionCheckHandler(() => false);
  // Popups: destroy the native child window, but keep the target IN-SESSION — navigate the single
  // guest engine instead of shell.openExternal (which would leak _blank links outside the
  // persist:client_<id> partition → logged-out). http(s) guard stays.
  wc.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void guestView?.webContents.loadURL(url);
    return { action: "deny" };
  });
  // Navigation trap: browsing stays http(s)-only — a page redirecting to file:/custom schemes dies here.
  wc.on("will-navigate", (event, url) => {
    if (!isHttpUrl(url)) event.preventDefault();
  });
  // url-sync carries {url, title} on the ONE existing channel; page-title-updated catches the
  // late titles SPAs set after navigation (did-navigate often fires before <title> exists).
  // The same event keeps this client's tab-state row quit-safe (URL-only sync, scroll saved later).
  wc.on("did-navigate", (_e, url) => {
    send("scout:url-changed", { url, title: wc.getTitle() });
    try {
      saveTabUrl(clientId, url);
    } catch {
      // shared DB not up (pre-org edge) — the full save paths will land it later
    }
  });
  wc.on("page-title-updated", (_e, title) => send("scout:url-changed", { url: wc.getURL(), title }));
  // Loading state drives the chrome's dynamic Stop/Reload button.
  wc.on("did-start-loading", () => send("scout:loading", true));
  wc.on("did-stop-loading", () => send("scout:loading", false));
  return view;
}

// Isolated-world extraction: shares the page DOM but NOT its JS globals, so a hostile page can't
// tamper with the reader, and no scraper library ever enters the picture (Scout Viewer intent).
const DOM_READ_JS = `(() => {
  const txt = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  const take = (sel, n) => [...new Set(Array.from(document.querySelectorAll(sel)).map(txt).filter(Boolean))].slice(0, n);
  return {
    url: location.href,
    title: document.title.slice(0, 200),
    headings: take('h1, h2, h3', 30),
    nav: take('nav a, [role="navigation"] a, aside a', 40),
    tableCols: take('table th, [role="columnheader"]', 30),
    actions: take('button, [role="button"], input[type="submit"]', 30),
    counts: {
      links: document.links.length,
      forms: document.forms.length,
      tables: document.querySelectorAll('table').length,
      iframes: document.querySelectorAll('iframe').length,
    },
  };
})()`;

// --- per-client tab state (URL + scroll) ------------------------------------------------------------

// Scroll read — the SAME isolated world as the DOM card: read-only, two ints out, nothing injected
// (the raw-secret executeJavaScript ban is untouched). Mid-navigation rejection → zeros.
const finiteInt = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
async function readScroll(wc: WebContents): Promise<{ x: number; y: number }> {
  try {
    const r = (await wc.executeJavaScriptInIsolatedWorld(DOM_READ_WORLD, [
      { code: "({ x: window.scrollX, y: window.scrollY })" },
    ])) as { x?: unknown; y?: unknown } | null;
    return { x: finiteInt(r?.x), y: finiteInt(r?.y) };
  } catch {
    return { x: 0, y: 0 };
  }
}

// Persist the ACTIVE session's {url, scroll} — switch-away, module-hide and app-quit funnel here.
async function saveActiveTabState(): Promise<void> {
  const gv = guestView;
  if (!gv) return;
  try {
    const url = gv.webContents.getURL();
    if (!url) return;
    const s = await readScroll(gv.webContents);
    saveTabState(activeClientId, url, s.x, s.y);
  } catch {
    // teardown race — the did-navigate URL sync already kept the row's URL fresh
  }
}

// Point a (new) view at a client's SAVED state: saved URL wins over the fallback; scroll restores
// once the page painted. No row = first visit → fallback URL, scroll 0, no error.
function loadWithRestore(view: WebContentsView, clientId: string, fallbackUrl: string): void {
  let saved: ReturnType<typeof getTabState>;
  try {
    saved = getTabState(clientId);
  } catch {
    saved = undefined;
  }
  const target = saved?.url && isHttpUrl(saved.url) ? saved.url : fallbackUrl;
  if (saved && (saved.scroll_x > 0 || saved.scroll_y > 0)) {
    const { scroll_x, scroll_y } = saved; // DB ints (clamped at save) — safe to interpolate
    view.webContents.once("did-stop-loading", () => {
      view.webContents
        .executeJavaScriptInIsolatedWorld(DOM_READ_WORLD, [{ code: `window.scrollTo(${scroll_x}, ${scroll_y})` }])
        .catch(() => {});
    });
  }
  void view.webContents.loadURL(target);
}

// --- engine lifecycle -------------------------------------------------------------------------------

// Lazy: the guest is born on the module's FIRST activation, not at app boot — the shell never pays
// for a live HaloPSA session it isn't showing. The view then persists across module switches
// (hidden, page + session intact) until the app quits.
let shellHooked = false;
export function ensureEngine(): void {
  const win = getMainWindow();
  if (!win || guestView) return;
  if (!shellHooked) {
    shellHooked = true;
    // A shell reload (Ctrl+R) or renderer crash never runs React cleanups, so the visible-flags
    // would stay latched and the guest would paint over the boot terminal / Safe Mode (verified
    // workflow finding, recon-058). Any shell navigation or renderer death resets them; the boot
    // router remounts the module (last_active_module) and turns the guest back on legitimately.
    const reset = (): void => {
      moduleVisible = false;
      modalOpen = false;
      applyVisibility();
    };
    win.webContents.on("did-navigate", reset);
    win.webContents.on("render-process-gone", reset);
    // Quit-persistence, best effort: capture the active session's scroll on the way out (the
    // did-navigate URL sync already keeps the row's URL current even if this races teardown).
    app.on("before-quit", () => {
      void saveActiveTabState();
    });
  }
  guestView = createGuestView(DEFAULT_CLIENT);
  activeClientId = DEFAULT_CLIENT;
  // Guest belongs ABOVE the shell renderer (canon z-order): the module paints the hole below it.
  win.contentView.addChildView(guestView);
  guestView.setBounds(lastBounds);
  guestView.setVisible(false); // the module's visible(true) follows immediately after mount
  loadWithRestore(guestView, DEFAULT_CLIENT, START_URL); // reopen where this session left off
}

export function setModuleVisible(visible: boolean): void {
  moduleVisible = visible === true;
  // Module gone = its modal is gone. Clearing the flag here kills the latch where a modal left
  // open at unmount kept the guest hidden forever on return (verified workflow finding, recon-058).
  if (!moduleVisible) {
    modalOpen = false;
    void saveActiveTabState(); // leaving the module — checkpoint this session's {url, scroll}
    // Park the hidden view at zero-size: an attached-but-hidden WebContentsView can still flash
    // as a native rectangle during live window resize (compositor artifact). lastBounds survives.
    guestView?.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
  if (moduleVisible) {
    ensureEngine();
    guestView?.setBounds(lastBounds); // un-park (renderer re-sends exact bounds on mount anyway)
  }
  applyVisibility();
  // Re-sync the chrome on every (re)mount — URL bar + Stop/Reload reflect the live view state.
  if (moduleVisible && guestView) {
    send("scout:url-changed", {
      url: guestView.webContents.getURL(),
      title: guestView.webContents.getTitle(),
    });
    send("scout:loading", guestView.webContents.isLoading());
  }
}

export function setModalOpen(open: boolean): void {
  modalOpen = open === true;
  applyVisibility();
}

/** Shell chrome (peeking nav panel / Settings modal) is covering the module — see shellOverlay. */
export function setShellOverlay(open: boolean): void {
  shellOverlay = open === true;
  applyVisibility();
}

export function setBounds(raw: unknown): void {
  const bounds = clampBounds(raw);
  if (!bounds || !guestView) return;
  lastBounds = bounds;
  guestView.setBounds(bounds);
}

export function navigate(raw: unknown): void {
  // resolveNavTarget, not normalizeHttpUrl: the bar accepts a search phrase as well as a URL.
  const url = resolveNavTarget(raw);
  if (!url || !guestView) return;
  void guestView.webContents.loadURL(url);
}

// Chrome nav — modern navigationHistory API (Electron 41 deprecated webContents.goBack/canGoBack).
// canGo* guards keep the buttons inert at the ends of history instead of throwing.
export function goBack(): void {
  const nav = guestView?.webContents.navigationHistory;
  if (nav?.canGoBack()) nav.goBack();
}
export function goForward(): void {
  const nav = guestView?.webContents.navigationHistory;
  if (nav?.canGoForward()) nav.goForward();
}
export function reload(): void {
  guestView?.webContents.reload();
}
export function stopLoad(): void {
  guestView?.webContents.stop();
}

// --- DECISIONS instant visual restore (tab swap) ----------------------------------------------------
// A webContents' partition is FIXED at creation, so "swap the session" = replace the single guest
// view. Order matters: capture → module overlays the shot → old view removed (shot now visible) →
// new view loads HIDDEN behind it → reveal + fade only after the new DOM painted.
export async function switchClientTab(clientId: unknown, url: unknown): Promise<void> {
  const win = getMainWindow();
  if (!win || !guestView || swapping) return; // one engine, one swap at a time
  if (typeof clientId !== "string" || !CLIENT_ID.test(clientId) || !isHttpUrl(url)) return;
  swapping = true;
  try {
    // Save the DEPARTING session's state while its view is still alive (url + scroll upsert).
    await saveActiveTabState();
    try {
      const shot = await guestView.webContents.capturePage();
      if (!shot.isEmpty()) send("scout:snapshot", shot.toDataURL());
    } catch {
      // capture fails on a crashed/never-painted view — swap proceeds uncovered, nothing to restore
    }
    await new Promise((r) => setTimeout(r, SWAP_PAINT_DELAY_MS));

    const old = guestView;
    guestView = createGuestView(clientId);
    activeClientId = clientId;
    guestView.setVisible(false); // background render — the snapshot owns the pixels until ready
    win.contentView.addChildView(guestView);
    guestView.setBounds(lastBounds);
    win.contentView.removeChildView(old);
    old.webContents.close();

    // did-stop-loading fires on success AND failure, so the overlay can never wedge; cap is belt+braces.
    const reveal = (): void => {
      clearTimeout(cap);
      swapping = false;
      applyVisibility(); // respects module/modal state — never forces the guest over another view
      send("scout:tab-ready");
    };
    const cap = setTimeout(reveal, SWAP_REVEAL_TIMEOUT_MS);
    guestView.webContents.once("did-stop-loading", reveal);
    // Returning to a known client resumes its saved {url, scroll}; first visit = the passed url.
    loadWithRestore(guestView, clientId, url);
    // Sync the Stop/Reload button to the freshly-swapped view immediately (the new view is loading).
    send("scout:loading", guestView.webContents.isLoading());
  } catch (e) {
    swapping = false;
    console.error("[scout] tab swap failed:", e);
  }
}

// Zero-scraper structure read — plain serializable card, or null when no engine is alive yet.
// (Prototype called this via mainFrame; the TYPED home for the API is webContents itself — same
// isolated-world execution against the main frame.)
export function domRead(): Promise<unknown> | null {
  if (!guestView) return null;
  return guestView.webContents.executeJavaScriptInIsolatedWorld(DOM_READ_WORLD, [
    { code: DOM_READ_JS },
  ]);
}
