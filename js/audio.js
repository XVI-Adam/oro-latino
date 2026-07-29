// audio.js — soft procedural sound. Muted by default; nothing loads and no
// AudioContext is created until the user actually turns it on, so this costs
// exactly nothing on first paint and adds no assets.
//
//   gate rattle — filtered noise burst, pitched by impact strength
//   chain clink — a few detuned metallic partials with a fast decay

export class Sound {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.bus = null;
    this._noise = null;
    this._last = 0;
  }

  /** Lazily build the graph on first unmute (needs a user gesture anyway). */
  _ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.bus = this.ctx.createGain();
    this.bus.gain.value = 0.35;          // soft by design
    this.bus.connect(this.ctx.destination);
    return true;
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) {
      if (!this._ensure()) { this.enabled = false; return false; }
      this.ctx.resume?.();
    }
    return this.enabled;
  }

  toggle() { return this.setEnabled(!this.enabled); }

  _noiseBuffer() {
    if (this._noise) return this._noise;
    const n = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  /** Metal shutter rattling — `strength` 0…1. */
  rattle(strength = 0.5) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this._last < 0.06) return;       // don't machine-gun it
    this._last = now;
    const s = Math.max(0.05, Math.min(1, strength));

    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    src.playbackRate.value = 0.8 + s * 0.5;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + s * 1500;
    bp.Q.value = 1.1;

    const g = this.ctx.createGain();
    const dur = 0.10 + s * 0.22;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.5 * s, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0007, now + dur);

    src.connect(bp); bp.connect(g); g.connect(this.bus);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  /** Gold links settling against each other — `strength` 0…1. */
  clink(strength = 0.5) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const s = Math.max(0.08, Math.min(1, strength));
    // a few inharmonic partials read as small metal
    const partials = [2100, 3170, 4480, 5900];
    partials.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = f * (0.94 + Math.random() * 0.12);
      const g = this.ctx.createGain();
      const dur = 0.16 + Math.random() * 0.12;
      const amp = (0.10 * s) / (i + 1);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(amp, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0005, now + dur);
      o.connect(g); g.connect(this.bus);
      o.start(now);
      o.stop(now + dur + 0.02);
    });
  }
}
