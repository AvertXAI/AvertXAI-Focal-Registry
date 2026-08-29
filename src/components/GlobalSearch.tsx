/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// GLOBAL SEARCH — the top-rail magnifier (BL-58 v4, mockup approved 08-23-2026; Jason 08-25:
// "the search icon is missing again from the native toprail with the filters").
//
// The rulings this implements, verbatim from the mockup feedback:
//   · opens with NO module picked = search everything
//   · picking a module slides that module's own filters in underneath
//   · Escape closes it. Clicking outside closes it.
//   · one skin — the Secured Vault's search look (vault/GlobalSearch.tsx is the reference; these
//     .gs-* rules mirror its .vault-gs* rules on shell tokens, since --vault-* tokens are that
//     module's own and never leak into the shell lane)
//   · CONFIG-AS-DATA (Jason 08-25): the module chips come from the same entitlement-filtered DB
//     rows TopBar renders — names from row.name, never hardcoded. "if its not showing in the app
//     for the user, it shouldnt show for them in search" — a refused module or lane is HIDDEN,
//     never dashed/locked (this supersedes the earlier locked-chip parked default).
//
// WHAT IT SEARCHES TODAY — the engines that exist, and only those: the MindMerge ingest corpus
// (Documents) and the authored store (Brain). BL-54's one-engine-for-the-whole-app is the real
// destination; a module chip whose engine doesn't exist yet says so honestly instead of returning
// a silent empty set.
import { useEffect, useMemo, useRef, useState } from "react";
import type { MindMergeDocMeta, ModuleRow, NoteRow } from "../shared/types";

const api = window.api;

// The one module slug the search engines reach today (BL-54 widens this).
const MM_SLUG = "mindmerge";

interface Hit {
  key: string;
  lane: "documents" | "brain";
  title: string;
  snippet: string;
  where: string;
  /** documents → the on-disk file; brain → the authored doc uuid. */
  file?: string;
  uuid?: string;
}

export interface GlobalSearchGo {
  file?: string;
  doc?: string;
}

const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

function snippetOf(body: string | null, term: string): string {
  const flat = (body ?? "").replace(/\s+/g, " ");
  const i = term ? flat.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (i < 0) return flat.slice(0, 90);
  const start = Math.max(0, i - 34);
  return (start > 0 ? "…" : "") + flat.slice(start, i + term.length + 56) + "…";
}

// The Documents filter set — the same chips the module carried before the v7 rework retired its
// in-pane list. Client-side over the returned rows: the FTS hit set is already small.
const DOC_FILTERS: { label: string; test: (r: NoteRow) => boolean }[] = [
  { label: "Critical", test: (r) => (r.severity ?? "").toLowerCase().startsWith("crit") },
  { label: "Recovery", test: (r) => (r.type ?? "").toLowerCase() === "recovery" },
  { label: "Setup", test: (r) => (r.type ?? "").toLowerCase() === "setup" },
];

export default function GlobalSearch({
  modules,
  onClose,
  onGo,
}: {
  /** The entitlement-filtered, enabled module rows — the SAME list TopBar's switcher renders. */
  modules: ModuleRow[];
  onClose: () => void;
  onGo: (req: GlobalSearchGo) => void;
}) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<string | null>(null); // module slug; null = everything
  const [lane, setLane] = useState<"documents" | "brain" | null>(null); // MindMerge's own filters
  const [docHits, setDocHits] = useState<NoteRow[] | null>(null);
  const [brainHits, setBrainHits] = useState<MindMergeDocMeta[] | null>(null);
  const [brainEntitled, setBrainEntitled] = useState<boolean | null>(null);
  const [docFilter, setDocFilter] = useState<number | null>(null); // index into DOC_FILTERS
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void api.licensing
      .features()
      .then((st) => setBrainEntitled(st.features.mindmergeBrain))
      .catch(() => setBrainEntitled(false));
  }, []);

  // Which engines this scope+lane combination reaches. If MindMerge itself is hidden from this
  // install, its rows are absent from `modules` and NOTHING searches it — hidden in nav means
  // hidden in search, the 08-25 ruling applied at the engine gate, not just the chip row.
  const hasMM = modules.some((m) => m.slug === MM_SLUG);
  const inMM = scope === null || scope === MM_SLUG;
  const wantDocs = hasMM && inMM && lane !== "brain";
  const wantBrain = hasMM && inMM && lane !== "documents" && brainEntitled === true;

  // Debounced fan-out to the engines the scope covers. Failures read as empty, never as a crash —
  // a search overlay that throws is worse than one that says "nothing matches".
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setDocHits(null);
      setBrainHits(null);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      if (wantDocs) {
        void api.mindmerge
          .search(term)
          .then((rs) => alive && setDocHits(rs.filter((r) => r.parse_status === "ok")))
          .catch(() => alive && setDocHits([]));
      }
      if (wantBrain) {
        void api.mindmerge
          .searchNotes(term, 40)
          .then((rs) => alive && setBrainHits(rs))
          .catch(() => alive && setBrainHits([]));
      }
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q, wantDocs, wantBrain]);

  // Escape closes — on the window, so it works wherever focus sits inside the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const term = q.trim();

  const kinds = useMemo(
    () => Array.from(new Set((brainHits ?? []).map((h) => h.kind))).sort(),
    [brainHits]
  );

  const hits = useMemo((): Hit[] => {
    const out: Hit[] = [];
    if (wantDocs && docHits) {
      for (const r of docFilter === null ? docHits : docHits.filter(DOC_FILTERS[docFilter].test)) {
        out.push({
          key: "d:" + r.uuid,
          lane: "documents",
          title: r.title || fileName(r.file_path).replace(/\.md$/i, ""),
          snippet: snippetOf(r.body_md, term),
          where: fileName(r.file_path),
          file: r.file_path,
        });
      }
    }
    if (wantBrain && brainHits) {
      for (const h of kindFilter === null ? brainHits : brainHits.filter((x) => x.kind === kindFilter)) {
        out.push({
          key: "b:" + h.uuid,
          lane: "brain",
          title: h.title,
          snippet: h.excerpt,
          where: h.folder ?? "Unfiled",
          uuid: h.uuid,
        });
      }
    }
    return out;
  }, [wantDocs, wantBrain, docHits, brainHits, docFilter, kindFilter, term]);

  const groups = useMemo(() => {
    const g = new Map<"documents" | "brain", Hit[]>();
    for (const h of hits) {
      const list = g.get(h.lane) ?? [];
      list.push(h);
      g.set(h.lane, list);
    }
    return [...g.entries()];
  }, [hits]);

  const go = (h: Hit): void => onGo(h.file ? { file: h.file } : { doc: h.uuid });

  const pick = (slug: string | null): void => {
    setScope(slug);
    setLane(null);
    setDocFilter(null);
    setKindFilter(null);
    input.current?.focus();
  };

  const pickLane = (l: "documents" | "brain"): void => {
    setLane(lane === l ? null : l); // second click deselects — back to both lanes
    setDocFilter(null);
    setKindFilter(null);
    input.current?.focus();
  };

  // A module the engines don't reach yet — say so, never a silent empty result set.
  const unreachable = scope !== null && scope !== MM_SLUG ? modules.find((m) => m.slug === scope) : undefined;

  return (
    // .overlay → App's MutationObserver dims the native caption buttons; backdrop click closes.
    <div className="overlay gs-back" onMouseDown={onClose}>
      <div className="gs-sheet" role="dialog" aria-label="Search everywhere" onMouseDown={(e) => e.stopPropagation()}>
        <div className="gs-in">
          <span className="gs-mag" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="4.3" /><path d="M10.3 10.3 13.6 13.6" /></svg>
          </span>
          <input
            ref={input}
            autoFocus
            value={q}
            placeholder="Search everything"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits[0]) go(hits[0]);
            }}
            aria-label="Search everything"
          />
          {q && (
            <button className="gs-clear" title="Clear" onClick={() => { setQ(""); input.current?.focus(); }}>
              ✕
            </button>
          )}
          <span className="gs-kbd">Esc</span>
        </div>

        {/* scope chips — CONFIG-AS-DATA: one per entitlement-filtered module row, names from the
            rows. A module this install can't see is simply not here (hidden, never locked). */}
        <div className="gs-filters">
          <button className={"gs-chip" + (scope === null ? " on" : "")} onClick={() => pick(null)}>
            Everything
          </button>
          {modules.map((m) => (
            <button
              key={m.slug}
              className={"gs-chip" + (scope === m.slug ? " on" : "")}
              onClick={() => pick(m.slug)}
            >
              {m.name}
            </button>
          ))}
          {/* the picked module's own filters slide in underneath (v4 ruling). MindMerge's are its
              two lanes; the unentitled Brain lane is HIDDEN, not locked (08-25 ruling). */}
          {scope === MM_SLUG && (
            <>
              <span className="gs-sep" />
              <button className={"gs-chip" + (lane === "documents" ? " on" : "")} onClick={() => pickLane("documents")}>
                Documents
              </button>
              {brainEntitled === true && (
                <button className={"gs-chip" + (lane === "brain" ? " on" : "")} onClick={() => pickLane("brain")}>
                  Brain
                </button>
              )}
            </>
          )}
          {scope === MM_SLUG && lane === "documents" && (
            <>
              <span className="gs-sep" />
              {DOC_FILTERS.map((f, i) => (
                <button
                  key={f.label}
                  className={"gs-chip" + (docFilter === i ? " on" : "")}
                  onClick={() => setDocFilter(docFilter === i ? null : i)}
                >
                  {f.label}
                </button>
              ))}
            </>
          )}
          {scope === MM_SLUG && lane === "brain" && kinds.length > 0 && (
            <>
              <span className="gs-sep" />
              {kinds.map((k) => (
                <button
                  key={k}
                  className={"gs-chip" + (kindFilter === k ? " on" : "")}
                  onClick={() => setKindFilter(kindFilter === k ? null : k)}
                >
                  {k}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="gs-results">
          {unreachable ? (
            <div className="gs-state">Search doesn&rsquo;t reach {unreachable.name} yet.</div>
          ) : term.length === 0 ? (
            <div className="gs-state">Type to search{scope === null ? " everything" : ""}.</div>
          ) : hits.length === 0 ? (
            <div className="gs-state">Nothing matches &ldquo;{term}&rdquo;.</div>
          ) : (
            groups.map(([s, rows]) => (
              <div key={s} className="gs-group">
                <div className="gs-hd">{s === "documents" ? "Documents" : "Brain"} · {rows.length}</div>
                {rows.map((h) => (
                  <button key={h.key} className="gs-row" onClick={() => go(h)}>
                    <span className={"gs-ico " + h.lane}>{h.lane === "documents" ? "D" : "B"}</span>
                    <span className="gs-main">
                      <b>{h.title}</b>
                      <span className="s">{h.snippet}</span>
                    </span>
                    <span className="gs-where">{h.where}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
