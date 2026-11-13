/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Finds the notes the repair screen offers to fix (MM-09). Read only: one query, then the damage
// test the screen itself uses. A repair is saved by the note save the editor already has
// (updateNote in notes.ts), never from here, so there stays one way a note's text is written.
// No Electron import: the test hands these a throwaway database.
import { damageKinds, PENDING_PICTURE, type DamageKind } from "../../../../src/modules/mindmerge/noteDamage";
import type { Db } from "./db";

export interface DamagedDoc {
  uuid: string;
  title: string;
  kinds: DamageKind[];
}

// Every kind of damage holds one of these, so SQLite sets aside the clean notes before any text
// is handed to JavaScript. They go in as parameters: a backslash in SQL text is easy to get wrong.
const NEEDLES = ["\\://", "\\@", "\\*\\*", `](${PENDING_PICTURE}`];

/** The damaged notes of one workspace, archived ones included, by title. */
export function listDamagedDocs(db: Db, orgId: string): DamagedDoc[] {
  // ponytail: reads the whole table's text on the main thread, once, when the list is opened.
  // Fine for a few thousand notes; move it to a worker if the list ever takes a visible moment.
  const rows = db
    .prepare(`SELECT uuid, title, body FROM mindmerge_docs WHERE org_id = ? AND (${NEEDLES.map(() => "instr(body, ?) > 0").join(" OR ")})`)
    .all(orgId, ...NEEDLES) as { uuid: string; title: string; body: string }[];
  const found: DamagedDoc[] = [];
  for (const row of rows) {
    // The query only narrows. A backslash inside code is not damage, and this is what knows that.
    const kinds = damageKinds(row.body);
    if (kinds.length > 0) found.push({ uuid: row.uuid, title: row.title, kinds });
  }
  return found.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

/** One note's text exactly as stored, for the Before side. A list never carries it: bodies are long. */
export function readDocBody(db: Db, orgId: string, uuid: unknown): { body: string } | null {
  const row = db.prepare("SELECT body FROM mindmerge_docs WHERE org_id = ? AND uuid = ?").get(orgId, String(uuid)) as { body: string } | undefined;
  return row ? { body: row.body } : null;
}
