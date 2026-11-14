// Focal Registry — the one list of work that is running right now.
// Description: timers and long jobs announce themselves here, so the quit guard can ask about each
//              one before the app ends. No Electron import: the guard is tested headless.

export type WorkAction = "pause" | "stop" | "finish" | "stopSafely" | "retry" | "quitAnyway";

export interface WorkLine {
  /** Stable for as long as the work runs: the user's answer is keyed on it. */
  id: string;
  kind: "timer" | "job" | "note";
  /** One line for the quit toast, for example "Scan: drive E: · 62 percent". */
  text: string;
  /** What may be chosen. A job that cannot stop between files offers "finish" alone. */
  actions: WorkAction[];
  /** For a job: what is safe to do next if it is cut short. Kept with the record of what was cut. */
  next?: string;
}

export interface WorkSource {
  /** Only work that is running at this moment. A paused timer is not running. */
  list(): WorkLine[];
  act(id: string, action: WorkAction): void;
}

const sources = new Set<WorkSource>();

export function registerWorkSource(source: WorkSource): () => void {
  sources.add(source);
  return () => void sources.delete(source);
}

// A source that throws must not make the app impossible to quit, so it is logged and skipped.
function linesOf(source: WorkSource): WorkLine[] {
  try {
    return source.list();
  } catch (err) {
    console.error("[work] a source could not list its work:", err);
    return [];
  }
}

export function runningWork(): WorkLine[] {
  return [...sources].flatMap(linesOf);
}

export function actOnWork(id: string, action: WorkAction): void {
  for (const source of sources) {
    if (linesOf(source).some((line) => line.id === id)) source.act(id, action);
  }
}

let nextJob = 1;

/**
 * Runs one-off work (Backup, Export, Repair) as a listed job. `shouldStop` turns true once the
 * user chose "Stop safely": the work checks it between files and leaves nothing half-written.
 */
export async function trackJob<T>(
  describe: () => string,
  run: (shouldStop: () => boolean) => Promise<T>,
  stoppable = true
): Promise<T> {
  const id = `job:${nextJob++}`;
  let stop = false;
  const off = registerWorkSource({
    list: () => [{ id, kind: "job", text: describe(), actions: stoppable ? ["finish", "stopSafely"] : ["finish"] }],
    act: (_id, action) => {
      if (action === "stopSafely") stop = true;
    },
  });
  try {
    return await run(() => stop);
  } finally {
    off();
  }
}
