// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: SEED DATA — a full realistic dataset for judging every money surface at once:
//              10 projects (5 current, 5 closed), 20 employees across all four pay types, entries
//              spread over the year, tasks, corrections, payments, itemized purchases and hard
//              costs. REBUILT 2026-08-06 after the first version shipped two design faults:
//              it assumed schemas a fresh org had never created (fixed at the root by
//              ensureAllModuleSchemas — see db/allSchemas.ts), and it switched the tier caps off
//              through a back door instead of clearing them the way a customer would.
//
//              THE LICENCE CONTRACT (Jason's ruling, 08-05/08-06):
//              · The caller SUPPLIES a licence key — nothing is hardcoded here and nothing
//                activates silently. The key goes through setLicenseKey, the same function the
//                Settings screen calls, and tier resolution is unmemoised, so the caps clear
//                immediately and legitimately. A wrong or insufficient key refuses with a plain
//                sentence and WRITES NOTHING.
//              · The purge is SYMMETRIC including the licence: the key held BEFORE seeding is
//                recorded in the ledger and restored on purge — a user who never bought a tier is
//                never left silently on Business.
//
//              THE PURGE IS EXACT, NOT A TRUNCATE. Every id this writes is recorded in
//              app_settings under DEMO_KEY, and purge deletes those rows and only those rows —
//              real work created beside the demo survives, proven by execution in boot-proof.ts.
//
//              Everything money-bearing is written through the REAL services, never raw INSERTs,
//              so the demo exercises the same validators, CHECK constraints and money rules the
//              app uses (ruling 2). "Random" variation comes from a small seeded generator, so the
//              dataset is varied on screen but reproducible under proof.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/devseed/index.ts
//------------------------------------------------------------
import type Database from "better-sqlite3-multiple-ciphers";
import { CAPS, getStoredLicenseKey, normalizeKey, setLicenseKey, tierOfKey } from "../licensing";
import { createPerson } from "../employees/people";
import { createEntry } from "../employees/entries";
import { createTask, setTaskDone } from "../employees/tasks";
import { recordPayment } from "../employees/payments";
import { createHoursAdjustment, createAmountAdjustment } from "../employees/adjustments";
import { createProject } from "../timetracker/projects";
import * as costs from "../timetracker/costs";
import { addProjectItem, addProjectEmployee } from "../timetracker/projectFinancials";

type Db = Database.Database;

const DEMO_KEY = "devseed_ledger";

interface Ledger {
  projects: number[];
  people: number[];
  entries: number[];
  tasks: number[];
  payments: number[];
  adjustments: number[];
  items: number[];
  members: number[];
  costs: number[];
  clients: number[];
  groups: number[];
  /** The licence key held BEFORE the seed activated one — restored verbatim on purge. null = there
      was no key, and purge restores that too (clears). Symmetry is the point (ruling 5). */
  priorLicenseKey: string | null;
}

const EMPTY: Omit<Ledger, "priorLicenseKey"> = {
  projects: [], people: [], entries: [], tasks: [], payments: [], adjustments: [],
  items: [], members: [], costs: [], clients: [], groups: [],
};

function readLedger(db: Db): Ledger | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(DEMO_KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    return { ...EMPTY, priorLicenseKey: null, ...(JSON.parse(row.value) as Partial<Ledger>) };
  } catch {
    return null;
  }
}

function writeLedger(db: Db, l: Ledger): void {
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(DEMO_KEY, JSON.stringify(l));
}

export function demoStatus(db: Db): { present: boolean; projects: number; people: number } {
  const l = readLedger(db);
  return {
    present: l !== null && (l.projects.length > 0 || l.people.length > 0),
    projects: l?.projects.length ?? 0,
    people: l?.people.length ?? 0,
  };
}

/** N days ago as a local YYYY-MM-DD — the work-date format entries require. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Tiny deterministic PRNG (mulberry32). Varied like random data, reproducible under proof. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the dataset ------------------------------------------------------------------------------

/** 10 projects — 5 current ('active'), 5 closed ('done' — the only closed-shaped value the status
    CHECK allows; there is no 'closed'). Contracts span the ruled $2,000–$25,000. */
const PROJECTS: Array<{ name: string; client: string; contracted: number; budget: number; group: string; icon: string; status: "active" | "done" }> = [
  { name: "Rodriguez Wedding", client: "Ana Rodriguez", contracted: 8500, budget: 2600, group: "Weddings", icon: "💍", status: "active" },
  { name: "Casa Sabor — Menu Shoot", client: "Casa Sabor", contracted: 5200, budget: 1400, group: "Commercial", icon: "📷", status: "active" },
  { name: "Artists Thrive Summit", client: "Thrive Foundation", contracted: 24800, budget: 7200, group: "Events", icon: "🎥", status: "active" },
  { name: "Jax's Collectibles Refresh", client: "Jax Ruiz", contracted: 6400, budget: 1800, group: "Commercial", icon: "📦", status: "active" },
  { name: "Bexar County Quinceañera", client: "Familia Delgado", contracted: 4300, budget: 1200, group: "Events", icon: "🎨", status: "active" },
  { name: "Hill Country Elopement", client: "Sam Pierce", contracted: 2000, budget: 500, group: "Weddings", icon: "💍", status: "done" },
  { name: "Riverwalk Realty Headshots", client: "Riverwalk Realty", contracted: 3600, budget: 900, group: "Commercial", icon: "📷", status: "done" },
  { name: "Mission Trail Marathon", client: "SA Runners Club", contracted: 7800, budget: 2100, group: "Events", icon: "🎥", status: "done" },
  { name: "Vasquez Anniversary Gala", client: "Vasquez Family", contracted: 12500, budget: 3800, group: "Events", icon: "🧾", status: "done" },
  { name: "Pearl District Lookbook", client: "Pearl Collective", contracted: 18900, budget: 5600, group: "Commercial", icon: "⭐", status: "done" },
];

/** 20 people across all four pay types, rates $0–$85 hourly and flat figures for job/task. */
const PEOPLE: Array<{ name: string; role: string; rate: number; pay: "hourly" | "job" | "task" | "donated" }> = [
  { name: "Maria Reyes", role: "Retoucher", rate: 38, pay: "hourly" },
  { name: "Paul Cruz", role: "Second Shooter", rate: 55, pay: "hourly" },
  { name: "Dana Whitfield", role: "Digital Tech", rate: 42, pay: "hourly" },
  { name: "Samir Haddad", role: "Lighting Assistant", rate: 30, pay: "hourly" },
  { name: "Elena Vasquez", role: "Video Operator", rate: 65, pay: "hourly" },
  { name: "Tom Byrne", role: "Album Designer", rate: 450, pay: "job" },
  { name: "Priya Nair", role: "Culling Specialist", rate: 28, pay: "hourly" },
  { name: "Chris Okafor", role: "Behind-the-scenes", rate: 0, pay: "donated" },
  { name: "Lena Fischer", role: "Drone Operator", rate: 85, pay: "hourly" },
  { name: "Marco Trevino", role: "Grip", rate: 24, pay: "hourly" },
  { name: "Aisha Bell", role: "Makeup Artist", rate: 60, pay: "hourly" },
  { name: "Jon Park", role: "Sound Tech", rate: 48, pay: "hourly" },
  { name: "Rosa Delgado", role: "Event Coordinator", rate: 35, pay: "hourly" },
  { name: "Felix Grant", role: "Print Fulfilment", rate: 120, pay: "task" },
  { name: "Nina Kowalski", role: "Colourist", rate: 52, pay: "hourly" },
  { name: "Omar Silva", role: "Assistant Editor", rate: 33, pay: "hourly" },
  { name: "Grace Liu", role: "Studio Manager", rate: 45, pay: "hourly" },
  { name: "Diego Fuentes", role: "Set Builder", rate: 640, pay: "job" },
  { name: "Tasha Wright", role: "Intern", rate: 18, pay: "hourly" },
  { name: "Ben Navarro", role: "Community Volunteer", rate: 0, pay: "donated" },
];

/** Itemized purchase pool — amounts are LINE totals, per the itemize contract. */
const ITEMS: Array<{ qty: number; description: string; amount: number }> = [
  { qty: 2, description: "Battery rentals — full day", amount: 160 },
  { qty: 1, description: "Second shooter — ceremony", amount: 350 },
  { qty: 4, description: "CFexpress cards — 128 GB", amount: 520 },
  { qty: 1, description: "Album print run — deposit", amount: 640 },
  { qty: 3, description: "Lighting kit rental", amount: 285 },
  { qty: 1, description: "Venue parking + permits", amount: 95 },
  { qty: 2, description: "Backup drives — 4 TB", amount: 310 },
  { qty: 1, description: "Retouching overflow — contract", amount: 480 },
  { qty: 6, description: "Sandbags + stands", amount: 72 },
  { qty: 1, description: "Drone insurance rider", amount: 210 },
  { qty: 2, description: "Wardrobe steamer rental", amount: 58 },
  { qty: 1, description: "Location scouting mileage", amount: 132 },
];

const COST_LINES: Array<{ label: string; category: string; amount: number }> = [
  { label: "Travel — mileage", category: "Travel", amount: 148.5 },
  { label: "Catering — crew", category: "Meals", amount: 212 },
  { label: "Event insurance rider", category: "Insurance", amount: 175 },
  { label: "Gallery hosting — annual", category: "Software", amount: 96 },
];

const TASKS: string[] = [
  "Culling — first pass", "Retouch — hero selects", "Album layout draft", "Highlight reel cut",
  "Drone establishing shots", "Client gallery upload", "Print order fulfilment", "BTS recap edit",
];

// ---- generate ---------------------------------------------------------------------------------

export interface GenerateResult {
  ok: boolean;
  error?: string;
  projects?: number;
  people?: number;
  entries?: number;
}

/**
 * Loads the dataset. `rawKey` is the licence key the USER typed into the prompt — validated and
 * activated through the supported path before anything else happens. Refusals write nothing.
 */
export function generateDemo(db: Db, orgId: string, rawKey: string): GenerateResult {
  if (demoStatus(db).present) {
    return { ok: false, error: "Seed data is already loaded. Purge it first if you want a fresh set." };
  }

  // ---- the licence gate, BEFORE any write (ruling 4) ----
  const key = normalizeKey(rawKey ?? "");
  if (!key) {
    return { ok: false, error: "That doesn't look like a licence key — keys are XXXX-XXXX-XXXX-XXXX. Nothing was loaded." };
  }
  const keyTier = tierOfKey(key);
  if (!keyTier) {
    return { ok: false, error: "That key isn't recognised. Nothing was loaded." };
  }
  // The dataset needs 10 more projects and 20 more people than whatever already exists. Checked
  // against the KEY'S tier before activation, so an insufficient key is never stored.
  const caps = CAPS[keyTier];
  const haveProjects = (db.prepare("SELECT COUNT(*) AS n FROM timetracker_projects WHERE archived_at IS NULL").get() as { n: number }).n;
  const havePeople = (db.prepare("SELECT COUNT(*) AS n FROM employee_people WHERE archived_at IS NULL").get() as { n: number }).n;
  if (caps.projects !== null && haveProjects + PROJECTS.length > caps.projects) {
    return { ok: false, error: `That key unlocks ${caps.projects} projects and the seed needs ${PROJECTS.length} — use a Business key. Nothing was loaded.` };
  }
  if (caps.people !== null && havePeople + PEOPLE.length > caps.people) {
    return { ok: false, error: `That key unlocks ${caps.people} people and the seed needs ${PEOPLE.length} — use a Business key. Nothing was loaded.` };
  }

  // ---- activation, through the same function the Settings screen calls ----
  const priorLicenseKey = getStoredLicenseKey(db);
  setLicenseKey(db, key);

  const l: Ledger = { ...EMPTY, projects: [], priorLicenseKey };
  const rand = prng(0x08062026);
  const before = {
    clients: (db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM timetracker_clients").get() as { m: number }).m,
    groups: (db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM timetracker_groups").get() as { m: number }).m,
  };

  try {
    db.transaction(() => {
      // ---- 10 projects. Contract amounts persist only on rate_type 'contract' + kind 'paid'
      // (projects.ts drops them otherwise — the trap that cost a debug cycle on 08-05).
      const groupIconByName = new Map(PROJECTS.map((p) => [p.group, p.icon]));
      const palette = ["#2f6df6", "#16a34a", "#a855f7", "#f97316", "#38bdf8", "#e0574f", "#eab308", "#14b8a6", "#8b9bb4", "#84cc16"];
      const made = PROJECTS.map((p, i) =>
        createProject(db, orgId, {
          name: p.name,
          clientName: p.client,
          contactPhone: `210-555-0${String(100 + i).slice(-3)}`,
          email: `${p.client.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "")}@example.com`,
          rateType: "contract",
          hourlyRate: null,
          color: palette[i % palette.length],
          status: p.status,
          groupId: null,
          newGroupName: p.group,
          newGroupColor: null,
          newGroupIcon: groupIconByName.get(p.group) ?? null,
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

      // ---- 20 people, defaults spread across the CURRENT projects only — a closed project is a
      // poor starting point for new time.
      const current = made.filter((_, i) => PROJECTS[i].status === "active");
      const staff = PEOPLE.map((p, i) => {
        const home = current[i % current.length];
        return createPerson(db, orgId, {
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
          defaultProjectId: home.id,
          defaultProjectName: home.name,
        });
      });
      l.people = staff.map((s) => s.id);

      // ---- tasks — their own records, some done (flat-per-task pay needs a done state).
      const taskRows = TASKS.map((title, i) => {
        const t = createTask(db, orgId, {
          title,
          detail: null,
          employeeId: staff[i % staff.length].id,
          projectId: made[i % made.length].id,
          projectName: made[i % made.length].name,
        });
        if (i % 3 === 0) setTaskDone(db, orgId, t.id, true);
        return t;
      });
      l.tasks = taskRows.map((t) => t.id);

      // ---- roster: 2-4 people per project through the membership table.
      made.forEach((proj, pi) => {
        const count = 2 + (pi % 3);
        for (let k = 0; k < count; k++) {
          const person = staff[(pi * 3 + k * 5) % staff.length];
          const m = addProjectEmployee(db, orgId, proj.id, person.id);
          if (!l.members.includes(m.id)) l.members.push(m.id);
        }
      });

      // ---- itemized purchases: 2-7 rows per project, amounts wobbled ±20% so totals vary.
      made.forEach((proj, pi) => {
        const count = 2 + Math.floor(rand() * 6);
        for (let k = 0; k < count; k++) {
          const base = ITEMS[Math.floor(rand() * ITEMS.length)];
          const wobble = Math.round(base.amount * (0.8 + rand() * 0.4) * 100) / 100;
          l.items.push(addProjectItem(db, orgId, { projectId: proj.id, qty: base.qty, description: base.description, amount: wobble }).id);
        }
        // one hard cost line on most projects, through the real costs service
        if (pi % 4 !== 3) {
          const c = COST_LINES[pi % COST_LINES.length];
          l.costs.push(costs.add(db, orgId, proj.id, { label: c.label, category: c.category, amount: c.amount, recurrence: "once", url: "" }).id);
        }
      });

      // ---- time: 3-6 entries per person across three windows, so weekly / 30-day / year-to-date
      // all read differently. Pay-type rules honoured: flat amount for job/task, null otherwise.
      staff.forEach((person, si) => {
        const spec = PEOPLE[si];
        const isFlat = spec.pay === "job" || spec.pay === "task";
        const n = 3 + Math.floor(rand() * 4);
        for (let k = 0; k < n; k++) {
          const window = k % 3; // 0 = this week, 1 = this month, 2 = earlier in the year
          const day = window === 0 ? 1 + Math.floor(rand() * 6) : window === 1 ? 9 + Math.floor(rand() * 18) : 45 + Math.floor(rand() * 160);
          const proj = made[(si + k) % made.length];
          const task = k === 0 && si < taskRows.length ? taskRows[si] : null;
          l.entries.push(
            createEntry(db, orgId, {
              employeeId: person.id,
              projectId: proj.id,
              projectName: proj.name,
              taskId: task ? task.id : null,
              payType: spec.pay,
              hoursWorked: Math.round((1.5 + rand() * 7) * 4) / 4, // quarter-hour steps, 1.5-8.5h
              rateAtEntry: spec.rate,
              flatAmount: isFlat ? spec.rate : null,
              workedOn: daysAgo(day),
              note: k === 0 ? "seeded — first shift" : null,
            }).id
          );
        }
      });

      // ---- corrections, both kinds — the surfaces that show them must not be empty.
      l.adjustments.push(
        createHoursAdjustment(db, orgId, {
          employeeId: staff[0].id, projectId: made[0].id, projectName: made[0].name,
          deltaMinutes: 90, rateAtEntry: PEOPLE[0].rate, note: "missed the rehearsal hour",
        }).id,
        createHoursAdjustment(db, orgId, {
          employeeId: staff[4].id, projectId: made[2].id, projectName: made[2].name,
          deltaMinutes: -60, rateAtEntry: PEOPLE[4].rate, note: "double-logged setup",
        }).id,
        createAmountAdjustment(db, orgId, {
          employeeId: staff[1].id, projectId: made[1].id, projectName: made[1].name,
          deltaAmount: -75, note: "advance already paid in cash",
        }).id,
        createAmountAdjustment(db, orgId, {
          employeeId: staff[5].id, projectId: made[3].id, projectName: made[3].name,
          deltaAmount: 120, note: "rush surcharge agreed on site",
        }).id
      );

      // ---- payments for roughly half the crew, so Outstanding varies person to person. Donated
      // workers earn nothing and are never paid.
      staff.forEach((person, si) => {
        if (si % 2 === 1 || PEOPLE[si].pay === "donated") return;
        l.payments.push(
          recordPayment(db, orgId, {
            employeeId: person.id,
            amount: Math.round((80 + rand() * 240) * 100) / 100,
            paidOn: daysAgo(3 + Math.floor(rand() * 20)),
            method: si % 4 === 0 ? "Zelle" : "Check",
            reference: null,
            note: "seeded partial payment",
          }).id
        );
      });

      // Side-effect rows (clients, inline-created groups) — captured by id range because the
      // services do not return them.
      l.clients = (db.prepare("SELECT id FROM timetracker_clients WHERE id > ?").all(before.clients) as { id: number }[]).map((r) => r.id);
      l.groups = (db.prepare("SELECT id FROM timetracker_groups WHERE id > ?").all(before.groups) as { id: number }[]).map((r) => r.id);

      writeLedger(db, l);
    })();
    return { ok: true, projects: l.projects.length, people: l.people.length, entries: l.entries.length };
  } catch (e) {
    // The transaction rolled every row back; the licence write happened OUTSIDE it, so honour
    // "a refusal writes nothing" by putting the prior key back.
    try {
      setLicenseKey(db, priorLicenseKey ?? "");
    } catch {
      /* restoring a stored key cannot realistically fail, but a throw here must not mask the cause */
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Removes exactly what generateDemo created, in dependency order, then restores the licence to what
 * it was before seeding. HARD deletes — this is seed data, and leaving soft-deleted rows behind
 * would keep polluting the totals the seed exists to test. Anything not in the ledger is untouched.
 */
export function purgeDemo(db: Db): { ok: boolean; error?: string; removed?: number } {
  const l = readLedger(db);
  if (!l || !demoStatus(db).present) return { ok: false, error: "There is no seed data recorded to remove." };
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
      removed += del("employee_payments", l.payments);
      removed += del("employee_entries", l.entries);
      removed += del("employee_tasks", l.tasks);
      removed += del("timetracker_project_items", l.items);
      removed += del("timetracker_project_employees", l.members);
      removed += del("timetracker_costs", l.costs);
      removed += del("employee_people", l.people);
      removed += del("timetracker_projects", l.projects);
      removed += del("timetracker_groups", l.groups);
      removed += del("timetracker_clients", l.clients);
      db.prepare("DELETE FROM app_settings WHERE key = ?").run(DEMO_KEY);
    })();
    // Licence symmetry (ruling 5): whatever was held before the seed comes back — including
    // "no key at all", which restores as a clear, never as a literal string.
    setLicenseKey(db, l.priorLicenseKey ?? "");
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
