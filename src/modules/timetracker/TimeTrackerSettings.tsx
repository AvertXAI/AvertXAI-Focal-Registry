/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker section for the SHARED Settings surface (canon: one platform Settings surface, not a
// settings page per app — the module's own gear/SettingsModal stayed removed). Rendered by
// src/views/Settings.tsx; this component lives in the module folder to keep the lane clean.
// Licence entry validates LOCALLY (hardcoded offline keys — no network call exists anywhere);
// break/idle settings ride the typed timetracker channels; Phase 2's DEFAULTS const stays the ONE
// source of truth — nothing here seeds anything. Sounds: all 17 bundled at every tier; custom
// uploads are the capped thing and cap refusal shows INLINE — no modal, no upsell styling.
import { useEffect, useRef, useState } from "react";
import type { TimeTrackerLicenseState, TimeTrackerSettings as TTSettings, TimeTrackerAlertSound } from "../../shared/types";
import Tip from "../../components/Tip";

// Session caches — repeat visits paint correct values on frame one (the Settings toggleCache pattern).
let licenseCache: TimeTrackerLicenseState | null = null;
let settingsCache: TTSettings | null = null;

const capText = (n: number | null): string => (n === null ? "Unlimited" : String(n));
const INTERVAL_PRESETS = [25, 50, 90];

export default function TimeTrackerSettings() {
  const api = window.api;
  const [lic, setLic] = useState<TimeTrackerLicenseState | null>(() => licenseCache);
  const [s, setS] = useState<TTSettings | null>(() => settingsCache);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sounds, setSounds] = useState<TimeTrackerAlertSound[]>([]);
  const [soundMsg, setSoundMsg] = useState<string | null>(null);
  const [selectedSound, setSelectedSound] = useState<string>("");
  // FIX 3: playback rides WebAudio (decodeAudioData on the in-memory bytes), NOT an <audio>
  // element on a blob: URL — the app's CSP has no media-src directive, so blob media falls back
  // to default-src 'self' and is BLOCKED (the diagnosed cause of the dead ▶ buttons). WebAudio
  // decodes bytes already in JS: no URL, no resource load, no CSP loosening needed.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playingRef = useRef<AudioBufferSourceNode | null>(null);
  const seeded = useRef(false);

  const refreshLicense = (st: TimeTrackerLicenseState): void => {
    licenseCache = st;
    setLic(st);
    if (!seeded.current) {
      setKeyDraft(st.licenseKey ?? "");
      seeded.current = true;
    }
  };
  const reloadSounds = (): void => {
    void api.timetracker.sounds.list().then(setSounds).catch(() => {});
    void api.timetracker.sounds.getSelected().then(setSelectedSound).catch(() => {});
  };

  useEffect(() => {
    void api.timetracker.license.get().then(refreshLicense).catch(() => {});
    void api.timetracker.settings.get().then((v) => { settingsCache = v; setS(v); }).catch(() => {});
    reloadSounds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist a partial change through the typed channel; the service clamps and echoes the clean set.
  const save = (patch: Partial<TTSettings>): void => {
    if (!s) return;
    const next = { ...s, ...patch };
    setS(next);
    settingsCache = next;
    void api.timetracker.settings.save(next).then((clean) => { settingsCache = clean; setS(clean); }).catch(() => {});
  };

  const applyKey = (): void => {
    void api.timetracker.license.setKey(keyDraft)
      .then((st) => {
        refreshLicense(st);
        const t = st.keyTiers.licenseKey;
        setKeyMsg(
          keyDraft.trim() === ""
            ? { ok: true, text: "Key cleared." }
            : t
              ? { ok: true, text: `${t === "business" ? "Business" : "Pro"} key recognised ✓` }
              : { ok: false, text: "Saved, but not recognised as a Pro or Business key — tier unchanged." }
        );
      })
      .catch((e: unknown) => setKeyMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }));
  };
  // FIX 3: bytes over IPC → WebAudio decode → one-shot buffer source. A second click stops the
  // previous clip and plays the new one. CSP-immune by construction (no URL is ever loaded).
  const play = (id: string): void => {
    void api.timetracker.sounds.read(id).then(async (data) => {
      const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
      const ctx = (audioCtxRef.current ??= new AudioContext());
      try { playingRef.current?.stop(); } catch { /* already ended */ }
      const buffer = await ctx.decodeAudioData(bytes.buffer);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
      playingRef.current = source;
    }).catch(() => {});
  };
  const uploadSound = (): void => {
    setSoundMsg(null);
    void api.timetracker.sounds.upload()
      .then((added) => { if (added) reloadSounds(); })
      .catch((e: unknown) => setSoundMsg(e instanceof Error ? e.message : String(e))); // cap refusal shows INLINE here
  };
  const removeSound = (id: string): void => {
    void api.timetracker.sounds.remove(id).then(reloadSounds).catch(() => {});
  };
  const selectSound = (id: string): void => {
    void api.timetracker.sounds.select(id).then(() => setSelectedSound(id)).catch(() => {});
  };

  const tierLabel = lic ? (lic.tier === "business" ? "Business" : lic.tier === "pro" ? "Pro" : "Free") : "…";

  return (
    <div className="ttset-wrap">
      <h2>TimeTracker</h2>

      {/* ---- Licence ---- */}
      <div className="field">
        <label>Licence</label>
        <p className="hint">
          Current tier: <b>{tierLabel}</b>
          {lic && (
            <> — caps: {capText(lic.caps.projects)} projects · {capText(lic.caps.timers)} concurrent timers ·{" "}
              {capText(lic.caps.soundUploads)} custom sound uploads. All 17 bundled alert sounds and unlimited
              adjustments at every tier.</>
          )}
        </p>
        <div className="ttset-keyrow">
          <input className="ttset-input" placeholder="XXXX-XXXX-XXXX-XXXX" value={keyDraft} aria-label="Licence key"
            onChange={(e) => { setKeyDraft(e.target.value); setKeyMsg(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") applyKey(); }} />
          <button className="btn" onClick={applyKey}>Apply</button>
        </div>
        {keyMsg && <p className="hint" style={{ color: keyMsg.ok ? "var(--mc-green)" : "#e0574f" }}>{keyMsg.text}</p>}
      </div>
      {/* FIX 8: the Marketplace ID input is deliberately GONE — a marketplace ID is TimeTracker's
          per-module CATALOGUE identifier (its SKU), not per-install user input; it belongs beside
          the licence constants in code. The timetracker.marketplaceId settings key and its service
          path remain untouched, and no purchase-ID or other field replaces this. */}
      <Tip id="TIP-TT-005" />

      {/* ---- Break reminders ---- */}
      <h2 className="mt">Break reminders</h2>
      <div className="field">
        <div className="setrow">
          <label htmlFor="ttbreak">Break reminders</label>
          <button id="ttbreak" role="switch" aria-checked={s?.breakEnabled ?? false}
            className={`switch${s?.breakEnabled ? " on" : ""}`}
            onClick={() => save({ breakEnabled: !(s?.breakEnabled ?? false) })} />
        </div>
        <p className="hint">Remind you to step away after a stretch of tracked work.</p>
      </div>
      <div className="field" style={{ marginTop: 18 }}>
        <div className="setrow">
          <label htmlFor="ttbreaksound">Play sound with reminder</label>
          <button id="ttbreaksound" role="switch" aria-checked={s?.breakSoundEnabled ?? true}
            className={`switch${s?.breakSoundEnabled ? " on" : ""}`}
            onClick={() => save({ breakSoundEnabled: !(s?.breakSoundEnabled ?? true) })} />
        </div>
      </div>
      <div className="field" style={{ marginTop: 18 }}>
        <label>Work interval (minutes)</label>
        <div className="ttset-presets">
          {INTERVAL_PRESETS.map((p) => (
            <button key={p} className={"ttset-preset" + (s?.breakIntervalMin === p ? " on" : "")} onClick={() => save({ breakIntervalMin: p })}>{p}</button>
          ))}
          <input className="ttset-input ttset-num" inputMode="numeric" aria-label="Custom work interval"
            value={s?.breakIntervalMin ?? ""} onChange={(e) => save({ breakIntervalMin: Number(e.target.value) || 1 })} />
        </div>
      </div>
      <div className="field" style={{ marginTop: 18 }}>
        <label>Break length (minutes, 0 = off)</label>
        <input className="ttset-input ttset-num" inputMode="numeric" aria-label="Break length"
          value={s?.breakLengthMin ?? ""} onChange={(e) => save({ breakLengthMin: Number(e.target.value) || 0 })} />
      </div>
      <div className="field" style={{ marginTop: 18 }}>
        <label>Idle threshold (minutes)</label>
        <input className="ttset-input ttset-num" inputMode="numeric" aria-label="Idle threshold"
          value={s?.idleThresholdMin ?? ""} onChange={(e) => save({ idleThresholdMin: Number(e.target.value) || 1 })} />
      </div>
      <div className="field" style={{ marginTop: 18 }}>
        <div className="setrow">
          <label htmlFor="ttautopause">Auto-pause the timer on reminder</label>
          <button id="ttautopause" role="switch" aria-checked={s?.breakAutopause ?? false}
            className={`switch${s?.breakAutopause ? " on" : ""}`}
            onClick={() => save({ breakAutopause: !(s?.breakAutopause ?? false) })} />
        </div>
      </div>

      {/* ---- Alert sound ---- */}
      {/* FIX 4: the custom-sound control sits top-right of the section header as "+ Add Alert";
          the tier cap still binds main-side and its refusal shows inline below. */}
      <div className="ttset-sectionhead">
        <h2 className="mt">Alert sound</h2>
        <button className="btn ttset-addalert" title="Add a custom alert sound (.mp3 / .wav)" onClick={uploadSound}>+ Add Alert</button>
      </div>
      {soundMsg && <p className="hint" style={{ color: "#e0574f" }}>{soundMsg}</p>}
      <div className="ttset-sounds">
        {sounds.map((snd) => (
          <div key={snd.id} className={"ttset-sound" + (snd.id === selectedSound ? " on" : "")}>
            <button className="ttset-soundpick" onClick={() => selectSound(snd.id)} aria-pressed={snd.id === selectedSound}>
              <span className="ttset-radio">{snd.id === selectedSound ? "●" : "○"}</span>
              {snd.displayName}
              {!snd.isBundled && <span className="ttset-customtag">custom</span>}
            </button>
            <button className="iconbtn" title={`Play ${snd.displayName}`} aria-label={`Play ${snd.displayName}`} onClick={() => play(snd.id)}>▶</button>
            {!snd.isBundled && (
              <button className="iconbtn" title="Remove" aria-label={`Remove ${snd.displayName}`} onClick={() => removeSound(snd.id)}>✕</button>
            )}
          </div>
        ))}
        {sounds.length === 0 && <p className="hint">Sounds unavailable — the bundled sound folder was not found.</p>}
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        Free, no-attribution alert sounds: pixabay.com/sound-effects,
        mixkit.co/free-sound-effects/notification
      </p>
    </div>
  );
}
