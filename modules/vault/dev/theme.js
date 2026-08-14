/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary
   DEV HOST ONLY — the three-mode theme pill.

   WHY THIS IS A FILE AND NOT AN INLINE <script> (Jason 08-13-2026: "doesnt work").

   index.html carries `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'`.
   `script-src` is not stated, so it falls back to `default-src 'self'` — and 'self' does NOT permit
   an inline script. The pill's handler was therefore never registered, from the day the dev host was
   written. Styles had been granted 'unsafe-inline' and scripts never had, so the control looked
   right, highlighted on click (it did not — that was the same blocked script), and changed nothing.

   Two ways out: add 'unsafe-inline' to the policy, or move the script to a file. A file, obviously —
   relaxing a content policy to make a dev convenience work is the habit that later relaxes a real
   one, and this host is the place the module's own CSP behaviour gets judged.

   Mirrors App.tsx: 'system' CLEARS the attribute and falls through to the :root Hybrid block;
   'light' and 'dark' set it. The host does not persist the choice — a dev host that remembers a
   theme hides the default a new organisation actually gets. */
document.querySelectorAll("[data-theme-btn]").forEach(function (b) {
  b.addEventListener("click", function () {
    document.querySelectorAll("[data-theme-btn]").forEach(function (x) { x.classList.remove("on"); });
    b.classList.add("on");
    var mode = b.dataset.themeBtn;
    if (mode === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
  });
});
