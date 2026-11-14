/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Says once, after boot, what this launch did about encrypting the employee tax numbers.
//
// The page asks instead of main pushing: a push sent while the boot screen is still up has no
// toast to land in. Main answers only when the backup and the encryption are over, and answers
// nothing at all on a launch that had nothing to encrypt, so most launches show nothing here.
import { useEffect } from "react";
import { signalAppToast } from "../App";

// Three sentences and a folder path take longer to read than the toast's usual six seconds.
const NOTICE_MS = 20000;

export default function TaxNotice() {
  useEffect(() => {
    void window.api.employees
      .taxNotice()
      .then((notice) => {
        if (notice) signalAppToast(notice.text, notice.tone, NOTICE_MS);
      })
      .catch(() =>
        // Said out loud: he would otherwise never learn whether his numbers were encrypted.
        signalAppToast(
          "Focal Registry could not tell whether employee tax numbers were encrypted at this start. No number was lost.",
          "err",
          NOTICE_MS
        )
      );
  }, []);
  return null;
}
