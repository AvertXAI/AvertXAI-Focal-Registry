// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone module
// Description: Generates VAULT-SEED-DATA.xlsx — the ruled seed dataset (Jason, 08-06-2026): three
//              letter pages A-I / J-R / S-Z, alphabetical companies, columns Company · Full name ·
//              Username / ID · URL / Website · Password · Other · Backup codes · Security questions.
//              Passwords are DELIBERATELY dumb human-made ("doggy123" class) with deliberate REUSE
//              and stale years, because the vault's health surface must have something honest to
//              flag when this same sheet is later fed through the import flow. Every value is FAKE.
//              ZERO dependencies: an .xlsx is a zip of XML parts, and this file hand-rolls both
//              (STORE-method zip + inline-string worksheets), so it runs on bare node with no
//              installs — the licence gate stays untouched. Deterministic: fixed data, no clock,
//              no randomness — regenerating byte-identical output is the point.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/seed/generate-seed-xlsx.mjs
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "VAULT-SEED-DATA.xlsx");

// ---- the dataset -----------------------------------------------------------------------------
// Main identity per ruling: paulcruz@brightflashmedia.com. A few platform handles vary the way a
// real person's do. Reused passwords (the bad habit health must catch): doggy123 ×4,
// Brightflash2019! ×3, sanantonio210 ×2, Maggie&Me2018 ×2. Two strong outliers for contrast.
const U = "paulcruz@brightflashmedia.com";
const ROWS = [
  // [Company, Full name, Username / ID, URL / Website, Password, Other, Backup codes, Security questions]
  ["Adobe", "Paul Cruz", U, "account.adobe.com", "Brightflash2019!", "Creative Cloud annual — card on file", "", "First camera? Canon AE-1"],
  ["Amazon", "Paul Cruz", U, "amazon.com", "doggy123", "Prime; Maria knows this one", "", "First pet? Maggie"],
  ["Apple", "Paul Cruz", U, "appleid.apple.com", "PaulCruz1968!", "iPhone + iPad backups", "8341-0272, 5518-9906", "Mother's maiden name? Gonzalez"],
  ["AT&T", "Paul Cruz", "pcruz210", "att.com", "sanantonio210", "Family plan, 4 lines", "", "City of birth? San Antonio"],
  ["Backblaze", "Paul Cruz", U, "backblaze.com", "backupbackup2020", "Whole-studio backup — DO NOT LAPSE", "", ""],
  ["Bank of America", "Paul Cruz", "paulcruz1968", "bankofamerica.com", "Maggie&Me2018", "Business checking", "", "First car? 1998 Silverado"],
  ["Best Buy", "Paul Cruz", U, "bestbuy.com", "doggy123", "Rewards account", "", ""],
  ["Canon", "Paul Cruz", U, "canon.com/account", "CanonR5rocks", "Gear registration + CPS", "", ""],
  ["Cloudflare", "Paul Cruz", U, "dash.cloudflare.com", "kT9#mWq2$vLp8&Zr", "DNS for brightflashmedia.com — set up by Jason", "1194-8823, 7702-3410", ""],
  ["Costco", "Paul & Maria Cruz", "cruzfamily78228", "costco.com", "costco2016", "Executive membership", "", ""],
  ["Dropbox", "Paul Cruz", U, "dropbox.com", "Brightflash2019!", "Client galleries overflow", "", "First pet? Maggie"],
  ["eBay", "Paul Cruz", "brightflashpaul", "ebay.com", "doggy123", "Sold the old 5D here", "", ""],
  ["Etsy", "Maria Cruz", "mariacruzprints", "etsy.com", "MariaPrints2021", "Maria's print shop — Paul pays the bills", "", ""],
  ["Facebook", "Paul Cruz", U, "facebook.com", "paulpaulpaul2026", "Business page: Brightflash Media", "", "High school? Jefferson High"],
  ["FedEx", "Paul Cruz", U, "fedex.com", "shipit2017", "Print shipping account", "", ""],
  ["GoDaddy", "Paul Cruz", U, "godaddy.com", "Brightflash2019!", "brightflashmedia.com renewal — March", "", "Mother's maiden name? Gonzalez"],
  ["Google / Gmail", "Paul Cruz", U, "accounts.google.com", "doggy123", "THE main login — everything recovers here", "4829-1730, 9174-2206, 3318-0457", "First pet? Maggie"],
  ["Honeybook", "Paul Cruz", U, "honeybook.com", "bookings2022", "Client contracts + invoices", "", ""],
  ["Instagram", "Paul Cruz", "@brightflashpaul", "instagram.com", "sanantonio210", "Portfolio account, 12k followers", "", ""],
  ["Intuit QuickBooks", "Paul Cruz", U, "quickbooks.intuit.com", "Taxes&Books2020", "Bookkeeping — accountant has her own login", "", "First car? 1998 Silverado"],
  ["JPMorgan Chase", "Paul Cruz", "pcruz_biz", "chase.com", "Maggie&Me2018", "Old business card — maybe closed?", "", "City of birth? San Antonio"],
  ["KEH Camera", "Paul Cruz", U, "keh.com", "usedgear123", "Trade-in account", "", ""],
  ["LinkedIn", "Paul Cruz", U, "linkedin.com", "paulcruzphoto1", "", "", ""],
  ["Mailchimp", "Paul Cruz", U, "mailchimp.com", "newsletter2019", "Monthly client newsletter", "", ""],
  ["Netflix", "Paul Cruz", U, "netflix.com", "doggy123", "Shared with the kids", "", ""],
  ["Office 365", "Paul Cruz", U, "office.com", "Word&Excel2020", "Studio documents", "", ""],
  ["PayPal", "Paul Cruz", U, "paypal.com", "PayMe$1968", "Client deposits land here", "6603-1948, 2271-8830", "Mother's maiden name? Gonzalez"],
  ["Pixieset", "Paul Cruz", U, "pixieset.com", "galleries2021", "Client photo delivery", "", ""],
  ["PPA", "Paul Cruz", U, "ppa.com", "photographer1968", "Professional Photographers of America — insurance rides this", "", ""],
  ["Quest Diagnostics", "Paul Cruz", "pcruz1968", "questdiagnostics.com", "health2023", "Lab portal", "", "First pet? Maggie"],
  ["Reddit", "Paul Cruz", "u/brightflashpaul", "reddit.com", "lurker123", "r/WeddingPhotography mostly", "", ""],
  ["ShootProof", "Paul Cruz", U, "shootproof.com", "proofing2018", "Older galleries — pre-Pixieset", "", ""],
  ["SmugMug", "Paul Cruz", U, "smugmug.com", "smugpaul2016", "Legacy portfolio — still billed?", "", ""],
  ["Spotify", "Paul Cruz", U, "spotify.com", "musicman1968", "Reception playlists", "", ""],
  ["Squarespace", "Paul Cruz", U, "squarespace.com", "website2022", "brightflashmedia.com site", "", "High school? Jefferson High"],
  ["Stripe", "Paul Cruz", U, "dashboard.stripe.com", "Xk4$nRb7@wQj2#Ty", "Online booking payments — Jason set this up", "0912-7734, 8845-1067", ""],
  ["T-Mobile", "Paul Cruz", "pcruz210", "t-mobile.com", "sanantonio210", "Studio hotspot line", "", "City of birth? San Antonio"],
  ["USPS", "Paul Cruz", U, "usps.com", "stamps2019", "Informed delivery + print mailers", "", ""],
  ["Venmo", "Paul Cruz", "@Paul-Cruz-Photo", "venmo.com", "quickpay1968", "Second shooters get paid here", "", ""],
  ["Vimeo", "Paul Cruz", U, "vimeo.com", "weddingfilms2020", "Highlight reels", "", ""],
  ["WeTransfer", "Paul Cruz", U, "wetransfer.com", "bigfiles123", "RAW handoffs to the retoucher", "", ""],
  ["Wix", "Paul Cruz", U, "wix.com", "oldsite2015", "The OLD site — cancel this?", "", ""],
  ["X (Twitter)", "Paul Cruz", "@brightflashsa", "x.com", "tweettweet1968", "Barely used", "", ""],
  ["YouTube", "Paul Cruz", U, "youtube.com", "doggy123", "BTS channel — rides the Google login anyway", "", "First pet? Maggie"],
  ["Zelle", "Paul Cruz", U, "zellepay.com", "Maggie&Me2018", "Through the BofA login", "", ""],
  ["Zoom", "Paul Cruz", U, "zoom.us", "meetings2021", "Client consults", "", ""],
];

const HEADERS = ["Company", "Full name", "Username / ID", "URL / Website", "Password", "Other", "Backup codes", "Security questions"];
// Three letter pages spanning A-Z (ruling: "3 letter pages, a-z, alphabetical").
const PAGES = [
  { name: "A-I", test: (c) => /^[A-I]/i.test(c) },
  { name: "J-R", test: (c) => /^[J-R]/i.test(c) },
  { name: "S-Z", test: (c) => /^[S-Z]/i.test(c) },
];

// ---- minimal xlsx writer (inline strings, STORE-method zip) ----------------------------------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colLetter = (i) => String.fromCharCode(65 + i); // 8 columns — A..H, single letters suffice

function sheetXml(rows) {
  const widths = [22, 16, 34, 26, 22, 42, 32, 36];
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const cell = (r, c, v, style) =>
    v === "" ? "" : `<c r="${colLetter(c)}${r}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  const head = `<row r="1">${HEADERS.map((h, c) => cell(1, c, h, 1)).join("")}</row>`;
  const body = rows.map((row, ri) => `<row r="${ri + 2}">${row.map((v, c) => cell(ri + 2, c, v)).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${head}${body}</sheetData></worksheet>`;
}

const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${PAGES.map(
  (p, i) => `<sheet name="${p.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
).join("")}</sheets></workbook>`;

const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${PAGES.map(
  (_p, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
).join("")}<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${PAGES.map(
  (_p, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

// ---- STORE-method zip (no compression — simplest correct container) ---------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const u16 = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff]);
const u32 = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const crc = crc32(data);
    // Fixed DOS timestamp (2026-08-06 12:00) — determinism over truth; a clock here would make
    // regeneration non-byte-identical for no benefit.
    const dosTime = u16((12 << 11) | 0);
    const dosDate = u16(((2026 - 1980) << 9) | (8 << 5) | 6);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), dosTime, dosDate,
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf, data,
    ]);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), dosTime, dosDate,
        u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset), nameBuf,
      ])
    );
    locals.push(local);
    offset += local.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBuf.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ---- assemble --------------------------------------------------------------------------------
const sorted = [...ROWS].sort((a, b) => a[0].localeCompare(b[0], "en"));
const entries = [
  ["[Content_Types].xml", contentTypes],
  ["_rels/.rels", rootRels],
  ["xl/workbook.xml", workbookXml],
  ["xl/_rels/workbook.xml.rels", workbookRels],
  ["xl/styles.xml", stylesXml],
  ...PAGES.map((p, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sorted.filter((r) => p.test(r[0])))]),
];
fs.writeFileSync(OUT, zip(entries));

// self-check: every row landed on exactly one page, none dropped
const placed = PAGES.reduce((n, p) => n + sorted.filter((r) => p.test(r[0])).length, 0);
if (placed !== sorted.length) throw new Error(`page split dropped rows: ${placed}/${sorted.length}`);
console.log(`OK wrote ${path.basename(OUT)} — ${sorted.length} entries across ${PAGES.map((p) => p.name).join(" / ")}`);
console.log(`   pages: ${PAGES.map((p) => `${p.name}=${sorted.filter((r) => p.test(r[0])).length}`).join("  ")}`);
