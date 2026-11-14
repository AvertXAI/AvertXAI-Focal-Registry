/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// A click is sent to the element the mouse was pressed on. A list that is redrawn between the
// press and the release takes that element away, and the click is never sent: the row he pressed
// does not open. A save made as focus leaves an editor lands inside that press, so what such a
// save does to a list waits here until the press, and the click it ends in, are over. Only the
// redraw waits. The save itself never does.

type Listen = (name: string, heard: () => void, capture?: boolean) => void;

export function createAfterPress(listen: Listen, later: (run: () => void) => void): (work: () => void) => void {
  let pressed = false;
  let waiting: Array<() => void> = [];
  const released = (): void => {
    if (!pressed) return;
    pressed = false;
    const due = waiting;
    waiting = [];
    // Not inside the release: the click is sent right after it, in the same turn.
    if (due.length > 0) later(() => due.forEach((work) => work()));
  };
  // Capture phase, so the press is known before it moves focus and starts the save.
  listen("pointerdown", () => { pressed = true; }, true);
  listen("pointerup", released, true);
  listen("pointercancel", released, true);
  // The window's own blur, for a press that ends outside the app. Not in the capture phase: there
  // it would also hear every element losing focus, and the editor losing focus starts the save.
  listen("blur", released);
  return (work) => {
    if (pressed) waiting.push(work);
    else work();
  };
}

/** Runs `work` now, or once the mouse press in progress and its click are over. */
export const afterPress: (work: () => void) => void =
  typeof window === "undefined"
    ? (work) => work()
    : createAfterPress(
        (name, heard, capture) => window.addEventListener(name, heard, capture),
        (run) => void window.setTimeout(run, 0)
      );
