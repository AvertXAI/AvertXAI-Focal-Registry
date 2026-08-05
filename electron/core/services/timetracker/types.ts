// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker service-layer domain types — ported 1:1 from the proven standalone
//              engine's shared/types.ts (adjustment/tombstone ids are now the std uuid column).
//              Renderer-safe copies land in src/shared/types.ts in Phase 2, per the house rule
//              that the renderer never imports from services/.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/types.ts
//------------------------------------------------------------

export type RateType = "hourly" | "contract";
export type ProjectStatus = "active" | "parked" | "done";
export type LedgerAction = "set" | "update";
export type ContractKind = "paid" | "donated";
export type TimeDisplayMode = "elapsed" | "remaining";
export type CostRecurrence = "once" | "monthly" | "yearly";
export type SessionState = "running" | "paused";
export type SidebarSortDir = "asc" | "desc" | "none";

/** Normalised project type for wasted-hours bucketing + tombstones. */
export type ProjectType = "hourly" | "contract-paid" | "contract-donated" | "contract-unpaid";

export interface Cost {
  id: number;
  uuid: string;
  project_id: number;
  label: string;
  category: string;
  amount: number;
  recurrence: CostRecurrence;
  url: string | null;
  created_at: string;
}

export interface CostInput {
  label: string;
  category: string;
  amount: number;
  recurrence: CostRecurrence;
  url: string;
}

/** A selectable break-alert sound — bundled (shipped assets) or user-uploaded (storage-root/sounds + row). */
export interface AlertSound {
  id: string;
  displayName: string;
  isBundled: boolean;
}

/** Raw audio bytes for renderer playback via a Blob URL (CSP stays tight: media-src blob:). */
export interface SoundData {
  mime: string;
  base64: string;
}

export interface Group {
  /** Emoji shown BESIDE the colour dot — added 08-04-2026, never replacing colour.
      Nullable: groups created before that date have none until one is assigned. */
  icon?: string | null;
  id: number;
  uuid: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
}

/** Committed time per group (group_id null = Ungrouped) — saved sessions ± adjustments; live sessions excluded. */
export interface GroupTotalRow {
  group_id: number | null;
  total_seconds: number;
}

export interface Project {
  id: number;
  uuid: string;
  client_id: number;
  name: string;
  color: string;
  status: ProjectStatus;
  rate_type: RateType;
  hourly_rate: number | null;
  priority_order: number;
  created_at: string;
  group_id: number | null;
  contract_amount: number | null;
  /** What the user plans to SPEND hiring/buying. Returned by p.* since 08-04; typed here 08-05. */
  spend_budget: number | null;
  phone_ext: string | null;
  contract_description: string | null;
  contract_file_path: string | null;
  contract_kind: ContractKind | null;
  target_hours: number | null;
  time_display_mode: TimeDisplayMode | null;
  archived_at: string | null;
  archive_reason: string | null;
}

export interface ArchiveAuditEntry {
  action: "archived" | "restored" | "purged";
  at: string;
  reason?: string;
}

export interface DeletionTombstone {
  uuid: string;
  project_name: string;
  project_type: ProjectType;
  total_minutes: number;
  purged_at: string;
  purge_reason: string;
}

/** Project row joined with client + group info and computed totals for list/detail views. */
export interface ProjectListItem extends Project {
  client_name: string;
  contact_phone: string | null;
  email: string | null;
  group_name: string | null;
  group_color: string | null;
  /** The group's emoji, shown BESIDE the colour dot. Null when ungrouped or not yet assigned. */
  group_icon: string | null;
  /** Project note body, exposed for search matching (read-only path). */
  note_body: string | null;
  total_seconds: number;
  /** Hourly: hours x rate. Contract paid: contract_amount. Contract donated: 0 (shown as "Donated"). */
  total_value: number;
  /** Sum of the project's hard-cost line items (face value; no annualization). */
  total_costs: number;
  last_worked: string | null;
}

export interface TimeEntry {
  id: number;
  uuid: string;
  project_id: number;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  note: string | null;
  created_at: string;
}

export interface LedgerEntry {
  id: number;
  uuid: string;
  project_id: number;
  amount: number;
  previous_amount: number | null;
  action: LedgerAction;
  note: string | null;
  created_at: string;
}

export type AdjustmentAction = "created" | "edited" | "deleted";

/** One append-only entry in an adjustment's audit_log. */
export interface AuditEntry {
  action: AdjustmentAction;
  at: string;
  delta_minutes?: number;
  note?: string;
  from?: { delta_minutes: number; note: string };
  to?: { delta_minutes: number; note: string };
}

export interface Adjustment {
  /** The std uuid column — the adjustment's public id (was adj_<uuid> in the standalone app). */
  uuid: string;
  project_id: number;
  /** Positive = time added, negative = time subtracted. */
  delta_minutes: number;
  note: string;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  audit_log: AuditEntry[];
}

/** Adjustment joined with its project name/color for the global Adjustments view. */
export interface AdjustmentListItem extends Adjustment {
  project_name: string;
  project_color: string;
}

export interface ProjectDetail {
  project: ProjectListItem;
  entries: TimeEntry[];
  ledger: LedgerEntry[];
  costs: Cost[];
  /** Non-deleted adjustments affecting this project's total. */
  adjustments: Adjustment[];
  note: string;
}

export interface GrandTotals {
  total_seconds: number;
  total_value: number;
  total_costs: number;
  project_count: number;
}

export type ReportRange = "all" | "7d" | "30d" | "90d";
export type ReportGranularity = "day" | "week" | "month";

/** Read-only analytics totals — mirrors GrandTotals (same composite as the grand-total bar). */
export interface ReportTotals {
  total_seconds: number;
  /** $ value: hourly = rate x hours, paid contract = contract_amount, donated excluded. */
  total_value: number;
  total_costs: number;
  /** total_value + total_costs (the grand-total bar's composite). */
  total_invested: number;
  /** Hours logged against donated contracts — counted in time, never in $ value. */
  donated_seconds: number;
  project_count: number;
  group_count: number;
}

export interface TimeSeriesPoint {
  /** Sortable bucket key: day "YYYY-MM-DD", week "YYYY-Www", month "YYYY-MM". */
  bucket: string;
  hours: number;
  value: number;
  costs: number;
}

export interface HoursByProjectPoint {
  name: string;
  hours: number;
}

export interface CostsByCategoryPoint {
  category: string;
  amount: number;
}

/**
 * Wasted-hours metric: time on archived/purged projects, split by purpose.
 * Renderer derives the two ratios (vs all tracked, vs same-kind tracked) from these minutes.
 */
export interface WastedMetric {
  forProfitMinutes: number;
  nonProfitMinutes: number;
  /** Denominators — all-time tracked minutes (active + archived + purged), per scope. */
  allTrackedMinutes: number;
  forProfitTrackedMinutes: number;
  nonProfitTrackedMinutes: number;
}

/** Everything the Reports view needs in one read-only round-trip. */
export interface ReportData {
  totals: ReportTotals;
  timeSeries: TimeSeriesPoint[];
  hoursByProject: HoursByProjectPoint[];
  costsByCategory: CostsByCategoryPoint[];
  wasted: WastedMetric;
}

/** One active session (row in timetracker_active_sessions) with joined project context. */
export interface ActiveSessionInfo {
  id: number;
  projectId: number;
  projectName: string;
  clientName: string;
  contactPhone: string | null;
  hourlyRate: number | null;
  rateType: RateType;
  state: SessionState;
  /** Elapsed base — shifted forward on resume so (now - startedAt) is true worked time while running. */
  startedAt: string;
  /** Real wall-clock start (never shifted) — stamps + the saved entry. */
  wallStartedAt: string;
  /** Frozen elapsed seconds while paused. */
  accumulatedSeconds: number;
  lastPausedAt: string | null;
  lastResumedAt: string | null;
  note: string | null;
}

export interface MultiTimerStatus {
  sessions: ActiveSessionInfo[];
  focusedId: number | null;
}

/** One batched payload per ticker beat — every surface is a dumb read of this. */
export interface TickSession {
  id: number;
  projectId: number;
  name: string;
  elapsedMs: number;
  /** Live $ for hourly projects; null for contract (hours only). */
  earned: number | null;
  state: SessionState;
}

export interface TickPayload {
  sessions: TickSession[];
  focusedId: number | null;
}

/** A session found at launch whose heartbeat went stale — the crash-recovery unit. */
export interface InterruptedSession {
  id: number;
  projectId: number;
  projectName: string;
  clientName: string;
  startedAt: string;
  /** Elapsed at the LAST HEARTBEAT (not now) — what Keep & commit will save. */
  elapsedSeconds: number;
  lastHeartbeat: string;
  state: SessionState;
}

/** Action recorded in the append-only event log. crashed/recovered/ignored are reserved. */
export type EventType = "started" | "paused" | "resumed" | "stopped" | "crashed" | "recovered" | "ignored";

/** One append-only row in timetracker_event_log. project_id is a soft ref (no FK) so the log survives purge. */
export interface EventLogRow {
  id: number;
  uuid: string;
  ts: string;
  event_type: EventType;
  project_id: number | null;
  /** Denormalized at write time — stays readable after a rename/archive/delete. */
  project_name: string;
  detail: string | null;
}

/** Read-only filter for the Activity panel. */
export interface ActivityQuery {
  limit?: number;
  projectId?: number;
}

export interface NewProjectInput {
  name: string;
  clientName: string;
  contactPhone: string;
  email: string;
  rateType: RateType;
  hourlyRate: number | null;
  color: string;
  status: ProjectStatus;
  /** Existing group id, or null for Ungrouped. Ignored when newGroupName is set. */
  groupId: number | null;
  /** Icon for an inline-created group. Added ALONGSIDE colour, never replacing it. */
  newGroupIcon?: string | null;
  /** What the user plans to SPEND hiring/buying. Distinct from contractAmount (what the client pays). */
  spendBudget?: number | null;
  /** Phone extension, six digits max, kept apart so the ten-digit phone cap stays a real cap. */
  phoneExt?: string | null;
  /** Create this group inline (with newGroupColor) and assign the project to it. */
  newGroupName: string | null;
  newGroupColor: string | null;
  contractAmount: number | null;
  contractDescription: string;
  /** Absolute path of a contract file to copy into the storage root's contracts/<projectId>/. */
  contractSourcePath: string | null;
  contractKind: ContractKind | null;
  /** Donated-hours goal (e.g. 252.50) for donated contracts. */
  targetHours: number | null;
}

export interface UpdateProjectInput extends NewProjectInput {
  id: number;
}

/** An itemized cost row on a project — the Qty | Description | Amount rows. amount is the LINE
    total, not a unit price, so the itemized total is a plain sum. Soft-deleted, never removed. */
export interface ProjectItem {
  id: number;
  uuid: string;
  project_id: number;
  qty: number;
  description: string;
  amount: number;
  deleted_at: string | null;
  created_at: string;
}

export interface ProjectItemInput {
  projectId: number;
  qty: number;
  description: string;
  amount: number;
}

/** Someone ON a project — membership, which employee_entries cannot express because it only
    records work already done. person_* fields are LEFT-JOINed and null if that person was purged. */
export interface ProjectMember {
  id: number;
  uuid: string;
  project_id: number;
  person_id: number;
  added_at: string;
  person_name: string | null;
  person_role: string | null;
  default_rate: number | null;
  default_pay_type: string | null;
}

/** The three readouts. Jason's OWN tracked time is deliberately NOT part of `spent`. */
export interface ProjectSpend {
  project_id: number;
  /** What the CLIENT agreed to pay (the existing contract_amount column). */
  contracted: number | null;
  employee_cost: number;
  employee_hours: number;
  itemized_total: number;
  /** employee_cost + itemized_total. Excludes timetracker_time_entries by ruling. */
  spent: number;
  /** What the user planned to SPEND hiring and buying. */
  spend_budget: number | null;
  /** spend_budget - spent. NULL when no budget is set: that is a different answer from zero. */
  budget_left: number | null;
}
