// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: RunBooks — AvertXAI platform shell (baseplate)
// Description: Scout Viewer renderer — the Fortified Browser chrome mounted IN-SHELL (ported from
//              the standalone prototype's index.html + renderer.js). Renders the browser chrome
//              (back/fwd/reload-stop · URL bar · Go), the 58px SCOUT tool rail, the guest hole the
//              native WebContentsView covers from above, the sessions modal, and the DOM-read card.
//              Everything from the guest page is UNTRUSTED — rendered as React text, never HTML.
//              Talks to the engine ONLY via window.api.scout (sender-verified main-side).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/scout-viewer/ScoutViewerModule.tsx
//------------------------------------------------------------
import { useEffect, useRef, useState } from "react";
import type { ScoutDomCard, ScoutTargetRow } from "../../shared/types";
import "./scout-viewer.css";

export default function ScoutViewerModule() {
  const holeRef = useRef<HTMLDivElement | null>(null);
  const [urlText, setUrlText] = useState("https://app.halopsa.com/tickets");
  // The ACTIVE page ({url,title} straight from the engine) — distinct from urlText, which the user
  // can freely edit in the bar. The bookmark star compares/saves against THIS, never the input.
  const [page, setPage] = useState<{ url: string; title: string }>({ url: "", title: "" });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [snapFading, setSnapFading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [card, setCard] = useState<ScoutDomCard | null>(null);
  // Browse targets (scout_targets CRUD) — loaded fresh each time the sessions modal opens.
  const [targets, setTargets] = useState<ScoutTargetRow[] | null>(null);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  // null = list mode · "new" = create form · number = that row is being edited.
  const [editing, setEditing] = useState<"new" | number | null>(null);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");

  // Mount = the module is the active view: subscribe engine events, then tell main to show (and
  // lazily create) the guest. Unmount = hide the guest + unsubscribe — the view survives hidden
  // with its page + session intact, so returning to the module is instant.
  useEffect(() => {
    const unsubscribe = [
      window.api.scout.onUrlChanged((info) => {
        setUrlText(info.url);
        setPage(info);
      }),
      window.api.scout.onLoadingState(setLoading),
      window.api.scout.onSnapshot((dataUrl) => {
        setSnapFading(false);
        setSnapshot(dataUrl);
      }),
      window.api.scout.onTabReady(() => setSnapFading(true)),
    ];
    window.api.scout.setVisible(true);
    return () => {
      window.api.scout.setVisible(false);
      for (const un of unsubscribe) un();
    };
  }, []);

  // Snapshot teardown: tab-ready starts the CSS fade; drop the node after the transition window.
  useEffect(() => {
    if (!snapFading) return;
    const t = window.setTimeout(() => {
      setSnapshot(null);
      setSnapFading(false);
    }, 600);
    return () => window.clearTimeout(t);
  }, [snapFading]);

  // Hole geometry → engine (main clamps; we just report the live rect). ResizeObserver catches
  // module-layout changes (Flyout drag-resize, rail collapse); window resize catches the rest.
  useEffect(() => {
    const hole = holeRef.current;
    if (!hole) return;
    const report = (): void => {
      const r = hole.getBoundingClientRect();
      window.api.scout.updateBounds({
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    };
    const ro = new ResizeObserver(report);
    ro.observe(hole);
    report(); // immediate sync so the guest lands on the first frame, not the first tick
    window.addEventListener("resize", report);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", report);
    };
  }, []);

  const navigate = (): void => {
    const url = urlText.trim();
    if (url) window.api.scout.navigate(url);
  };

  // Vault unlock modal — UI STUB ONLY (honesty-in-UI: no engine, no credential logic, nothing
  // decrypts). Same guest-occlusion dance as the sessions modal: the native view must hide.
  const [vaultOpen, setVaultOpen] = useState(false);
  const openVault = (): void => {
    setVaultOpen(true);
    window.api.scout.setModalState(true);
  };
  const closeVault = (): void => {
    setVaultOpen(false);
    window.api.scout.setModalState(false);
  };

  const openModal = (): void => {
    setModalOpen(true);
    setEditing(null);
    setTargetsError(null);
    window.api.scout.setModalState(true); // main hides the native guest so the modal is visible
    void loadTargets();
  };
  const closeModal = (): void => {
    setModalOpen(false);
    window.api.scout.setModalState(false);
  };

  const pickTarget = (t: ScoutTargetRow): void => {
    setUrlText(t.url);
    closeModal();
    window.api.scout.switchClientTab(t.client_id, t.url); // client_id keys the isolated session
  };

  // --- target CRUD — invokes REJECT on service validation failure; every path catches to the
  // modal's inline error line instead of an unhandled rejection.
  const loadTargets = async (): Promise<void> => {
    try {
      setTargets(await window.api.scout.targets.list());
      setTargetsError(null);
    } catch (e) {
      setTargetsError(e instanceof Error ? e.message : String(e));
    }
  };
  const startCreate = (): void => {
    setEditing("new");
    setFormName("");
    setFormUrl("");
  };
  const startEdit = (t: ScoutTargetRow): void => {
    setEditing(t.id);
    setFormName(t.name);
    setFormUrl(t.url);
  };
  const saveTarget = async (): Promise<void> => {
    try {
      if (editing === "new") await window.api.scout.targets.create(formName, formUrl);
      else if (typeof editing === "number") await window.api.scout.targets.update(editing, formName, formUrl);
      setEditing(null);
      await loadTargets();
    } catch (e) {
      setTargetsError(e instanceof Error ? e.message : String(e));
    }
  };
  const removeTarget = async (id: number): Promise<void> => {
    try {
      await window.api.scout.targets.remove(id);
      await loadTargets();
    } catch (e) {
      setTargetsError(e instanceof Error ? e.message : String(e));
    }
  };

  // Targets load at mount too (not only on modal open) so the star knows saved-state up front.
  useEffect(() => {
    void loadTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = (msg: string): void => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  };

  // One-tap bookmark quick-save: current page → scout_targets via the EXISTING createTarget
  // (client_id auto-mints as always — a quick-saved site gets its own isolated session).
  const pageSaved = page.url !== "" && (targets ?? []).some((t) => t.url === page.url);
  const quickSave = async (): Promise<void> => {
    if (!page.url) return;
    try {
      const rows = targets ?? (await window.api.scout.targets.list());
      if (rows.some((t) => t.url === page.url)) {
        setTargets(rows);
        showToast("Already saved");
        return;
      }
      await window.api.scout.targets.create(page.title.trim() || new URL(page.url).hostname, page.url);
      await loadTargets();
      showToast("Saved");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const extract = async (): Promise<void> => {
    try {
      const c = await window.api.scout.domRead();
      if (c) setCard(c);
    } catch {
      // rejection = transient (frame mid-navigation / renderer gone / page threw during eval) —
      // same UX as the graceful no-engine null: the card simply doesn't update.
    }
  };

  return (
    <div className="scv-shell">
      {/* browser chrome — reload doubles as Stop while loading (state pushed from main) */}
      <div className="scv-chrome">
        <button className="scv-nav" title="Back" onClick={() => window.api.scout.goBack()}>←</button>
        <button className="scv-nav" title="Forward" onClick={() => window.api.scout.goForward()}>→</button>
        <button
          className="scv-nav"
          title={loading ? "Stop" : "Reload"}
          onClick={() => (loading ? window.api.scout.stop() : window.api.scout.reload())}
        >
          {loading ? "✖" : "⟳"}
        </button>
        <div className="scv-url">
          <span className="scv-lk">🔒</span>
          <input
            className="scv-urltext"
            value={urlText}
            spellCheck={false}
            onChange={(e) => setUrlText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur(); // drop the caret so the bar reads committed
                navigate();
              }
            }}
            aria-label="Address"
          />
        </div>
        <button
          className={"scv-nav scv-star" + (pageSaved ? " on" : "")}
          onClick={() => void quickSave()}
          title={pageSaved ? "Saved as target" : "Save page as target"}
          aria-label={pageSaved ? "Saved as target" : "Save page as target"}
          aria-pressed={pageSaved}
        >
          <svg width={16} height={16} viewBox="0 0 16 16" fill={pageSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" aria-hidden="true">
            <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3.1-3 4.3-.6Z" />
          </svg>
        </button>
        <button className="scv-go" onClick={navigate}>Go</button>
        <button className="scv-nav" onClick={openVault} title="Auto-fill from Vault" aria-label="Auto-fill from Vault">
          <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="5.8" cy="10.2" r="3" />
            <path d="M8 8 13.8 2.2M11.3 4.7l2.1 2.1M9.4 6.6l1.5 1.5" />
          </svg>
        </button>
        {/* quick-save toast — lives in the chrome row (outside the guest hole, never occluded) */}
        {toast && <span className="scv-toast" role="status">{toast}</span>}
      </div>

      <div className="scv-body">
        {/* LEFT icon-only tool rail. Extract-structure is LIVE; the other Scout tools are .nb
            (orange = not built, global convention). Session icons open the modal. */}
        <div className="scv-rail">
          <div className="scv-rlab">Scout</div>
          <button className="scv-ri" onClick={() => void extract()} title="Extract structure card — read the live DOM (isolated-world, zero scraper libs)">🧭</button>
          <button className="scv-ri nb" title="Grab nav tree — Not built">🌳</button>
          <button className="scv-ri nb" title="Extract vocabulary — Not built">🔤</button>
          <button className="scv-ri nb" title="AI summarize — Not built">🤖</button>
          <hr className="scv-rsep" />
          <div className="scv-rlab">Session</div>
          <button className="scv-ri" onClick={openModal} title="Client tabs — per-client isolated sessions (persist:client_<id>)">⧉</button>
          <button className="scv-ri nb" title="Saved cards — Not built">▤</button>
          <div className="scv-grow" />
          <button className="scv-ri nb" title="Settings — Not built">⚙</button>
        </div>

        {/* CENTER browser viewport — live hole for the guest WebContentsView; snapshots overlay here */}
        <div className="scv-view" ref={holeRef}>
          {snapshot && <img className={"scv-snap" + (snapFading ? " fade" : "")} src={snapshot} alt="" />}
          {modalOpen && (
            <div className="scv-mwrap" onClick={closeModal}>
              <div className="scv-modal" role="dialog" aria-label="Client tabs" onClick={(e) => e.stopPropagation()}>
                <div className="scv-mhead">
                  <div className="scv-mt">
                    Client tabs<span className="scv-k">— persist:client_&lt;id&gt; teardown queue</span>
                  </div>
                  <button className="scv-mx" onClick={closeModal} aria-label="Close">✕</button>
                </div>
                <div className="scv-mbody">
                  {targetsError && <div className="scv-ferr">{targetsError}</div>}
                  {targets === null && !targetsError && <div className="scv-cline">Loading targets…</div>}
                  {targets !== null && targets.length === 0 && editing !== "new" && (
                    <div className="scv-cline">No targets yet — add one below.</div>
                  )}
                  {targets?.map((t) =>
                    editing === t.id ? (
                      <div key={t.uuid} className="scv-tform">
                        <div className="scv-fld">
                          <label htmlFor={`tname-${t.id}`}>Name</label>
                          <input id={`tname-${t.id}`} className="scv-inp" value={formName} autoFocus onChange={(e) => setFormName(e.target.value)} />
                        </div>
                        <div className="scv-fld">
                          <label htmlFor={`turl-${t.id}`}>URL</label>
                          <input id={`turl-${t.id}`} className="scv-inp" value={formUrl} spellCheck={false} placeholder="https://…" onChange={(e) => setFormUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveTarget(); }} />
                        </div>
                        <div className="scv-btnrow">
                          <button className="scv-b pri" onClick={() => void saveTarget()}>Save</button>
                          <button className="scv-b ghost" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div key={t.uuid} className="scv-titem">
                        <button className="scv-tmain" onClick={() => pickTarget(t)} title="Open in this target's isolated session">
                          <span className="scv-tname"><span className="scv-i">★</span>{t.name}</span>
                          <span className="scv-turl">{t.url}</span>
                        </button>
                        <span className="scv-dot none" title="No saved card yet" />
                        <button className="scv-tact" title="Edit target" aria-label={`Edit ${t.name}`} onClick={() => startEdit(t)}>✎</button>
                        <button className="scv-tact danger" title="Remove target" aria-label={`Remove ${t.name}`} onClick={() => void removeTarget(t.id)}>✕</button>
                      </div>
                    )
                  )}
                  {editing === "new" && (
                    <div className="scv-tform">
                      <div className="scv-fld">
                        <label htmlFor="tname-new">Name</label>
                        <input id="tname-new" className="scv-inp" value={formName} autoFocus onChange={(e) => setFormName(e.target.value)} />
                      </div>
                      <div className="scv-fld">
                        <label htmlFor="turl-new">URL</label>
                        <input id="turl-new" className="scv-inp" value={formUrl} spellCheck={false} placeholder="https://…" onChange={(e) => setFormUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveTarget(); }} />
                      </div>
                      <div className="scv-btnrow">
                        <button className="scv-b pri" onClick={() => void saveTarget()}>Save</button>
                        <button className="scv-b ghost" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="scv-mfoot">
                  <button className="scv-b pri" onClick={startCreate}>＋ New target</button>
                  <button className="scv-b ghost" onClick={closeModal}>Close</button>
                </div>
              </div>
            </div>
          )}

          {/* Vault unlock — UI stub, centered over the module. The password input is wired to
              NOTHING (uncontrolled, never read); the unlock button is .nb orange until the Vault
              engine bite lands. Esc + scrim click + ✕ all close. */}
          {vaultOpen && (
            <div
              className="scv-mwrap"
              onClick={closeVault}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeVault();
              }}
            >
              <div className="scv-modal" role="dialog" aria-label="Unlock Vault" onClick={(e) => e.stopPropagation()}>
                <div className="scv-mhead">
                  <div className="scv-mt">Unlock Vault<span className="scv-mk">— nothing decrypts yet; engine lands with the Vault bite</span></div>
                  <button className="scv-mx" onClick={closeVault} aria-label="Close">✕</button>
                </div>
                <div className="scv-mbody">
                  <div className="scv-fld">
                    <label htmlFor="vault-master">Master password</label>
                    <input id="vault-master" className="scv-inp" type="password" autoFocus autoComplete="off" spellCheck={false} />
                  </div>
                  <div className="scv-btnrow">
                    <button className="scv-b pri nb">Unlock &amp; sign in</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT card preview — hover-peek sliver; untrusted strings render as React text only */}
        <div className="scv-card">
          <div className="scv-clab">{card ? `Card preview — ${new URL(card.url).pathname}` : "Card preview — run an extract"}</div>
          <div className="scv-cbox">
            {!card && <div className="scv-cline">Click 🧭 Extract to read the live DOM (isolated world, zero scraper libs).</div>}
            {card && (
              <>
                <div className="scv-cline"><b>Title: </b>{card.title || "—"}</div>
                <div className="scv-cline"><b>URL: </b>{card.url || "—"}</div>
                <div className="scv-cline"><b>Headings: </b>{card.headings.join(" · ") || "—"}</div>
                <div className="scv-cline"><b>Nav: </b>{card.nav.join(" · ") || "—"}</div>
                <div className="scv-cline"><b>Table cols: </b>{card.tableCols.join(" · ") || "—"}</div>
                <div className="scv-cline"><b>Actions: </b>{card.actions.join(" · ") || "—"}</div>
                <div className="scv-cline">
                  <b>Counts: </b>
                  {`links ${card.counts.links} · forms ${card.counts.forms} · tables ${card.counts.tables} · iframes ${card.counts.iframes}`}
                </div>
              </>
            )}
          </div>
          <div className="scv-btnrow">
            <button className="scv-b save nb">💾 Save card</button>
            <button className="scv-b ghost nb">Copy md</button>
          </div>
        </div>
      </div>
    </div>
  );
}
