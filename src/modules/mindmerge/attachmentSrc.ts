/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// ONE resolver for `vault://<uuid>` image references, shared by every surface that renders one —
// the Markdoc preview, the WYSIWYG editor's DOM sweep, and the full-size modal. A pasted image's
// bytes live in MindMerge's own encrypted store (attachments.ts — machine-held key, never prompts); the note body carries only the short
// reference, so the Raw view stays readable (Jason 08-16-2026). The cache is module-level and
// session-lived: the same image scrolled past twice must not cross the bridge twice.
import { mindmergeApi } from "./mindmergeApi";

const PREFIX = "mindmerge://";
const cache = new Map<string, string>(); // uuid → data URL
const pending = new Map<string, Promise<string>>();

export function isMindMergeSrc(src: string | null | undefined): boolean {
  return typeof src === "string" && src.startsWith(PREFIX);
}

/** Synchronous cache peek — lets a render paint instantly when the bytes already crossed. */
export function cachedAttachmentSrc(src: string): string | null {
  return cache.get(src.slice(PREFIX.length)) ?? null;
}

/** vault://<uuid> → data URL. Rejects are cached NOWHERE — a locked vault that refuses now must
    be allowed to succeed after unlock, so failures stay retryable. */
export function resolveAttachmentSrc(src: string): Promise<string> {
  const uuid = src.slice(PREFIX.length);
  const hit = cache.get(uuid);
  if (hit) return Promise.resolve(hit);
  const inFlight = pending.get(uuid);
  if (inFlight) return inFlight;
  const p = mindmergeApi()
    .getAttachment(uuid)
    .then((a) => {
      const url = `data:${a.mime};base64,${a.dataBase64}`;
      cache.set(uuid, url);
      pending.delete(uuid);
      return url;
    })
    .catch((e: unknown) => {
      pending.delete(uuid);
      throw e;
    });
  pending.set(uuid, p);
  return p;
}
