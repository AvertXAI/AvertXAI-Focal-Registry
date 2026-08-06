// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: APPLICATION-BOOT PROOF — the one test that creates its database the way the APP
//              creates it (firstrun's createOrgDatabase: initDb + ensureAllModuleSchemas + the
//              seed transaction), with NO hand-rolled ensures anywhere.
//
//              WHY IT EXISTS: on 08-05 every harness in the scratchpad called
//              ensureTimeTrackerSchema / ensureEmployeesSchema itself — hand-building precisely
//              the precondition first-run omitted — so 28 of 28 assertions were green while the
//              seed button was broken on device, and TimeTracker's project list threw
//              "no such table: employee_entries" on any fresh org opened TimeTracker-first
//              (proven by execution 08-06). This file FAILS on that old code and PASSES on the
//              fixed code, because it exercises the app's own creation path and nothing else.
//
//              Standalone developer harness (scan/crash-test.ts precedent) — imported by no
//              runtime module, excluded from the shipped bundle by never being referenced. Run:
//   npx esbuild electron/core/services/devseed/boot-proof.ts --bundle --platform=node
//     --format=cjs --external:electron --external:better-sqlite3-multiple-ciphers --external:argon2
//     --outfile=%TEMP%/boot-proof.cjs
//   ELECTRON_RUN_AS_NODE=1 npx electron %TEMP%/boot-proof.cjs   (NODE_PATH=<repo>/node_modules)
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/devseed/boot-proof.ts
//------------------------------------------------------------
import { getDb } from "../db";
import { createOrgDatabase } from "../firstrun";
import { listProjects, groupTotals } from "../timetracker/projects";
import { LICENSE_KEYS, getStoredLicenseKey, setLicenseKey } from "../licensing";
import { createPerson } from "../employees/people";
import { generateDemo, purgeDemo, demoStatus } from "./index";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, extra = ""): void => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);
};

// ---- 1 · THE APP'S OWN CREATION PATH — no manual ensures, ever, anywhere in this file.
const ORG = "org-boot-proof";
createOrgDatabase(":memory:", ORG, "Boot Proof Org", {
  machine_guid: null,
  hardware_uuid: null,
  machine_name: null,
});
const db = getDb() as never;

// ---- 2 · THE STEP-0 BUG, against the fixed path: TimeTracker opened FIRST must not throw.
try {
  listProjects(db, ORG);
  groupTotals(db, ORG);
  ok("fresh org, TimeTracker-first: project list and group totals read clean", true);
} catch (e) {
  ok("fresh org, TimeTracker-first: project list and group totals read clean", false, e instanceof Error ? e.message : String(e));
}
const tableCount = (
  (db as { prepare: (s: string) => { get: () => { n: number } } })
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
    .get()
).n;
ok("org creation built the full schema, not four shell tables", tableCount > 20, `${tableCount} tables`);

// ---- 3 · a REAL row that must survive the purge, created before any seed exists.
const real = createPerson(db, ORG, {
  name: "REAL PERSON", email: null, phone: null, role: null, defaultRate: 99, notes: null,
  streetAddress: null, city: null, state: null, zip: null, ssn: null,
  defaultPayType: null, defaultProjectId: null, defaultProjectName: null,
});
// …and a pre-existing licence the purge must restore: the user "owns" a PRO key.
setLicenseKey(db, LICENSE_KEYS.PRO[0]);

const count = (table: string): number =>
  (
    (db as { prepare: (s: string) => { get: () => { n: number } } })
      .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
      .get()
  ).n;

// ---- 4 · refusals write NOTHING — wrong key, then an insufficient (PRO) key.
const beforePeople = count("employee_people");
const wrong = generateDemo(db, ORG, "AAAA-BBBB-CCCC-DDDD");
ok("an unrecognised key refuses with a plain sentence", !wrong.ok && /isn't recognised/.test(wrong.error ?? ""), wrong.error);
const malformed = generateDemo(db, ORG, "not-a-key");
ok("a malformed key refuses with the shape named", !malformed.ok && /XXXX-XXXX/.test(malformed.error ?? ""), malformed.error);
const pro = generateDemo(db, ORG, LICENSE_KEYS.PRO[0]);
ok("a PRO key refuses — 20 people exceed its cap", !pro.ok && /people/.test(pro.error ?? ""), pro.error);
ok("...and every refusal wrote nothing", count("employee_people") === beforePeople && count("timetracker_projects") === 0);
ok("...and the stored licence is untouched", getStoredLicenseKey(db) === LICENSE_KEYS.PRO[0]);

// ---- 5 · the BUSINESS key seeds the full dataset through the supported activation path.
const r = generateDemo(db, ORG, LICENSE_KEYS.BUSINESS[0]);
ok("BUSINESS key: generate succeeds", r.ok === true, r.error ?? "");
ok("10 projects", r.projects === 10, String(r.projects));
ok("20 people", r.people === 20, String(r.people));
ok("entries landed", (r.entries ?? 0) >= 60, String(r.entries));
ok("activation went through setLicenseKey", getStoredLicenseKey(db) === LICENSE_KEYS.BUSINESS[0]);

const projects = listProjects(db, ORG) as Array<{ status: string; contract_amount: number | null; total_costs: number; total_seconds: number }>;
ok("5 current / 5 closed", projects.filter((p) => p.status === "active").length === 10 - projects.filter((p) => p.status === "done").length && projects.filter((p) => p.status === "done").length === 5,
  projects.map((p) => p.status).join(","));
ok("contracts span $2,000–$25,000", projects.every((p) => (p.contract_amount ?? 0) >= 2000 && (p.contract_amount ?? 0) <= 25000));
ok("employee money reached project COSTS", projects.some((p) => p.total_costs > 0));
ok("employee hours reached the rail totals", projects.some((p) => p.total_seconds > 0));
ok("itemized rows landed (2-7 per project)", count("timetracker_project_items") >= 20);
ok("memberships, tasks, payments, corrections all landed",
  count("timetracker_project_employees") > 0 && count("employee_tasks") === 8 && count("employee_payments") > 0 && count("employee_adjustments") === 4);

// ---- 6 · the SYMMETRIC purge: rows gone, real row kept, licence restored to the PRIOR key.
const p = purgeDemo(db);
ok("purge succeeds", p.ok === true, p.error ?? "");
ok("every seeded project is gone", count("timetracker_projects") === 0);
ok("every seeded entry, task, payment, correction is gone",
  count("employee_entries") === 0 && count("employee_tasks") === 0 && count("employee_payments") === 0 && count("employee_adjustments") === 0);
ok("THE REAL PERSON SURVIVED", count("employee_people") === 1 &&
  ((db as { prepare: (s: string) => { get: (id: number) => { name: string } | undefined } })
    .prepare("SELECT name FROM employee_people WHERE id = ?").get(real.id))?.name === "REAL PERSON");
ok("THE LICENCE RETURNED TO THE USER'S OWN KEY", getStoredLicenseKey(db) === LICENSE_KEYS.PRO[0]);
ok("status is clear again", demoStatus(db).present === false);

// ---- 7 · the no-key case: clear the licence, seed, purge — the restore must CLEAR, not store junk.
setLicenseKey(db, "");
ok("baseline: no key held", getStoredLicenseKey(db) === null);
ok("re-seed after purge works", generateDemo(db, ORG, LICENSE_KEYS.BUSINESS[0]).ok === true);
ok("purge again", purgeDemo(db).ok === true);
ok("a never-paid user is NOT left on Business — the licence cleared", getStoredLicenseKey(db) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
