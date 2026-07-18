// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: RunBooks — AvertXAI platform shell (baseplate)
// Description: Runbooks module service — list/create over the `runbooks` table. IPC boundary:
//              args arrive as unknown from the renderer and are validated here.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/runbooks/index.ts
//------------------------------------------------------------
import { getDb } from "../db";
import { generateUUIDv7 } from "../utils/uuidv7";
import type { Runbook } from "../../../../src/shared/types";

export function listRunbooks(): Runbook[] {
  return getDb().prepare("SELECT * FROM runbooks ORDER BY created_at DESC, id DESC").all() as Runbook[];
}

export function createRunbook(title: unknown, description: unknown): Runbook {
  if (typeof title !== "string" || title.trim() === "") {
    throw new Error("createRunbook: title must be a non-empty string");
  }
  if (description != null && typeof description !== "string") {
    throw new Error("createRunbook: description must be a string");
  }
  const db = getDb();
  const info = db
    .prepare("INSERT INTO runbooks (uuid, title, description) VALUES (?, ?, ?)")
    .run(generateUUIDv7(), title.trim(), description ?? null);
  return db.prepare("SELECT * FROM runbooks WHERE id = ?").get(info.lastInsertRowid) as Runbook;
}
