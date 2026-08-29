/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// About — Help → About…, previously a not-built placeholder. Copy ruled verbatim 08-23-2026 and
// centred; the only edit to what Jason wrote is the state abbreviation.
//
// "San Antonio, TX", not "Tx". AppFooter.tsx has read `San Antonio, TX` on every screen of this
// application since it was written, and two spellings of the same city one panel apart reads as a
// typo rather than a choice. If the footer ever changes, this changes with it — they are one string
// in two places and must never drift.
//
// The version is NEVER hardcoded. It comes from app.getVersion() over updater:version, the same way
// Settings reads it (views/Settings.tsx). A pasted version number is a number that is wrong from the
// next release onwards.
//
// The two policy links are plain anchors, exactly as AppFooter does it: main.ts's hardenWebContents
// catches will-navigate and hands them to the default browser. The support address is NOT a link —
// openExternally() in main.ts only forwards http:// and https://, so a mailto: anchor here would be
// swallowed and do nothing at all. A dead link is worse than plain text you can select and copy.
import { useEffect, useState } from "react";

interface Props {
  onClose: () => void;
}

export default function AboutDialog({ onClose }: Props) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    void window.api.updater.version().then(setVersion).catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="fb-modal about"
        role="dialog"
        aria-modal="true"
        aria-label="About Focal Registry"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fb-about">
          <div className="fb-aboutapp">
            Focal Registry <span className="fb-aboutver">{version || "…"}</span>
          </div>
          <div className="fb-aboutblk">
            <div className="strong">Powered by AvertXAI</div>
            <div>San Antonio, TX</div>
            <div>All Rights Reserved &copy; {new Date().getFullYear()}</div>
            <div>
              <a href="https://avertxai.com/tos">Terms Of Service</a>
              {" | "}
              <a href="https://avertxai.com/privacy">Privacy Policy</a>
            </div>
            <div className="fb-aboutmail">support@avertxai.com</div>
          </div>
        </div>
        <div className="fb-acts">
          <span className="fb-spacer" />
          <button className="fb-btn" autoFocus onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
