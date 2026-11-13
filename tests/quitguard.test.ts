// The quit guard's rules, on fake work: a held quit, nothing acted on until every line is
// answered, Cancel keeps everything running, and "Finish, then quit" quits when the job ends.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createQuitGuard, cutShortRows, jobsToReport, type GuardState } from "../electron/core/services/work/quitGuard";
import { actOnWork, registerWorkSource, runningWork, trackJob, type WorkAction, type WorkLine } from "../electron/core/services/work/registry";

function harness() {
  const running: WorkLine[] = [
    { id: "timer:1", kind: "timer", text: "Timer: Fake Project · Fake Person · 1h 05m", actions: ["pause", "stop"] },
    { id: "job:1", kind: "job", text: "Rename: 140 of 900 files", actions: ["finish", "stopSafely"] },
  ];
  const acted: Array<[string, WorkAction]> = [];
  const published: Array<GuardState | null> = [];
  let tick: () => void = () => undefined;
  let checking = false;
  let quits = 0;
  const end = (id: string): void => void running.splice(running.findIndex((line) => line.id === id), 1);
  const guard = createQuitGuard({
    running: () => running,
    act: (id, action) => {
      acted.push([id, action]);
      if (action === "pause" || action === "stop") end(id); // a paused or stopped timer is no longer running
    },
    publish: (state) => void published.push(state),
    every: (fn) => {
      tick = fn;
      checking = true;
      return () => {
        checking = false;
      };
    },
  });
  return { guard, running, acted, published, end, tick: () => tick(), checking: () => checking, quits: () => quits, proceed: () => void quits++ };
}

test("nothing running: the quit is not held", () => {
  const h = harness();
  h.running.length = 0;
  assert.equal(h.guard.request("quit", h.proceed), false);
  assert.equal(h.published.length, 0);
});

test("a quit is held and lists both lines, and nothing stops until every line is answered", () => {
  const h = harness();
  assert.equal(h.guard.request("quit", h.proceed), true);
  assert.equal(h.published.at(-1)?.lines.length, 2);
  h.guard.answer("timer:1", "stop");
  assert.deepEqual(h.acted, [], "one answer of two carries out nothing");
  assert.equal(h.published.at(-1)?.lines[0].answer, "stop");
  assert.equal(h.running.length, 2);
  assert.equal(h.quits(), 0);
});

test("Cancel keeps both running and the app open", () => {
  const h = harness();
  h.guard.request("quit", h.proceed);
  h.guard.answer("timer:1", "stop");
  h.guard.cancel();
  assert.deepEqual(h.acted, []);
  assert.equal(h.running.length, 2);
  assert.equal(h.published.at(-1), null, "the toast is taken down");
  assert.equal(h.checking(), false);
  h.tick();
  assert.equal(h.quits(), 0);
  assert.equal(h.guard.state(), null);
});

test("a second quit that finds nothing running goes ahead, and the held one does not quit again", () => {
  const h = harness();
  h.guard.request("quit", h.proceed);
  h.guard.answer("timer:1", "pause");
  h.guard.answer("job:1", "finish");
  h.end("job:1"); // the job ends between two checks
  assert.equal(h.guard.request("quit", h.proceed), false, "nothing is running, so this quit is not held");
  assert.equal(h.guard.state(), null);
  assert.equal(h.checking(), false);
  h.tick();
  assert.equal(h.quits(), 0, "the caller of the second quit goes ahead by itself; the held one adds no quit");
});

test("Finish, then quit: the timer is paused at once, and the quit goes ahead when the job ends", () => {
  const h = harness();
  h.guard.request("update", h.proceed);
  h.guard.answer("timer:1", "pause");
  h.guard.answer("job:1", "finish");
  assert.deepEqual(h.acted, [["timer:1", "pause"], ["job:1", "finish"]]);
  h.tick();
  assert.equal(h.published.at(-1)?.waiting, true);
  assert.equal(h.published.at(-1)?.reason, "update");
  assert.equal(h.quits(), 0, "the job is still running");
  h.end("job:1");
  h.tick();
  assert.equal(h.quits(), 1);
  assert.equal(h.published.at(-1), null);
  h.tick();
  assert.equal(h.quits(), 1, "the quit goes ahead once");
});

test("Stop safely is passed to the job, and the quit waits for it to stop", () => {
  const h = harness();
  h.guard.request("quit", h.proceed);
  h.guard.answer("job:1", "stopSafely");
  h.guard.answer("timer:1", "stop");
  assert.deepEqual(h.acted, [["timer:1", "stop"], ["job:1", "stopSafely"]]);
  assert.equal(h.quits(), 0);
  h.end("job:1");
  h.tick();
  assert.equal(h.quits(), 1);
});

test("work that ends by itself is not an answer: the toast goes and the app stays open", () => {
  const h = harness();
  h.guard.request("quit", h.proceed);
  h.end("timer:1");
  h.end("job:1");
  h.tick();
  assert.equal(h.quits(), 0);
  assert.equal(h.published.at(-1), null);
});

test("a job that cannot stop safely only takes Finish", () => {
  const h = harness();
  h.running[1].actions = ["finish"];
  h.guard.request("quit", h.proceed);
  h.guard.answer("job:1", "stopSafely");
  assert.equal(h.published.at(-1)?.lines[1].answer, null);
  h.guard.answer("job:1", "finish");
  assert.equal(h.published.at(-1)?.lines[1].answer, "finish");
});

test("an answer cannot be changed once it was carried out", () => {
  const h = harness();
  h.guard.request("quit", h.proceed);
  h.guard.answer("job:1", "finish");
  h.guard.answer("timer:1", "pause");
  h.guard.answer("job:1", "stopSafely");
  assert.deepEqual(h.acted, [["timer:1", "pause"], ["job:1", "finish"]]);
});

test("a tracked job is listed while it runs, hears Stop safely, and leaves the list when done", async () => {
  let release: () => void = () => undefined;
  let sawStop = false;
  const done = trackJob(
    () => "Export: 3 of 71 tables",
    async (shouldStop) => {
      await new Promise<void>((resolve) => (release = resolve));
      sawStop = shouldStop();
      return "ended";
    }
  );
  const [line] = runningWork();
  assert.equal(line.text, "Export: 3 of 71 tables");
  assert.deepEqual(line.actions, ["finish", "stopSafely"]);
  const off = registerWorkSource({ list: () => { throw new Error("broken source"); }, act: () => undefined });
  assert.equal(runningWork().length, 1, "a source that throws is skipped, not fatal");
  off();
  actOnWork(line.id, "stopSafely");
  release();
  assert.equal(await done, "ended");
  assert.equal(sawStop, true);
  assert.equal(runningWork().length, 0);
});

test("what was cut short is written down, and the next launch lists each job once", () => {
  const job: WorkLine = { id: "job:1", kind: "job", text: "Rename: 140 of 900 files", actions: ["finish", "stopSafely"], next: "Run the rename again: files already copied are skipped." };
  const timer: WorkLine = { id: "timer:1", kind: "timer", text: "Timer: Fake Project · Fake Person · 1h 05m", actions: ["pause", "stop"] };
  const at = "2026-11-13T05:00:00.000Z";
  const safe = cutShortRows([job], at, false);
  assert.deepEqual(safe, [{ text: "Rename: 140 of 900 files", next: "Run the rename again: files already copied are skipped.", at }]);
  const boot = [{ text: "Scan of drive E: stopped at 1,200 folders", next: "Open Scan and press Resume.", at }];
  assert.equal(jobsToReport(safe, boot).length, 2, "a safe stop and a crash are both listed");
  const forced = [...cutShortRows([timer], at, true, " (stopped when Windows shut down)"), ...cutShortRows([job], at, true)];
  assert.equal(forced[0].text, "Timer: Fake Project · Fake Person · 1h 05m (stopped when Windows shut down)");
  assert.equal(forced[0].next, "");
  assert.deepEqual(jobsToReport(forced, boot), forced, "a forced shutdown already recorded the job that boot finds running");
  assert.deepEqual(jobsToReport([], []), []);
});
