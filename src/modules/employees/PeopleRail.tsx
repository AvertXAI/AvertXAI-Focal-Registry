/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The PEOPLE rail — Employees' own nested rail, mirroring TimeTracker's ProjectsRail pattern
// (fixed width, selection drives the main panel). Per the approved mockup's option 3, "its own
// module": a PEOPLE header with a count, then one row per person — avatar initials, name, hours.
//
// PHASE 3A is a READ surface: there is no "+ New Employee" control here yet. The mockup shows one,
// but the create form is a later phase, and a button that does nothing is worse than no button.
import type { EmployeePerson } from "../../shared/types";

interface Props {
  people: EmployeePerson[];
  /** Hours per person id — the ledger totals the rail shows beside each name. */
  hoursById: Record<number, number>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Loading and error are DISTINCT states: an empty rail must never mean "the read failed". */
  loading: boolean;
  error: boolean;
}

/** Deterministic avatar colour — the same person always gets the same swatch, no storage needed. */
const AVATAR_COLORS = ["#14b8a6", "#a855f7", "#eab308", "#25c26e", "#4f8df0", "#e0574f", "#38bdf8", "#f97316"];
export const avatarColor = (id: number): string => AVATAR_COLORS[Math.abs(id) % AVATAR_COLORS.length];

/** "Maria Reyes" → "MR"; a single name → its first two letters. Never more than two characters. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const fmtHours = (h: number): string => `${h.toFixed(h % 1 === 0 ? 0 : 1)}h`;

export default function PeopleRail({ people, hoursById, selectedId, onSelect, loading, error }: Props) {
  return (
    <aside className="emp-rail" aria-label="People">
      <div className="emp-railhead">
        <span className="emp-railtitle">People</span>
        {!loading && !error && <span className="emp-railcount">{people.length}</span>}
      </div>
      <div className="emp-raillist">
        {error ? (
          <div className="emp-state error" role="alert">
            <b>Couldn&apos;t load the people list.</b>
            Reopen the module to try again — nothing has been changed.
          </div>
        ) : loading ? (
          <div className="emp-state">Loading…</div>
        ) : people.length === 0 ? (
          <div className="emp-state">No people yet. Adding them arrives with the next phase.</div>
        ) : (
          people.map((p) => (
            <button
              key={p.id}
              className={"emp-personrow" + (p.id === selectedId ? " on" : "")}
              onClick={() => onSelect(p.id)}
              aria-current={p.id === selectedId}
            >
              <span className="emp-avatar" style={{ background: avatarColor(p.id) }} aria-hidden="true">
                {initials(p.name)}
              </span>
              <span className="emp-personname">{p.name}</span>
              <span className="emp-personhrs">{fmtHours(hoursById[p.id] ?? 0)}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
