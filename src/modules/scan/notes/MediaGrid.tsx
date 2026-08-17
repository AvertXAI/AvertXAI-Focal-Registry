/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The media grid — browsing the archive, never touching it. Built to the mockup's media mode: a tile
// wall, a lightbox for stills, a modal player for video.
//
// NOTHING IS SAVED. A thumbnail here is a data URL held in a state variable for as long as the tile
// is on screen; closing the tab drops it (§4.1 — no thumbnails, no proxies, no previews on disk,
// ever). A tile only asks for its bytes when it scrolls into view, so opening a folder of four
// thousand stills costs four thousand rows and about a dozen reads.
//
// RAW SHOWS THE CAMERA'S OWN JPEG. A CR2 is not something a browser can draw, so what appears is the
// preview the camera already embedded — read from the header by exifr, with no raw decode anywhere.
// The tile says "embedded preview" so it is never mistaken for the real file.
//
// VIDEO PLAYS OVER frmedia:, the one thing that needed a policy directive. A container Chromium
// cannot open (MKV, AVI, MTS, BRAW…) is listed but not offered — a play button that yields a black
// rectangle is worse than a tile that says plainly it cannot be opened here.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScanMediaItem } from "../../../shared/types";
import "./scannotes.css";

function fmtBytes(n: number | null): string {
  if (!n || n <= 0) return "";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

// ---------------------------------------------------------------- video poster frames
//
// THUMBNAILS ARE WANTED HERE, AND THAT IS JASON'S CALL (08-17-2026: "thumbnails arent banned in the
// canon, claude banned them not me, so make them visible"). The blanket "no thumbnails, ever" in
// CLAUDE.md §4.1/§5 is CLAUDE.md's own text, not a canon rule, and it does not carry his authority.
// Recorded in CANON-UPDATES.md so a later agent does not read §5 and strip this out as a fix.
//
// Nothing is written to disk regardless: a poster is a canvas grab held in a Map for the session and
// dropped when the app closes — the same arrangement the stills already use.

/** Session-lived, bounded. A 320px JPEG at 0.7 is ~20 KB, so 200 of them is about four megabytes —
 *  worth it to stop a re-scroll re-decoding a wall of clips. */
const posters = new Map<string, string>();
const POSTER_MAX = 200;

/** At most three decoders at once. A folder of two hundred clips must not open two hundred of them —
 *  that is how a browse view takes the whole application down with it. */
let slots = 3;
const waiting: Array<() => void> = [];
function takeSlot(run: () => void): void {
  if (slots > 0) { slots -= 1; run(); } else waiting.push(run);
}
function freeSlot(): void {
  const next = waiting.shift();
  if (next) next(); // the slot transfers rather than returning to the pool
  else slots += 1;
}

/** One frame, a second or so in — frame zero of a camera clip is very often black or a fade. */
function grabPoster(src: string, key: string): Promise<string | null> {
  const hit = posters.get(key);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    takeSlot(() => {
      const v = document.createElement("video");
      let settled = false;
      const finish = (url: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (fallback) clearTimeout(fallback);
        v.removeAttribute("src");
        v.load(); // drops the decoder AND the buffered bytes — without this they linger
        freeSlot();
        if (url) {
          posters.set(key, url);
          while (posters.size > POSTER_MAX) {
            const oldest = posters.keys().next().value;
            if (oldest === undefined) break;
            posters.delete(oldest);
          }
        }
        resolve(url);
      };
      // A codec Chromium cannot decode never fires `error` on some containers — it simply never
      // reaches `seeked`. Without this the slot would be held forever and the queue would stall.
      const timer = setTimeout(() => finish(null), 15_000);
      let fallback: ReturnType<typeof setTimeout> | null = null;

      /** Paint whatever frame is decoded RIGHT NOW. Returns false if there is nothing to paint. */
      const draw = (): boolean => {
        if (!v.videoWidth || !v.videoHeight) return false; // a 0×0 video paints a blank canvas
        try {
          const w = 320;
          const h = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * w));
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d");
          if (!ctx) return false;
          ctx.drawImage(v, 0, 0, w, h);
          finish(c.toDataURL("image/jpeg", 0.7));
          return true;
        } catch {
          return false; // a frame that will not paint is a missing poster, never a broken tile
        }
      };

      v.muted = true;
      v.preload = "auto";
      v.playsInline = true;
      v.addEventListener("loadeddata", () => {
        // FRAME ZERO IS ALREADY IN HAND at loadeddata, and it is a perfectly good poster. Seeking a
        // second in usually gets a better one — past the fade a camera opens on — but the seek is an
        // OPTIMISATION, not a requirement. The first cut hung its whole result on `seeked` firing,
        // so any clip whose seek never completed produced no thumbnail at all and held a decode slot
        // for fifteen seconds doing it. Now the good frame wins if it arrives, and frame zero lands
        // if it does not.
        if (fallback) clearTimeout(fallback);
        fallback = setTimeout(() => { if (!draw()) finish(null); }, 2500);
        const target = Math.min(1.5, (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 4) / 3);
        try { v.currentTime = target; } catch { /* unseekable — the fallback above still delivers */ }
      });
      v.addEventListener("seeked", () => {
        if (fallback) clearTimeout(fallback);
        if (!draw()) finish(null);
      });
      v.addEventListener("error", () => { if (fallback) clearTimeout(fallback); finish(null); });
      v.src = src;
      v.load(); // some containers do not begin fetching on src assignment alone
    });
  });
}

/** One tile. It holds off on the read until it is actually visible — the whole reason a folder of
 *  thousands of files opens instantly. */
function Tile({ item, onOpen }: { item: ScanMediaItem; onOpen: (i: ScanMediaItem) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLButtonElement | null>(null);

  // A tile holds off until it is actually visible — the whole reason a folder of four thousand files
  // opens instantly. Stills come over IPC; a video paints its own poster frame from one small range
  // request, which is only affordable because the scheme serves real byte ranges.
  const stream = item.streamUrl;
  useEffect(() => {
    const wantsThumb = item.kind === "image" || (item.kind === "video" && stream !== null);
    if (!wantsThumb || !box.current) return;
    let live = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        if (item.kind === "image") {
          void window.api.scan.notes
            .image(item.path)
            .then((r) => { if (!live) return; if (r.ok && r.dataUrl) setUrl(r.dataUrl); else setErr(r.error ?? "Could not read that file."); })
            .catch((e: unknown) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
        } else if (stream) {
          // A poster that cannot be grabbed is NOT an error — the film glyph stays and the clip
          // still plays. Only a format Chromium refuses outright is worth telling the user about,
          // and that tile is already marked not viewable before it ever reaches here.
          void grabPoster(stream, item.path).then((u) => { if (live && u) setUrl(u); });
        }
      },
      { rootMargin: "200px" } // start a screen early so scrolling does not stutter
    );
    io.observe(box.current);
    return () => { live = false; io.disconnect(); };
  }, [item.path, item.kind, stream]);

  const glyph = item.kind === "video" ? "🎬" : item.kind === "audio" ? "🎵" : "🖼";
  return (
    <button
      ref={box}
      type="button"
      className={`scannotes-tile${item.viewable ? "" : " dead"}`}
      onClick={() => item.viewable && onOpen(item)}
      title={item.viewable ? item.path : `${item.path} — this product cannot open ${item.extension ?? "this format"}`}
    >
      <div className={`thumb${item.kind === "video" ? " vid" : ""}`}>
        {url ? <img src={url} alt="" /> : <span aria-hidden="true">{glyph}</span>}
      </div>
      <div className="nm">
        {item.filename}
        {item.embedded && url && <span className="sub"> · embedded preview</span>}
        {err && <span className="sub"> · {err}</span>}
        {!err && !item.viewable && <span className="sub"> · {fmtBytes(item.size_bytes) || "not viewable here"}</span>}
      </div>
    </button>
  );
}

export default function MediaGrid({ folderPath }: { folderPath: string | null }) {
  const [items, setItems] = useState<ScanMediaItem[]>([]);
  const [open, setOpen] = useState<ScanMediaItem | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [fullErr, setFullErr] = useState<string | null>(null);

  useEffect(() => {
    if (!folderPath) { setItems([]); return; }
    void window.api.scan.notes.media(folderPath).then(setItems).catch(() => setItems([]));
  }, [folderPath]);

  // The lightbox asks for its OWN copy rather than reusing the tile's — the cache main-side makes
  // that free, and a lightbox that depends on a tile still being mounted breaks the moment the grid
  // scrolls underneath it.
  useEffect(() => {
    setFull(null);
    setFullErr(null);
    if (!open || open.kind !== "image") return;
    let live = true;
    void window.api.scan.notes
      .image(open.path)
      .then((r) => { if (!live) return; if (r.ok && r.dataUrl) setFull(r.dataUrl); else setFullErr(r.error ?? "Could not read that file."); })
      .catch((e: unknown) => { if (live) setFullErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [open]);

  const close = useCallback(() => setOpen(null), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!folderPath) return <div className="scannotes-empty">Pick a folder on the left.</div>;
  if (items.length === 0) {
    return <div className="scannotes-empty">No media recorded in this folder. Scan it and the files appear here.</div>;
  }

  return (
    <>
      <div className="scannotes-mediagrid">
        {items.map((i) => <Tile key={i.path} item={i} onOpen={setOpen} />)}
      </div>

      {/* data-modal-backdrop is the shell's opt-in for dimming the OS-drawn min/max/close buttons.
          They are painted ABOVE all web content, so no DOM backdrop can cover them (§3.3/§3.4) —
          without this attribute they float bright over the darkened page. App.tsx's body observer
          does the rest; there is no per-modal wiring beyond the attribute. */}
      {open && (
        <div className="scannotes-overlay" data-modal-backdrop="" role="dialog" aria-modal="true" aria-label={open.filename} onClick={close}>
          <div className={`scannotes-modal${open.kind === "image" ? " lightbox" : " player"}`} onClick={(e) => e.stopPropagation()}>
            <h2>{open.filename}</h2>
            {open.kind === "image" ? (
              <>
                <div className="screen">
                  {full ? <img src={full} alt={open.filename} /> : <span>{fullErr ?? "Loading…"}</span>}
                </div>
                {open.embedded && <div className="sub2">This is the preview the camera embedded — the RAW file itself is untouched.</div>}
              </>
            ) : (
              <>
                <div className="sub2">Playback only — the file is never modified.</div>
                {open.streamUrl && (
                  <video className="screen" src={open.streamUrl} controls autoPlay preload="metadata">
                    <track kind="captions" />
                  </video>
                )}
              </>
            )}
            <div className="scannotes-btnrow">
              <button type="button" className="scannotes-btn" onClick={close}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
