/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The ONE alert-sound playback path (fix-pass FIX 3): decode IPC bytes with WebAudio —
// AudioContext.decodeAudioData on the in-memory buffer, then a one-shot BufferSource. The app's
// CSP has no media-src directive, so blob:-URL <audio> is BLOCKED by default-src 'self'; WebAudio
// performs no resource load, so the CSP stays exactly as tight as it is. Used by the settings
// preview buttons AND the break-reminder toast — one path, no divergence.

let ctx: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;

export async function playSoundData(data: { mime: string; base64: string }): Promise<void> {
  const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
  ctx ??= new AudioContext();
  try { playing?.stop(); } catch { /* already ended */ }
  const buffer = await ctx.decodeAudioData(bytes.buffer);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  playing = source;
}
