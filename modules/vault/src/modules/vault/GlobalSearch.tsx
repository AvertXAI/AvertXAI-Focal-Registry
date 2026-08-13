/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// ONE search for the whole vault (Jason 08-11-2026), replacing the sidebar's "Search secrets" and
// the notes list's "Search secured notes". Two boxes that each searched a third of the vault meant
// you had to know where a thing was before you could look for it, which is the opposite of search.
//
// WHAT IT SEARCHES: passwords, secured notes, infrastructure (servers and DNS) and repos.
//
// WHAT IT NEVER SEARCHES — AND THIS IS A SECURITY PROPERTY, NOT AN OMISSION: a password VALUE.
// Matching on the secret itself would mean decrypting every entry on every keystroke, and it would
// turn the search box into an oracle — anyone at an unlocked screen could confirm a password by
// typing guesses and watching for a hit. Labels, usernames, URLs, note text, host names and repo
// names only. The line at the foot of the results says so, because a user who does not know that
// will assume search is broken rather than deliberate.
//
// FILTERS CARRY LIVE COUNTS so an empty result is explained before you hit it, and the group of
// matches your filters are HIDING is shown dimmed rather than silently dropped — "3 results" when
// there are nine is how a user concludes the search does not work.
//
// Everything filters over data already in memory. No new IPC, no query per keystroke.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Section } from "./Sidebar";
import { vaultApi, type VaultNoteMeta, type VaultRepo, type VaultSecretMeta, type VaultServer } from "./vaultApi";

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Mark every matched term, case-insensitively, at the text level (Jason 08-12-2026: "kind of how the
 * search does it in mindmerge notes with a highlighter"). It is the same nine lines MindMerge's
 * highlightText() uses and deliberately a copy — the vault lane does not reach into another module's
 * source (§2.8), and a shared helper for nine lines would be the import, not the saving.
 *
 * This is what makes a long result list scannable: with the excerpt now cut around the match, the
 * mark says WHY each row is here, so you read down the page instead of opening rows to find out.
 */
function highlight(text: string, terms: string[]): ReactNode {
  if (terms.length === 0 || !text) return text;
  const re = new RegExp(terms.map(escapeRe).join("|"), "gi");
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(<mark key={out.length}>{m[0]}</mark>);
    last = i + m[0].length;
  }
  if (out.length === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export type SearchScope = "passwords" | "notes" | "infra" | "repos";
/** How many notes the main-side search returns. Every one of them is rendered — the sheet scrolls —
 *  and the group header says so when the ceiling is reached, rather than quietly showing a prefix. */
const NOTE_SEARCH_LIMIT = 200;

const SCOPES: [SearchScope, string][] = [
  ["passwords", "Passwords"],
  ["notes", "Secured notes"],
  ["infra", "Infrastructure"],
  ["repos", "Repos"],
];

/** Month-first everywhere a human sees it (canon). */
const DATE_WINDOWS: [string, string, number][] = [
  ["7", "Last 7 days", 7],
  ["30", "This month", 30],
  ["365", "This year", 365],
];

export interface Hit {
  /** React key only — PREFIXED per scope so a note and a secret cannot collide. Never a locator. */
  id: string;
  /**
   * The row's real uuid, and the reason a search result now opens (Jason 08-12-2026: "i click on one
   * im interested in and it does nothing"). `id` was being handed to getNote(), which validates a
   * 36-character uuid — "n-0193…" is 38 with an 'n' in it, so every open threw "Invalid note locator"
   * into a catch that shrugged. Two fields because the key must stay unique across scopes and the
   * locator must stay exact; making one string do both is what broke it.
   */
  uuid: string;
  scope: SearchScope;
  badge: string;
  colour: string;
  title: string;
  sub: string;
  where: string;
  /** Epoch ms for the date filter, or null when the row carries no usable date. */
  at: number | null;
}

export interface GlobalSearchProps {
  secrets: VaultSecretMeta[];
  servers: VaultServer[];
  repos: VaultRepo[];
  /** Jumping to a hit changes section, and for a password also seeds the list filter. */
  /**
   * `id` is the whole point and it used to be dropped on the floor (Jason 08-12-2026: "i click on
   * one im interested in and it does nothing… it will open up the secured notes, if in that tab, but
   * not the file itself").
   *
   * Every Hit has always carried the row's uuid; go() passed the TITLE instead, so the receiver got
   * a display string and a scope and could do nothing but change tab. A search that finds your file
   * and then cannot open it is a search that did not work.
   */
  onGo: (scope: SearchScope, query: string, id: string) => void;
}

const ms = (iso?: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

export default function GlobalSearch({ secrets, servers, repos, onGo }: GlobalSearchProps) {
  const [q, setQ] = useState("");
  const [scopes, setScopes] = useState<Set<SearchScope>>(new Set());
  const [days, setDays] = useState<string | null>(null);
  const [openList, setOpenList] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  /**
   * NOTES ARE QUERIED, NOT HELD (08-12-2026). The corpus used to include every note — 4,089 of them
   * after the import — which meant the module loaded 1.4 MB over the bridge on every reload just in
   * case somebody typed here. Now nothing is fetched until there is something to search for, the
   * query runs main-side against an indexed LIKE, and it returns at most 40 rows.
   */
  const [noteHits, setNoteHits] = useState<VaultNoteMeta[]>([]);
  const api = vaultApi();
  const input = useRef<HTMLInputElement | null>(null);

  // Ctrl+K focuses it from anywhere, and Escape gives the page back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); setOpenList(true); }
      if (e.key === "Escape") setOpenList(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A click outside closes the sheet. Without this it sits over the page after you have moved on.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpenList(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  /** Every searchable row, flattened once per data change — not per keystroke. */
  const corpus = useMemo<Hit[]>(() => {
    const out: Hit[] = [];
    for (const s of secrets) {
      if (s.archived_at) continue;
      out.push({
        id: `p-${s.uuid}`, uuid: s.uuid, scope: "passwords", badge: "P", colour: "var(--vault-strong-color)",
        title: s.label,
        sub: [s.username, s.url].filter(Boolean).join(" · ") || s.kind,
        where: s.kind, at: ms(s.updated_at ?? s.created_at),
      });
    }
    for (const s of servers) {
      out.push({
        id: `i-${s.uuid}`, uuid: s.uuid, scope: "infra", badge: "I", colour: "var(--mc-accent-primary)",
        title: s.host, sub: [s.address, s.provider, s.role].filter(Boolean).join(" · ") || "server",
        where: "server", at: null,
      });
    }
    for (const r of repos) {
      out.push({
        id: `r-${r.uuid}`, uuid: r.uuid, scope: "repos", badge: "R", colour: "var(--vault-warn-color)",
        title: r.name, sub: r.description || r.remote_url || r.local_path || "repo",
        where: r.visibility || "repo", at: null,
      });
    }
    return out;
  }, [secrets, servers, repos]);

  const query = q.trim().toLowerCase();
  /** Same split the main-side query uses, so the local scopes and the note scope agree on what a
   *  two-word search means. Six is the same ceiling. */
  const terms = useMemo(() => query.split(/\s+/).filter(Boolean).slice(0, 6), [query]);

  // Debounced so a fast typist causes one query, not one per keystroke.
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) { setNoteHits([]); return; }
    const t = setTimeout(() => {
      // 40 WAS BOTH THE LIMIT AND THE COUNT ON SCREEN, which made a capped result indistinguishable
      // from a complete one — "SECURED NOTES · 40" reads as "there are 40" and meant "there are at
      // least 40". 200 is above any realistic screenful and still bounded, and the group header now
      // says when it bit.
      void api.searchNotes(needle, NOTE_SEARCH_LIMIT).then(setNoteHits).catch(() => setNoteHits([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q, api]);

  /** Text match ONLY — scope and date are applied after, so the chips can carry honest counts. */
  const textMatches = useMemo(() => {
    if (terms.length === 0) return [];
    // EVERY term, ANY order — a password labelled "Builders Audit" is a hit for "audit builders".
    const local = corpus.filter((h) => {
      const hay = `${h.title} ${h.sub} ${h.where}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    const fromDb: Hit[] = noteHits.map((n) => ({
      id: `n-${n.uuid}`, uuid: n.uuid, scope: "notes", badge: (n.kind ?? "n")[0]?.toUpperCase() ?? "N",
      colour: "var(--vault-note-color)",
      title: n.title,
      // The excerpt is now a window cut out of markdown, so it arrives with newlines and indentation
      // in it. One line of display, one line of text.
      sub: (n.excerpt || "").replace(/\s+/g, " ").trim() || "—",
      where: `${n.kind ?? "note"}${n.folder ? ` · ${n.folder}` : ""}`, at: ms(n.updated_at ?? n.created_at),
    }));
    return [...local, ...fromDb];
  }, [corpus, terms, noteHits]);

  const cutoff = useMemo(() => {
    if (!days) return null;
    const n = Number(days);
    return Date.now() - n * 24 * 60 * 60 * 1000;
  }, [days]);

  const inScope = (h: Hit): boolean => scopes.size === 0 || scopes.has(h.scope);
  // A row with no date is NOT excluded by a date filter — a server has no timestamp, and hiding it
  // because of that would be the filter quietly lying about what exists.
  const inDate = (h: Hit): boolean => cutoff === null || h.at === null || h.at >= cutoff;

  const shown = textMatches.filter((h) => inScope(h) && inDate(h));
  const hidden = textMatches.filter((h) => !(inScope(h) && inDate(h)));

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: textMatches.length };
    for (const [s] of SCOPES) c[s] = textMatches.filter((h) => h.scope === s).length;
    return c;
  }, [textMatches]);

  const toggleScope = (s: SearchScope): void =>
    setScopes((p) => { const n = new Set(p); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  const groups = useMemo(() => {
    const g = new Map<SearchScope, Hit[]>();
    for (const h of shown) { const list = g.get(h.scope) ?? []; list.push(h); g.set(h.scope, list); }
    return [...g.entries()];
  }, [shown]);

  const label = (s: SearchScope): string => SCOPES.find(([k]) => k === s)?.[1] ?? s;

  /**
   * THE BOX EMPTIES ON THE WAY OUT (Jason 08-12-2026: "the search should auto clear").
   *
   * A query left sitting in the bar after you have landed on the thing is a filter you did not ask
   * for: the next Ctrl+K opens onto stale results, and the header still reads `keystoneengine` over
   * a note you are now editing. Clearing also drops the 200 fetched rows, since the debounce sees a
   * needle under two characters and empties them.
   */
  const go = (h: Hit): void => { onGo(h.scope, h.title, h.uuid); setQ(""); setOpenList(false); };

  return (
    <div className="vault-gsearch" ref={box}>
      <div className={`vault-gsin${openList ? " focus" : ""}`}>
        <span className="mag" aria-hidden="true">🔍</span>
        {/* The active filters ride INSIDE the box as removable scopes, so what you are searching is
            never off-screen while you read the results. */}
        {[...scopes].map((s) => (
          <span key={s} className="vault-scope">
            {label(s)}
            <button title="Remove this filter" onClick={() => toggleScope(s)}>✕</button>
          </span>
        ))}
        {days && (
          <span className="vault-scope">
            {DATE_WINDOWS.find(([k]) => k === days)?.[1]}
            <button title="Remove this filter" onClick={() => setDays(null)}>✕</button>
          </span>
        )}
        <input
          ref={input}
          value={q}
          placeholder="Search everything — passwords, notes, servers, repos"
          onChange={(e) => { setQ(e.target.value); setOpenList(true); }}
          onFocus={() => setOpenList(true)}
        />
        {q && <button className="vault-gsclear" title="Clear" onClick={() => { setQ(""); input.current?.focus(); }}>✕</button>}
        <span className="vault-kbd">Ctrl K</span>
      </div>

      {openList && (
        <div className="vault-gsheet">
          <div className="vault-gsfilters">
            <button className={`vault-fchip${scopes.size === 0 ? " on" : ""}`} onClick={() => setScopes(new Set())}>
              All <span className="n">{counts.all}</span>
            </button>
            {SCOPES.map(([s, l]) => (
              <button key={s} className={`vault-fchip${scopes.has(s) ? " on" : ""}`} onClick={() => toggleScope(s)}>
                {l} <span className="n">{counts[s]}</span>
              </button>
            ))}
            <span className="vault-fsep" />
            {DATE_WINDOWS.map(([k, l]) => (
              <button key={k} className={`vault-fchip${days === k ? " on" : ""}`} onClick={() => setDays(days === k ? null : k)}>{l}</button>
            ))}
          </div>

          {query.length === 0 ? (
            <div className="vault-state">Type to search across every tab.</div>
          ) : shown.length === 0 && hidden.length === 0 ? (
            <div className="vault-state">Nothing matches “{q.trim()}”.</div>
          ) : (
            <>
              {/* EVERY HIT IS RENDERED (Jason 08-12-2026: "the quick list tells me '…and 34 more.'
                  but it doesnt load it, whats the purpose of that?"). None. It named results it then
                  refused to show, so a search that FOUND your file still could not open it — the six
                  it drew were the six it happened to sort first. The sheet has scrolled at 62vh since
                  it shipped; the only thing standing between him and row seven was a slice(0, 6). */}
              {groups.map(([scope, hits]) => (
                <div key={scope} className="vault-gsgroup">
                  <div className="vault-gshd">
                    {label(scope)} · {hits.length}
                    {scope === "notes" && hits.length >= NOTE_SEARCH_LIMIT && ` (first ${NOTE_SEARCH_LIMIT} — narrow the words)`}
                  </div>
                  {hits.map((h) => (
                    <button key={h.id} className="vault-gsrow" onClick={() => go(h)}>
                      <span className="vault-gsico" style={{ background: h.colour }}>{h.badge}</span>
                      <span className="vault-gsmain"><b>{highlight(h.title, terms)}</b><span className="s">{highlight(h.sub, terms)}</span></span>
                      <span className="vault-gswhere">{h.where}</span>
                    </button>
                  ))}
                </div>
              ))}

              {/* HIDDEN, NOT DROPPED. Showing that matches exist outside the current filters is the
                  difference between "there are only three" and "you are looking at three of nine". */}
              {hidden.length > 0 && (
                <div className="vault-gsgroup dim">
                  <div className="vault-gshd">Hidden by your filters — {hidden.length} more</div>
                  {hidden.slice(0, 3).map((h) => (
                    <button key={h.id} className="vault-gsrow" onClick={() => go(h)}>
                      <span className="vault-gsico" style={{ background: h.colour }}>{h.badge}</span>
                      <span className="vault-gsmain"><b>{highlight(h.title, terms)}</b><span className="s">{highlight(h.sub, terms)}</span></span>
                      <span className="vault-gswhere">{label(h.scope).toLowerCase()}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="vault-gsfoot">
            <span><span className="vault-kbd">↵</span> open</span>
            <span><span className="vault-kbd">Esc</span> close</span>
            <span style={{ marginLeft: "auto" }}>Passwords themselves are never searched — labels, titles and text only.</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** The section a scope jumps to. Kept beside the scopes so the two cannot drift. */
export const SCOPE_SECTION: Record<SearchScope, Section> = {
  passwords: "passwords",
  notes: "notes",
  infra: "infra",
  repos: "repos",
};
