// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Feedback service — the deliberate "Report a problem" and "Suggest something" channel,
//              plus the screenshot the app takes for itself when something breaks. Owns reference
//              ids, the console ring buffer, screen capture, and delivery.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/feedback/index.ts
//------------------------------------------------------------
//
// WHAT THIS FILE IS FOR, AND WHAT IT IS NOT
//
// Before this existed the app had NO crash net at all: no uncaughtException handler, no
// unhandledRejection handler, no .catch() on the whenReady block, and exactly one React error
// boundary (inside the Vault). A renderer death wrote one line to a console nobody reads
// (main.ts: "Log-only; recovery stays a human decision") and that was the end of it. Every crash any
// user has ever had is simply gone. This file is the listener that was missing.
//
// It is the DELIBERATE channel. Automatic crash telemetry is a separate decision (Bugsink,
// self-hosted) and this must never quietly become that: nothing in here sends without a person
// pressing a button, with ONE named exception — startup failures, which have no window to ask in.
// That exception is the only thing in the application that transmits unasked, and it has to be named
// in the privacy policy.
//
// SECRETS. The transport reads RESEND_API_KEY from the environment. See loadEnvFile() below for why
// that is a development convenience and NOT the shipping design.
import { app, net } from "electron";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getMainWindow } from "../../windows";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** Parsed once. `null` until loadEnvFile runs, `{}` if there is no file. */
let env: Record<string, string> | null = null;

/**
 * Reads the repo-root `.env` if one is sitting next to the app.
 *
 * The file already existed before this service did — two keys, RESEND_API_KEY and
 * FOCAL_BUG_REPORT_TO — with nothing in the codebase reading either. It is gitignored and it is NOT
 * in electron-builder's `files` array, so it does not ship.
 *
 * THAT IS DELIBERATE AND MUST STAY THAT WAY. A Resend API key inside a distributed desktop
 * application is a key anybody can pull out of the bundle and use to send mail as AvertXAI. So this
 * loader is the DEVELOPMENT path only: it makes the feature testable on Jason's machine today.
 * The shipping path is FEEDBACK_RELAY_URL — an endpoint we own that holds the key server-side. Until
 * that endpoint exists a packaged build finds no key, and send() writes the report to disk instead of
 * dropping it (see deliver()).
 *
 * No dotenv dependency: this is a dozen lines and the Dependency-Safety SOP says not to add a package
 * for what a few lines of our own code will do.
 */
function loadEnvFile(): Record<string, string> {
  if (env) return env;
  env = {};
  // In dev the file sits at the repo root, two levels above dist-electron. In a packaged build there
  // is no such file and this loop simply finds nothing.
  const candidates = [
    path.join(app.getAppPath(), ".env"),
    path.join(path.dirname(app.getAppPath()), ".env"),
    path.join(process.cwd(), ".env"),
  ];
  for (const file of candidates) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue; // missing or unreadable is the normal case, not an error
    }
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      // Strip one layer of surrounding quotes, the only quoting .env files reliably agree on.
      const val = t.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      if (key) env[key] = val;
    }
    break; // first file wins
  }
  return env;
}

/** Environment first, so a real deployment can override without touching the file. */
function envVar(name: string): string {
  return process.env[name] || loadEnvFile()[name] || "";
}

// ---------------------------------------------------------------------------
// Reference ids
// ---------------------------------------------------------------------------

/**
 * FR- for a problem, FS- for a suggestion. Same shape as the Vault's VLT- ids (log.ts) so support
 * conversations read consistently.
 *
 * THIS IS THE HANDLE A PERSON QUOTES. The report form has no reply-address field and never will —
 * ruled 08-23-2026, the reply address is resolved server side from the licence key (see `account`).
 * So this reference is what a human says out loud when they follow up, and it must survive into
 * whatever receives these. Losing it means losing the thread.
 */
export function newReference(kind: "report" | "suggestion"): string {
  return `${kind === "report" ? "FR" : "FS"}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// The console ring buffer
// ---------------------------------------------------------------------------

const RING_MAX = 200;
const ring: string[] = [];

/** Millisecond-free timestamp — a report is read by a human, not diffed by a machine. */
function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function note(line: string): void {
  ring.push(`${stamp()}  ${line}`);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
}

/**
 * Wraps console.error and console.warn so everything main already logs lands in the ring.
 *
 * There is no session log file in this application and adding one is a bigger decision than this
 * feature. A 200-line in-memory ring costs nothing, needs no disk, no rotation and no cleanup, and it
 * captures what is already being written — including main.ts's "[shell] renderer gone: reason=…",
 * which is precisely the line worth having when someone reports a blank window.
 *
 * ponytail: 200 lines held in memory. If a report ever needs more history than the current session,
 * that is when a real on-disk logger earns its keep — not before.
 */
export function captureConsole(): void {
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      original(...args);
      try {
        note(
          `${level}  ` +
            args
              .map((a) => (a instanceof Error ? `${a.message}` : typeof a === "string" ? a : JSON.stringify(a)))
              .join(" ")
        );
      } catch {
        // A logger that throws while logging an error is how one bug becomes two.
      }
    };
  }
}

/** Newest last, which is how a person reads a log. */
export function recentLog(limit = 50): string[] {
  return ring.slice(-Math.max(1, Math.min(limit, RING_MAX)));
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

function shotDir(): string {
  const dir = path.join(app.getPath("userData"), "feedback");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Captures the main window and writes it to userData/feedback/<reference>.png.
 *
 * Full resolution on disk, a small data URL back to the renderer. The renderer only ever needs to
 * SHOW that a shot was taken — the thumbnail is inert, it cannot be clicked or expanded (ruled
 * 08-23-2026, "no options for users") — so sending it the full-size image would be megabytes across
 * the bridge for a 200-pixel-wide picture.
 *
 * capturePage() is already proven in this codebase: scout-viewer/index.ts uses it on its guest view.
 */
export async function captureScreen(reference: string): Promise<{ path: string; thumb: string } | null> {
  const win = getMainWindow();
  if (!win) return null;
  try {
    const image = await win.webContents.capturePage();
    if (image.isEmpty()) return null;
    const file = path.join(shotDir(), `${reference}.png`);
    fs.writeFileSync(file, image.toPNG());
    // 320px wide is enough to recognise the screen and small enough to cross the bridge cheaply.
    const thumb = image.resize({ width: 320 }).toDataURL();
    return { path: file, thumb };
  } catch {
    // A crashed or never-painted window cannot be captured. The report still goes without a picture,
    // which is worth strictly more than no report.
    return null;
  }
}

/**
 * Deletes a held screenshot.
 *
 * Called when someone answers "Not now" to the crash prompt. THE DELETION IS THE POINT: an
 * application quietly sitting on pictures of a user's screen that nobody agreed to send is the thing
 * that turns a helpful feature into a breach. Declining must destroy, never park.
 */
export function discardScreen(reference: string): void {
  try {
    fs.unlinkSync(path.join(shotDir(), `${reference}.png`));
  } catch {
    // Already gone is the desired end state.
  }
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export interface ReportInput {
  reference: string;
  description: string;
  /** "Include the files, folders, system & hardware drivers used." — off unless the user ticks it. */
  includeSystem: boolean;
  /** Extra pictures the user picked themselves, absolute paths from the file dialog. */
  extraImages?: string[];
  /** Set when the report came from a crash prompt rather than the Help menu. */
  crash?: boolean;
  /** Licence key, so the server can find who to reply to. See the note on `account` below. */
  account?: string | null;
}

export interface SuggestionInput {
  reference: string;
  idea: string;
  problem: string;
  area: string;
  /** nice | weekly | blocking | pay — the pricing signal, not a courtesy field. */
  weight: string;
  /** Module slugs this person is entitled to, so an idea can be read against who sent it. */
  modules: string[];
  /** Licence key, so the server can find who to reply to. See the note on `account` below. */
  account?: string | null;
}

/**
 * WHY THE REPORT CARRIES A LICENCE KEY AND NOT AN EMAIL ADDRESS.
 *
 * Ruled 08-23-2026 (Jason): the reply address is resolved server side, never collected on the client.
 * So no form in this application ever asks a person for their email — the report carries the licence
 * key it already has, and the server joins that key to the customer record to learn where to write.
 *
 * That is the better design for three reasons. The user types nothing. The address cannot be typo'd,
 * spoofed, or used to make the app mail a stranger. And an address the client never holds is an
 * address that cannot leak out of the client.
 *
 * `null` is the normal unlicensed case and must stay deliverable — a free-tier report is still worth
 * reading, it simply cannot be answered.
 */

function platform(): Record<string, string> {
  return {
    app: `Focal Registry ${app.getVersion()}`,
    os: `${process.platform} ${process.getSystemVersion?.() ?? ""}`.trim(),
    arch: process.arch,
    electron: process.versions.electron,
  };
}

/**
 * System detail, attached ONLY when the checkbox is ticked.
 *
 * The wording the user agrees to is "the files, folders, system & hardware drivers used", so this is
 * what that sentence has to mean and nothing more. Folder names carry client names — that is the
 * whole reason this is opt-in and defaults off.
 */
function systemDetail(): Record<string, unknown> {
  return {
    cpus: process.getCPUUsage?.(),
    memory: process.getSystemMemoryInfo?.(),
    gpu: app.getGPUFeatureStatus?.(),
    paths: {
      userData: app.getPath("userData"),
      home: app.getPath("home"),
      temp: app.getPath("temp"),
    },
  };
}

export function buildReport(input: ReportInput): Record<string, unknown> {
  return {
    kind: "problem",
    reference: input.reference,
    description: input.description,
    fromCrash: input.crash === true,
    account: input.account ?? null,
    ...platform(),
    log: recentLog(50),
    ...(input.includeSystem ? { system: systemDetail() } : {}),
    extraImages: input.extraImages?.length ?? 0,
  };
}

export function buildSuggestion(input: SuggestionInput): Record<string, unknown> {
  return {
    kind: "suggestion",
    reference: input.reference,
    idea: input.idea,
    problem: input.problem,
    area: input.area,
    weight: input.weight,
    modules: input.modules,
    account: input.account ?? null,
    ...platform(),
    // Deliberately no log, no paths, no system block. A suggestion is not a bug report and must not
    // quietly behave like one.
  };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * THE RELAY IS THE SHIPPING TRANSPORT. Resend-direct is the development fallback and nothing more.
 *
 * Why this order and not the other way round: calling api.resend.com from the app means the Resend
 * API key has to BE in the app. An Electron .asar is a zip — a key inside one is a key anybody can
 * pull out and use to send mail as AvertXAI, with our domain's reputation behind it. That is not a
 * leaked address, that is phishing with our name on it.
 *
 * The relay inverts that. The app knows one URL and no secret; the server holds the key and decides
 * where the mail goes. A URL is meant to be public — it is defended with rate limiting, payload
 * validation and a non-secret app token, never with obscurity. It also means the destination address
 * is not in the binary either, so changing where reports land is a server edit, not a release.
 *
 * Worker source lives in scripts/feedback-relay.worker.js.
 */
const RELAY_URL = "https://api.avertxai.com/feedback";
const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 15_000;

function outbox(): string {
  const dir = path.join(app.getPath("userData"), "feedback", "outbox");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Writes the payload next to the app so nothing is ever silently lost.
 *
 * This is the fallback whenever delivery cannot happen — no key, no network, the API refusing. A
 * report the user believed they sent, that went nowhere and left no trace, is worse than no report
 * button at all, because it spends their goodwill and returns nothing.
 */
function spool(payload: Record<string, unknown>, reference: string): string {
  const file = path.join(outbox(), `${reference}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

function asEmail(payload: Record<string, unknown>): { subject: string; text: string } {
  const kind = payload.kind === "suggestion" ? "Suggestion" : "Problem";
  return {
    subject: `[Focal Registry] ${kind} ${String(payload.reference)}`,
    text: JSON.stringify(payload, null, 2),
  };
}

/** Delivered — drop the spool copy. Failing to unlink is harmless; it retries and de-dupes by reference. */
function unspool(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // Delivered but the spool file lingers — better than deleting before confirmation.
  }
}

/**
 * Sends, or spools and says so.
 *
 * TWO TRANSPORTS, AND THE ORDER MATTERS.
 *
 *   relay   — the shipping path. POST the payload as-is to an endpoint we own. The app carries a URL
 *             and no secret; the server holds the Resend key and knows the destination address.
 *   Resend  — direct, development only, and only when a relay is not configured. Requires the key to
 *             be present in the environment, which in a packaged build it never is.
 *
 * A packaged build therefore ALWAYS takes the relay and there is no fall-through to Resend: falling
 * back would need the key on the client, which is the exact thing the relay exists to avoid. When the
 * relay is unreachable the report stays spooled rather than being lost.
 *
 * net.fetch rather than a new HTTP dependency — brandpack/index.ts and update-window.ts already use
 * it, so this adds no package and no supply-chain surface (Dependency-Safety SOP).
 */
export async function deliver(payload: Record<string, unknown>): Promise<{ sent: boolean; reference: string }> {
  const reference = String(payload.reference ?? "unknown");

  // Always spool first. If the network call then succeeds we remove it; if the process dies mid-send
  // the report survives on disk. Spooling after a failed send would lose everything that crashes
  // between the two.
  const spooled = spool(payload, reference);

  // Packaged builds always relay. In dev, set FEEDBACK_RELAY_URL to test against it; leave it unset
  // to go straight to Resend with the local key.
  const relay = envVar("FEEDBACK_RELAY_URL") || (app.isPackaged ? RELAY_URL : "");

  try {
    if (relay) {
      const res = await net.fetch(relay, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) {
        note(`feedback  ${reference} relay refused: ${res.status}`);
        return { sent: false, reference };
      }
      unspool(spooled);
      return { sent: true, reference };
    }

    const key = envVar("RESEND_API_KEY");
    const to = envVar("FOCAL_BUG_REPORT_TO");
    if (!key || !to) {
      // Dev machine with no .env. Not a failure the user should see — the report is captured, it just
      // has not left the machine.
      note(`feedback  ${reference} spooled (no relay, no local credentials)`);
      return { sent: false, reference };
    }

    const { subject, text } = asEmail(payload);
    const res = await net.fetch(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "Focal Registry <onboarding@resend.dev>", to: [to], subject, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      note(`feedback  ${reference} delivery refused: ${res.status}`);
      return { sent: false, reference };
    }
    unspool(spooled);
    return { sent: true, reference };
  } catch (e) {
    note(`feedback  ${reference} delivery failed: ${e instanceof Error ? e.message : String(e)}`);
    return { sent: false, reference };
  }
}

// ---------------------------------------------------------------------------
// Start-up failures — the one unasked channel
// ---------------------------------------------------------------------------

/**
 * Records a failure that happened before there was a window to ask in.
 *
 * Ruled 08-23-2026: start-up errors are captured and sent quietly on their own, because there is
 * literally no surface to show a dialog on yet. It carries no screenshot and no file paths — only
 * what broke and what the machine is.
 *
 * THIS IS THE ONLY THING IN THE APPLICATION THAT TRANSMITS WITHOUT BEING ASKED. It must be named in
 * the privacy policy, and if that sentence ever gets cut from the policy, this function comes out
 * with it.
 */
export async function reportStartupFailure(error: unknown): Promise<void> {
  const reference = newReference("report");
  const payload = {
    kind: "startup",
    reference,
    description: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
    ...platform(),
    log: recentLog(50),
  };
  await deliver(payload);
}
