/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Settings, Data: "Repair damaged notes" (MM-09).
//
// An earlier version saved some notes with a backslash before "://" or "@", with a bold label
// turned into literal \*\* marks, or with a pasted picture that never arrived. Nothing mends those
// on its own, because a note is only rewritten when it is opened and saved, and repairing notes
// unasked is exactly what this app must never do. So this lists them, shows what is stored beside
// what a repair would store, and saves one note per click, through the same save the editor uses.
// Titles and note text stay on the screen: nothing here writes either to a log.
import { useEffect, useRef, useState } from "react";
import { damageKinds, NOTE_REPAIRED_EVENT, type DamageKind } from "../../modules/mindmerge/noteDamage";
import { changedLines, createRepairer, type Repairer } from "../../modules/mindmerge/repairText";
import "./repairNotes.css";

interface Card {
  uuid: string;
  title: string;
  /** The stored text this preview was made from. Apply reads the note again and stops if it has moved on. */
  before: string;
  after: string;
  kinds: DamageKind[];
  /** Damage a repair does not take out, so the screen never promises more than it does. */
  left: DamageKind[];
  shown: { before: string; after: string };
  dropPicture: boolean;
  imported: boolean;
  state: "ready" | "saving" | "saved" | "skipped" | "stuck";
  note: string;
}

const FOUND: Record<DamageKind, string> = {
  scheme: "backslash before ://",
  at: "backslash before @",
  label: "label shown as \\*\\*",
  picture: "picture that never arrived",
};

// The writer keeps every backslash in a paragraph whose asterisks have to stay as typed, so a
// label that is not touched holds on to the "://" and "@" backslashes around it. Saying so here is
// what stops "A repair would not change this note" from reading like a fault.
const STAYS: Record<DamageKind, string> = {
  scheme: "a backslash before ://",
  at: "a backslash before @",
  label: "a \\*\\* pair right after a bracket or a quote that does not read as a label (it is not touched, and the backslashes in its paragraph stay with it)",
  picture: "the broken picture, until its box is ticked",
};

// The save cuts a note at this many characters (MAX_BODY in the notes service). A repair that
// would be cut is not offered: what is shown has to be what gets saved.
const STORE_LIMIT = 1_000_000;

/** Once a backup from today has been seen, later Applies in this session do not ask again. */
let backedUp = false;

const isToday = (iso: string | null): boolean => iso !== null && new Date(iso).toDateString() === new Date().toDateString();

export function RepairNotes() {
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(backedUp);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState("");
  const repairer = useRef<Repairer | null>(null);
  /** Goes up when the list is closed or the screen goes away, so a slow read cannot fill a list nobody is looking at. */
  const run = useRef(0);

  useEffect(
    () => () => {
      run.current += 1;
      repairer.current?.destroy();
    },
    []
  );

  const preview = (base: Pick<Card, "uuid" | "title" | "before" | "dropPicture" | "imported">): Card => {
    const kinds = damageKinds(base.before);
    const stuck = (note: string): Card => ({ ...base, after: base.before, kinds, left: kinds, shown: { before: "", after: "" }, state: "stuck", note });
    try {
      const tool = repairer.current;
      if (!tool) return stuck("The repair for this note could not be worked out. Nothing was changed.");
      const after = tool.repair(base.before, base.dropPicture);
      if (after.length > STORE_LIMIT) return stuck("The repaired note would be longer than a note can be. Nothing was changed.");
      // Line endings and trailing blank lines are not shown: a save evens those out in every note, damaged or not.
      return { ...base, after, kinds, left: damageKinds(after), shown: changedLines(base.before.trimEnd(), after.trimEnd()), state: "ready", note: "" };
    } catch {
      return stuck("The repair for this note could not be worked out. Nothing was changed.");
    }
  };

  const load = async (): Promise<void> => {
    const mine = (run.current += 1);
    setCards(null);
    setFailed(false);
    try {
      if (!repairer.current) {
        const made = await createRepairer(document.createElement("div"));
        if (mine !== run.current) return made.destroy();
        repairer.current = made;
      }
      if (!backedUp) backedUp = isToday((await window.api.dataCopy.status()).lastAt);
      // ponytail: every damaged note is read and previewed as the list opens. Fine for the tens
      // sweep 1 counted; show them a page at a time if a list ever runs to hundreds.
      const built: Card[] = [];
      for (const row of await window.api.dataRepair.list()) {
        const stored = await window.api.dataRepair.read(row.uuid);
        if (!stored) continue;
        const where = await window.api.mindmerge.docLocation(row.uuid);
        if (mine !== run.current) return;
        built.push(preview({ uuid: row.uuid, title: row.title, before: stored.body, dropPicture: false, imported: where.sourcePath !== null }));
      }
      if (mine !== run.current) return;
      setCopied(backedUp);
      setCards(built.filter((card) => card.kinds.length > 0));
    } catch (e) {
      if (mine !== run.current) return;
      setFailed(true);
      void window.api.mindmerge.logClient("error", "Repair: the list of damaged notes could not be made", String(e));
    }
  };

  const toggle = (): void => {
    if (open) run.current += 1;
    else void load();
    setOpen(!open);
  };

  const copyNow = async (): Promise<void> => {
    setCopying(true);
    setCopyError("");
    try {
      const done = await window.api.dataCopy.run();
      if (done.ok) {
        backedUp = true;
        setCopied(true);
      } else setCopyError(done.error);
    } catch (e) {
      setCopyError(String(e));
    }
    setCopying(false);
  };

  const change = (uuid: string, to: Partial<Card>): void =>
    setCards((list) => list && list.map((card) => (card.uuid === uuid ? { ...card, ...to } : card)));

  const apply = async (card: Card): Promise<void> => {
    change(card.uuid, { state: "saving", note: "" });
    try {
      const now = await window.api.dataRepair.read(card.uuid);
      if (!now) return change(card.uuid, { state: "stuck", note: "This note is no longer there. Nothing was changed." });
      // The note was edited after this preview was made. Saving the preview would undo that edit,
      // so a new preview is shown and the click is asked for again.
      if (now.body !== card.before) {
        return change(card.uuid, {
          ...preview({ ...card, before: now.body }),
          note: "This note changed after the list was made. The preview is new: read it, then press Apply again.",
        });
      }
      const saved = await window.api.mindmerge.updateNote(card.uuid, { body: card.after });
      const gone = card.dropPicture && card.kinds.includes("picture") && !card.left.includes("picture");
      change(card.uuid, {
        state: "saved",
        note:
          (saved.body === card.after ? "Saved." : "Saved, but the stored text is not exactly the preview. Open the note and check it.") +
          (gone ? " The broken picture line is gone: open the note and paste the picture again." : ""),
      });
      // The Notes editor stays loaded underneath Settings. If this note is the one open in it, it
      // still holds the old text and would save that straight back over the repair.
      window.dispatchEvent(new CustomEvent(NOTE_REPAIRED_EVENT, { detail: card.uuid }));
      // When a note was repaired, with no title and no text, so a later "the damage is back" can be lined up against the log.
      void window.api.mindmerge.logClient("warn", "Repair: a damaged note was repaired from Settings", `note ${card.uuid} · ${card.before.length} → ${card.after.length} chars`);
    } catch (e) {
      change(card.uuid, { state: "ready", note: "The note could not be saved. Nothing was changed." });
      void window.api.mindmerge.logClient("error", "Repair: a repaired note could not be saved", `note ${card.uuid} · ${String(e)}`);
    }
  };

  return (
    <div className="field">
      <div className="setrow">
        <label>Damaged notes</label>
        <button className="btn" onClick={toggle}>
          {open ? "Close the list" : "Repair damaged notes"}
        </button>
      </div>
      <p className="hint">
        Finds notes that an earlier version saved with a stray backslash before :// or @, a bold label shown as \*\*, or a picture
        that never arrived. Each note shows what is stored now and what a repair would store. Nothing is changed until you press
        Apply on that note.
      </p>
      {open && (
        <div className="repair-list">
          {failed && <p className="hint repair-error">The notes could not be checked. The reason is in the log.</p>}
          {!failed && cards === null && <p className="hint">Looking through the notes…</p>}
          {cards !== null && (
            <p className="hint">
              {cards.length === 0 ? "No damaged notes were found." : cards.length === 1 ? "1 note has damage." : `${cards.length} notes have damage.`}
            </p>
          )}
          {cards !== null && cards.length > 0 && !copied && (
            <aside className="tip">
              <div className="tip-head">Back up first</div>
              <p className="tip-body">Apply stays off until there is a backup from today.</p>
              <div className="repair-acts">
                <button className="btn" disabled={copying} onClick={() => void copyNow()}>
                  {copying ? "Backing up…" : "Back up everything now"}
                </button>
              </div>
              {copyError && <p className="hint repair-error">The backup did not finish: {copyError}</p>}
            </aside>
          )}
          {cards?.map((card) => {
            const differs = card.shown.before !== "" || card.shown.after !== "";
            return (
              <div className="repair-card" key={card.uuid}>
                <div className="repair-title">{card.title || "Untitled"}</div>
                {card.state === "saved" || card.state === "skipped" || card.state === "stuck" ? (
                  <p className={card.state === "saved" ? "hint repair-ok" : card.state === "stuck" ? "hint repair-error" : "hint"}>{card.note}</p>
                ) : (
                  <>
                    <div className="repair-kinds">
                      {card.kinds.map((kind) => (
                        <span className="dv-badge" key={kind}>
                          {FOUND[kind]}
                        </span>
                      ))}
                    </div>
                    {card.imported && (
                      <p className="hint">This note came from a file. The file itself is not changed, and after Apply the note no longer follows the file.</p>
                    )}
                    {differs ? (
                      <>
                        <div className="repair-side">Before: stored now</div>
                        <pre className="repair-pre">{card.shown.before}</pre>
                        <div className="repair-side">After: what Apply saves</div>
                        <pre className="repair-pre">{card.shown.after}</pre>
                      </>
                    ) : (
                      <p className="hint">A repair would not change this note.</p>
                    )}
                    {card.left.length > 0 && <p className="hint">Stays in the note: {card.left.map((kind) => STAYS[kind]).join("; ")}.</p>}
                    {card.kinds.includes("picture") && (
                      <label className="repair-check">
                        <input
                          type="checkbox"
                          checked={card.dropPicture}
                          disabled={card.state === "saving"}
                          onChange={(e) => change(card.uuid, preview({ ...card, dropPicture: e.target.checked }))}
                        />
                        Remove the broken picture line
                      </label>
                    )}
                    <div className="repair-acts">
                      <button className="btn" disabled={!copied || !differs || card.state === "saving"} onClick={() => void apply(card)}>
                        {card.state === "saving" ? "Saving…" : "Apply"}
                      </button>
                      <button
                        className="btn"
                        disabled={card.state === "saving"}
                        onClick={() => change(card.uuid, { state: "skipped", note: "Skipped. Nothing was changed." })}
                      >
                        Skip
                      </button>
                    </div>
                    {card.note && <p className="hint repair-error">{card.note}</p>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
