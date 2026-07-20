/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Standing AvertXAI footer — mounted ONCE in the shell (App.tsx), so it appears on every module page
// (root-lane, not per-module). The two links are plain anchors: clicking them is caught by main.ts's
// hardenWebContents (will-navigate / setWindowOpenHandler → openExternally), which opens them in the
// user's DEFAULT browser — never an app window, never Scout Viewer. No second openExternal call site.
// The year is dynamic (never stale on Jan 1). Styling + reserved height live in globals.css (.app-footer).
export default function AppFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="app-footer">
      <span className="app-footer-txt">
        Powered by AvertXAI · San Antonio, TX · All Rights Reserved © {year} ·{" "}
        <a href="https://avertxai.com/tos">Terms Of Service</a>
        {" | "}
        <a href="https://avertxai.com/privacy">Privacy Policy</a>
      </span>
    </footer>
  );
}
