// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Feedback relay — the server half of Report a problem / Suggest something. Holds the
//              Resend key and the destination address so the desktop build carries neither.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: scripts/feedback-relay.worker.js
//------------------------------------------------------------
//
// WHY THIS EXISTS
//
// The app used to call api.resend.com directly, which meant the Resend API key had to be inside the
// app. An Electron .asar is a zip — a key in one is a key anybody can extract and use to send mail as
// AvertXAI, carrying our domain's reputation. That is not a leaked address, that is phishing with our
// name on it.
//
// So the key moved here. The desktop client knows one URL and no secret. This endpoint is meant to be
// public and is defended the way public endpoints are defended: method and content-type checks, a
// size cap, shape validation, and a rate limit — never by hiding the URL.
//
// This file is NOT part of the Electron build. It deploys separately to Cloudflare Workers.
//
// -------------------------------------------------------------------------------------------------
// DEPLOY
//
// wrangler.toml:
//
//   name = "focal-feedback-relay"
//   main = "scripts/feedback-relay.worker.js"
//   compatibility_date = "2026-01-01"
//
//   [[unsafe.bindings]]
//   name = "RATE"
//   type = "ratelimit"
//   namespace_id = "1"
//   simple = { limit = 5, period = 60 }
//
//   [vars]
//   MAIL_TO   = "focalregistry@gmail.com"
//   MAIL_FROM = "Focal Registry <onboarding@resend.dev>"
//
// Then, once:
//   wrangler secret put RESEND_API_KEY
//   wrangler deploy
//
// Route it at https://api.avertxai.com/feedback to match RELAY_URL in
// electron/core/services/feedback/index.ts.
//
// THE KEY. Create a SEND-ONLY Resend key for this Worker — never the account's full-access key. A
// send-only key cannot read delivery logs, delete domains, or mint further keys, so a compromised
// Worker leaks the ability to send mail and nothing else, and revoking it breaks only this endpoint.
//
// MAIL_TO and MAIL_FROM are vars, not secrets, and they live here rather than in the app on purpose:
// changing where reports land is a `wrangler deploy`, not a desktop release.
//
// MAIL_FROM is on onboarding@resend.dev because avertxai.com is not yet a verified Resend sending
// domain. In that state Resend delivers ONLY to the Resend account's own registered address, so this
// works end to end today provided the Resend account is registered to MAIL_TO. Once avertxai.com is
// verified, switch MAIL_FROM to "Focal Registry <feedback@avertxai.com>" and the restriction lifts.
// -------------------------------------------------------------------------------------------------

const MAX_BYTES = 5 * 1024 * 1024; // JSON body; generous because attachments arrive base64 in-payload
const KINDS = new Set(["problem", "suggestion", "startup"]);

/** No preflight is needed — the client sends application/json from Electron's net.fetch, not a page. */
function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Licence key -> the email address that bought it.
 *
 * STUB. Wire this to Stripe (search customers by the `licenseKey` metadata field written at
 * checkout) or to whatever holds the marketplace records. Until then it returns null and reports
 * arrive unanswerable, which is the honest state — not a bug to paper over with a client-side
 * email box, because that is the exact thing this design exists to avoid.
 */
async function customerEmail(_env, _account) {
  return null;
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return reply(405, { error: "POST only" });

    const type = request.headers.get("content-type") || "";
    if (!type.includes("application/json")) return reply(415, { error: "JSON only" });

    // Declared length first — rejects an oversize body before reading it into memory. A chunked
    // request has no header, so the parsed-size check below is the real backstop.
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) return reply(413, { error: "too large" });

    // Per-IP, so one broken install cannot become a spam relay. Cloudflare's own DDoS layer sits in
    // front of this; the limiter is for the merely-noisy case, not the malicious one.
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const { success } = await env.RATE.limit({ key: ip });
    if (!success) return reply(429, { error: "slow down" });

    let raw;
    try {
      raw = await request.text();
    } catch {
      return reply(400, { error: "unreadable body" });
    }
    if (raw.length > MAX_BYTES) return reply(413, { error: "too large" });

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return reply(400, { error: "bad JSON" });
    }

    // Shape check. Anything that is not one of our three payloads is somebody else poking the URL.
    if (!payload || typeof payload !== "object") return reply(400, { error: "bad payload" });
    if (!KINDS.has(payload.kind)) return reply(400, { error: "bad kind" });
    if (typeof payload.reference !== "string" || !/^F[RS]-[0-9A-F]{4}$/.test(payload.reference)) {
      return reply(400, { error: "bad reference" });
    }

    const label = payload.kind === "suggestion" ? "Suggestion" : "Problem";
    const mail = {
      from: env.MAIL_FROM,
      to: [env.MAIL_TO],
      subject: `[Focal Registry] ${label} ${payload.reference}`,
      text: JSON.stringify(payload, null, 2),
    };

    // THE REPLY ADDRESS IS RESOLVED HERE AND ONLY HERE. Ruled 08-23-2026: the client never asks a
    // person for their email, it sends the licence key it already holds (payload.account). This is
    // where that key becomes an address — hit Reply in the inbox and it reaches the right person,
    // without the app ever having held it.
    //
    // customerEmail() is the Stripe/marketplace lookup and does not exist yet, so every report is
    // currently unanswerable. The key is captured regardless, which means reports taken before the
    // customer table exists become answerable the moment it does. Nothing has to be re-collected.
    const replyTo = payload.account ? await customerEmail(env, payload.account) : null;
    if (replyTo) mail.reply_to = replyTo;
    // Screenshots ride along when the client starts sending them; harmless while it does not.
    if (Array.isArray(payload.attachments) && payload.attachments.length) {
      mail.attachments = payload.attachments;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(mail),
    });

    // Resend's error text stays server-side. The client is told it failed and keeps the report
    // spooled to retry — it has no use for the upstream reason and should not be handed one.
    if (!res.ok) {
      console.error(`relay ${payload.reference} resend ${res.status}: ${await res.text()}`);
      return reply(502, { error: "delivery failed" });
    }

    return reply(200, { ok: true, reference: payload.reference });
  },
};
