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

/** One tile. It holds off on the read until it is actually visible — the whole reason a folder of
 *  thousands of files opens instantly. */
function Tile({ item, onOpen }: { item: ScanMediaItem; onOpen: (i: ScanMediaItem) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (item.kind !== "image" || !box.current) return;
    let live = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void window.api.scan.notes
          .image(item.path)
          .then((r) => { if (!live) return; if (r.ok && r.dataUrl) setUrl(r.dataUrl); else setErr(r.error ?? "Could not read that file."); })
          .catch((e: unknown) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
      },
      { rootMargin: "200px" } // start a screen early so scrolling does not stutter
    );
    io.observe(box.current);
    return () => { live = false; io.disconnect(); };
  }, [item.path, item.kind]);

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

      {open && (
        <div className="scannotes-overlay" role="dialog" aria-modal="true" aria-label={open.filename} onClick={close}>
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
