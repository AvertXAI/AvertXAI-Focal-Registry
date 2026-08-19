/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
//
// THE WINDOW ARITHMETIC, ON ITS OWN, BECAUSE IT IS THE PART THAT CANNOT BE CHECKED BY LOOKING.
//
// A virtualized wall that renders the wrong slice looks entirely plausible — a wall of tiles is a
// wall of tiles, and the ones that are missing are the ones you cannot see. That is precisely how a
// 500-row clamp passed for a complete folder for weeks. So the four numbers that decide what exists
// are computed here, in one pure function with no React and no DOM, and checked against a set of
// cases that includes the two that actually bite: the LAST row, and a folder shorter than a screen.
//
// IT FAILS OPEN, ALWAYS. Hand it a column count or a row height it cannot use and it returns the
// whole list. Heavier is a performance problem; short is a correctness one, and this module is
// allowed to have only the first kind.

export interface WindowInput {
  /** How many tiles the wall is showing — AFTER the RAW filter, not the folder's row count. */
  count: number;
  /** Columns the grid actually resolved to at this width. Measured, never assumed. */
  cols: number;
  /** One row's full pitch: a tile's height plus the grid's row gap. */
  rowH: number;
  /** The grid's row gap on its own — a spacer stands in for rows AND their gaps but the grid puts
   *  one gap after the spacer itself, so the spacer is one gap shorter than the rows it replaces. */
  gap: number;
  /** Where the grid starts inside the scroller's content, which moves when the truncation line
   *  above it appears. */
  gridTop: number;
  /** The scrollport's height. */
  viewH: number;
  scrollTop: number;
  /** Rows kept mounted beyond each edge. */
  overscan: number;
}

export interface WindowOutput {
  /** First index rendered, inclusive. */
  start: number;
  /** Last index rendered, EXCLUSIVE — pass straight to Array.slice. */
  end: number;
  /** Height of the spacer standing in for the rows above `start`. Zero means no spacer. */
  padTop: number;
  /** Height of the spacer standing in for the rows below `end`. Zero means no spacer. */
  padBottom: number;
  rows: number;
  /** False when the inputs could not be used and the whole list is being rendered. */
  windowed: boolean;
}

export function computeWindow(i: WindowInput): WindowOutput {
  const n = Math.max(0, i.count);
  // ANY UNUSABLE MEASUREMENT RENDERS EVERYTHING. There is no clever fallback here on purpose: the
  // only two outcomes are "the right slice" and "all of it".
  if (!(i.cols > 0) || !(i.rowH > 0) || !(i.viewH > 0)) {
    return { start: 0, end: n, padTop: 0, padBottom: 0, rows: 0, windowed: false };
  }
  const rows = Math.ceil(n / i.cols);
  const top = i.scrollTop - i.gridTop;
  const firstRow = clamp(Math.floor(top / i.rowH) - i.overscan, 0, rows);
  const lastRow = clamp(Math.ceil((top + i.viewH) / i.rowH) + i.overscan, firstRow, rows);
  return {
    start: firstRow * i.cols,
    // min() with n is what keeps the LAST row honest: the final row is usually short, and
    // lastRow * cols would otherwise ask for tiles past the end of the list.
    end: Math.min(n, lastRow * i.cols),
    padTop: firstRow > 0 ? firstRow * i.rowH - i.gap : 0,
    padBottom: rows - lastRow > 0 ? (rows - lastRow) * i.rowH - i.gap : 0,
    rows,
    windowed: true,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * THE CHECK. It runs under the shell's DIAG switch and nowhere else, so it costs nothing in a normal
 * session and shouts in the console the moment the arithmetic drifts. It is deliberately small
 * enough to read: every case here is one that has a plausible way of going wrong.
 *
 * Returns the failures rather than throwing — a broken assertion must never be the thing that takes
 * the media pane down.
 */
export function checkWindowMath(): string[] {
  const fail: string[] = [];
  const eq = (what: string, got: unknown, want: unknown): void => {
    if (got !== want) fail.push(`${what}: got ${String(got)}, wanted ${String(want)}`);
  };
  // 415 tiles, 5 columns, 131px rows, a 600px viewport, parked at the top.
  const base = { count: 415, cols: 5, rowH: 131, gap: 12, gridTop: 0, viewH: 600, overscan: 3 };
  const top = computeWindow({ ...base, scrollTop: 0 });
  eq("top.start", top.start, 0);
  eq("top.padTop", top.padTop, 0);
  eq("top.rows", top.rows, 83);

  // THE ONE THAT MATTERS. Scrolled to the very bottom, the LAST tile must exist — a window that
  // drops the tail is the 250-tile defect wearing a new coat, and it is invisible by inspection.
  const height = 83 * 131 - 12;
  const bottom = computeWindow({ ...base, scrollTop: height - 600 });
  eq("bottom.end", bottom.end, 415);
  eq("bottom.padBottom", bottom.padBottom, 0);

  // A folder shorter than one screen is never windowed away.
  const tiny = computeWindow({ ...base, count: 4, scrollTop: 0 });
  eq("tiny.end", tiny.end, 4);
  eq("tiny.padTop", tiny.padTop, 0);
  eq("tiny.padBottom", tiny.padBottom, 0);

  // THE HEIGHTS MUST ADD UP, or the wall drifts under the header a little more with every screen.
  const mid = computeWindow({ ...base, scrollTop: 4000 });
  const renderedRows = Math.ceil(mid.end / base.cols) - mid.start / base.cols;
  const spanned = mid.padTop + (mid.padTop > 0 ? base.gap : 0) + renderedRows * base.rowH - base.gap +
    (mid.padBottom > 0 ? base.gap + mid.padBottom : 0);
  eq("mid heights sum to the full wall", spanned, height);

  // A truncation line above the grid moves everything down by its own height and must not shift
  // which rows are chosen.
  const shifted = computeWindow({ ...base, gridTop: 40, scrollTop: 4040 });
  eq("gridTop is honoured", shifted.start, mid.start);

  // Unusable measurements render the whole list rather than a guess.
  const blind = computeWindow({ ...base, cols: 0, scrollTop: 4000 });
  eq("blind.windowed", blind.windowed, false);
  eq("blind.end", blind.end, 415);

  return fail;
}
