// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: DEMO DATA — four projects, eight people, their time, their corrections, project
//              itemized rows and hard costs. Exists so the money surfaces can be judged with
//              realistic numbers in them instead of every card reading $0.00.
//
//              THE PURGE IS EXACT, NOT A TRUNCATE. Every id this writes is recorded in
//              app_settings under DEMO_KEY, and purge deletes those rows and only those rows. It
//              never empties a table, so demo data can sit beside real work and be removed without
//              touching it. If the ledger is lost the purge does nothing rather than guessing —
//              deleting rows it cannot prove it created is exactly the behaviour a data-loss guard
//              exists to prevent.
//
//              Everything is written through the REAL services, never raw INSERTs, so the demo
//              exercises the same validators, CHECK constraints and money rules the app uses. If a
//              rule would reject it in normal use, it is rejected here too.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/devseed/index.ts
//------------------------------------------------------------
import type Database from "better-sqlite3-multiple-ciphers";
import { createPerson } from "../employees/people";
import { createEntry } from "../employees/entries";
import { createHoursAdjustment, createAmountAdjustment } from "../employees/adjustments";
import { createProject } from "../timetracker/projects";
import { addProjectItem, addProjectEmployee } from "../timetracker/projectFinancials";
import { setCapsSuspended } from "../timetracker/license";

type Db = Database.Database;

const DEMO_KEY = "devseed_ledger";

interface Ledger {
  projects: number[];
  people: number[];
  entries: number[];
  adjustments: number[];
  items: number[];
  members: number[];
  costs: number[];
  clients: number[];
  groups: number[];
}

const EMPTY: Ledger = { projects: [], people: [], entries: [], adjustments: [], items: [], members: [], costs: [], clients: [], groups: [] };

function readLedger(db: Db): Ledger {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(DEMO_KEY) as { value: string } | undefined;
  if (!row) return { ...EMPTY };
  try {
    return { ...EMPTY, ...(JSON.parse(row.value) as Partial<Ledger>) };
  } catch {
    return { ...EMPTY };
  }
}

function writeLedger(db: Db, l: Ledger): void {
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(DEMO_KEY, JSON.stringify(l));
}

export function demoStatus(db: Db): { present: boolean; projects: number; people: number } {
  const l = readLedger(db);
  return { present: l.projects.length > 0 || l.people.length > 0, projects: l.projects.length, people: l.people.length };
}

/** N days ago as a local YYYY-MM-DD — the work-date format entries require. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PROJECTS = [
  { name: "Rodriguez Wedding", client: "Ana Rodriguez", contracted: 8500, budget: 2600, group: "Event Photography", icon: "💍" },
  { name: "Casa Sabor — Menu Shoot", client: "Casa Sabor", contracted: 5200, budget: 1400, group: "Commercial", icon: "📷" },
  { name: "Artists Thrive Summit", client: "Thrive Foundation", contracted: 9800, budget: 3200, group: "Event Photography", icon: "🎥" },
  { name: "Jax's Collectibles Refresh", client: "Jax Ruiz", contracted: 6400, budget: 1800, group: "Commercial", icon: "📦" },
];

const PEOPLE = [
  { name: "Maria Reyes", role: "Retoucher", rate: 38, pay: "hourly" as const },
  { name: "Paul Cruz", role: "Second Shooter", rate: 55, pay: "hourly" as const },
  { name: "Dana Whitfield", role: "Digital Tech", rate: 42, pay: "hourly" as const },
  { name: "Samir Haddad", role: "Lighting Assistant", rate: 30, pay: "hourly" as const },
  { name: "Elena Vasquez", role: "Video Operator", rate: 65, pay: "hourly" as const },
  { name: "Tom Byrne", role: "Album Designer", rate: 450, pay: "job" as const },
  { name: "Priya Nair", role: "Culling Specialist", rate: 28, pay: "hourly" as const },
  { name: "Chris Okafor", role: "Behind-the-scenes", rate: 0, pay: "donated" as const },
];

/** Itemized purchases — between four and eight land on each project. */
const ITEMS = [
  { qty: 2, description: "Battery rentals — full day", amount: 160 },
  { qty: 1, description: "Second shooter — ceremony", amount: 350 },
  { qty: 4, description: "CFexpress cards — 128 GB", amount: 520 },
  { qty: 1, description: "Album print run — deposit", amount: 640 },
  { qty: 3, description: "Lighting kit rental", amount: 285 },
  { qty: 1, description: "Venue parking + permits", amount: 95 },
  { qty: 2, description: "Backup drive — 4 TB", amount: 310 },
  { qty: 1, description: "Retouching overflow — contract", amount: 480 },
];

const COSTS = [
  { label: "Travel — mileage", category: "Travel", amount: 148.5 },
  { label: "Catering — crew", category: "Meals", amount: 212.0 },
  { label: "Insurance rider — event", category: "Insurance", amount: 175.0 },
];

/**
 * Writes the demo set. Refuses if one is already present — two overlapping demo sets would make the
 * purge ambiguous about what it owns, which is the one thing this must never be.
 */
export function generateDemo(db: Db, orgId: string): { ok: boolean; error?: string; projects?: number; people?: number } {
  if (demoStatus(db).present) {
    return { ok: false, error: "Demo data is already loaded. Purge it first if you want a fresh set." };
  }
  const l: Ledger = { ...EMPTY };
  const before = {
    clients: db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM timetracker_clients").get() as { m: number },
    groups: db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM timetracker_groups").get() as { m: number },
    costs: db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM timetracker_costs").get() as { m: number },
  };

  // The demo is 4 projects and 8 people; Free allows 3 and 5. Suspended for the write and ALWAYS
  // restored below, so a throw mid-generate cannot leave a user uncapped.
  setCapsSuspended(true);
  try {
    db.transaction(() => {
      // ---- projects, each with a group and real money on it
      const made = PROJECTS.map((p, i) =>
        createProject(db, orgId, {
          name: p.name,
          clientName: p.client,
          contactPhone: `210-555-0${100 + i}`,
          email: `${p.client.split(" ")[0].toLowerCase()}@example.com`,
          // contract_amount is only written for a CONTRACT project (projects.ts drops it
          // otherwise), so the demo's agreed amounts need this rate type to survive the write.
          rateType: "contract",
          hourlyRate: null,
          color: ["#2f6df6", "#16a34a", "#a855f7", "#f97316"][i],
          status: "active",
          groupId: null,
          newGroupName: p.group,
          newGroupColor: null,
          newGroupIcon: p.icon,
          contractAmount: p.contracted,
          contractDescription: "",
          contractSourcePath: null,
          contractKind: "paid",
          targetHours: null,
          spendBudget: p.budget,
          phoneExt: null,
        } as Parameters<typeof createProject>[2])
      );
      l.projects = made.map((m) => m.id);

      // ---- people
      const staff = PEOPLE.map((p, i) =>
        createPerson(db, orgId, {
          name: p.name,
          email: `${p.name.split(" ")[0].toLowerCase()}@example.com`,
          phone: `210-555-1${String(100 + i).slice(-3)}`,
          role: p.role,
          defaultRate: p.rate,
          notes: null,
          streetAddress: null,
          city: "San Antonio",
          state: "TX",
          zip: "78228",
          ssn: null,
          defaultPayType: p.pay,
          defaultProjectId: made[i % made.length].id,
          defaultProjectName: made[i % made.length].name,
        })
      );
      l.people = staff.map((s) => s.id);

      // ---- roster + itemized rows + hard costs, four to eight items per project
      made.forEach((proj, pi) => {
        for (let k = 0; k < 2; k++) {
          const person = staff[(pi * 2 + k) % staff.length];
          l.members.push(addProjectEmployee(db, orgId, proj.id, person.id).id);
        }
        const count = 4 + (pi % 5); // 4, 5, 6, 7 across the four projects
        for (let k = 0; k < count; k++) {
          const it = ITEMS[(pi * 2 + k) % ITEMS.length];
          l.items.push(addProjectItem(db, orgId, { projectId: proj.id, ...it }).id);
        }
        const c = COSTS[pi % COSTS.length];
        db.prepare(
          `INSERT INTO timetracker_costs (uuid, org_id, project_id, label, category, amount, recurrence, created_at)
           VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, 'once', CURRENT_TIMESTAMP)`
        ).run(orgId, proj.id, c.label, c.category, c.amount);
      });

      // ---- time. Spread across the last three weeks so the range filters have something to show.
      staff.forEach((person, si) => {
        const proj = made[si % made.length];
        const spec = PEOPLE[si];
        for (let k = 0; k < 3; k++) {
          // Only "job" appears in PEOPLE; entries.ts requires a flat amount for job/task.
          const flat = spec.pay === "job";
          l.entries.push(
            createEntry(db, orgId, {
              employeeId: person.id,
              projectId: proj.id,
              projectName: proj.name,
              taskId: null,
              payType: spec.pay,
              hoursWorked: [3.5, 6.25, 4][k] + si * 0.25,
              rateAtEntry: spec.rate,
              flatAmount: flat ? spec.rate : null,
              workedOn: daysAgo(2 + si * 2 + k * 5),
              note: ["ceremony coverage", "culling pass", "retouch round 2"][k],
            }).id
          );
        }
      });

      // ---- a correction of each kind, so the adjustment surfaces are not empty either
      l.adjustments.push(
        createHoursAdjustment(db, orgId, {
          employeeId: staff[0].id,
          projectId: made[0].id,
          projectName: made[0].name,
          deltaMinutes: 90,
          rateAtEntry: PEOPLE[0].rate,
          note: "missed the rehearsal hour",
        }).id
      );
      l.adjustments.push(
        createAmountAdjustment(db, orgId, {
          employeeId: staff[1].id,
          projectId: made[1].id,
          projectName: made[1].name,
          deltaAmount: -75,
          note: "advance already paid in cash",
        }).id
      );

      // Rows created as a SIDE EFFECT of the services above — recorded by id range so the purge can
      // take them too. createProject mints a client and may mint a group; neither returns its id.
      l.clients = (
        db.prepare("SELECT id FROM timetracker_clients WHERE id > ?").all(before.clients.m) as { id: number }[]
      ).map((r) => r.id);
      l.groups = (
        db.prepare("SELECT id FROM timetracker_groups WHERE id > ?").all(before.groups.m) as { id: number }[]
      ).map((r) => r.id);
      l.costs = (
        db.prepare("SELECT id FROM timetracker_costs WHERE id > ?").all(before.costs.m) as { id: number }[]
      ).map((r) => r.id);

      writeLedger(db, l);
    })();
    return { ok: true, projects: l.projects.length, people: l.people.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    setCapsSuspended(false);
  }
}

/**
 * Removes exactly what generateDemo created, in dependency order. HARD deletes — this is demo data,
 * and leaving soft-deleted rows behind would keep polluting the totals the demo exists to test.
 * Anything not in the ledger is untouched: real work created alongside the demo survives.
 */
export function purgeDemo(db: Db): { ok: boolean; error?: string; removed?: number } {
  const l = readLedger(db);
  if (!demoStatus(db).present) return { ok: false, error: "There is no demo data recorded to remove." };
  const del = (table: string, ids: number[]): number => {
    if (ids.length === 0) return 0;
    const stmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
    let n = 0;
    for (const id of ids) n += stmt.run(id).changes;
    return n;
  };
  try {
    let removed = 0;
    db.transaction(() => {
      // Children first — foreign keys are ON, so a project cannot go before what points at it.
      removed += del("employee_adjustments", l.adjustments);
      removed += del("employee_entries", l.entries);
      removed += del("timetracker_project_items", l.items);
      removed += del("timetracker_project_employees", l.members);
      removed += del("timetracker_costs", l.costs);
      removed += del("employee_people", l.people);
      removed += del("timetracker_projects", l.projects);
      removed += del("timetracker_groups", l.groups);
      removed += del("timetracker_clients", l.clients);
      db.prepare("DELETE FROM app_settings WHERE key = ?").run(DEMO_KEY);
    })();
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
