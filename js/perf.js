// perf.js — always-on instrumentation. Every optimisation in this codebase has
// to be justified by one of these numbers moving, so the counters are cheap
// enough to leave running in production rather than being a debug-only path.
//
//   perf.begin('chainDraw') … perf.end('chainDraw')   → ms per subsystem
//   perf.countDrawImage(ctx)                          → wraps drawImage once
//   perf.frame()                                      → call once per rAF

const SUBSYSTEMS = ['physics', 'chainDraw', 'tagDraw', 'composite', 'glints'];

export class Perf {
  constructor() {
    this.fps = 0;
    this.frameMs = 0;
    this.drawImages = 0;      // this frame
    this.drawImagesAvg = 0;
    this.awake = 0;
    this.atlasMB = 0;
    this.atlasCount = 0;
    this.links = 0;           // links stamped this frame
    this.runs = 0;            // run-sprites stamped this frame
    this.budgetMB = 64;

    this._t = {};             // open timers
    this.ms = {};             // smoothed ms per subsystem
    for (const s of SUBSYSTEMS) this.ms[s] = 0;
    this._acc = {};
    this._lastFrame = 0;
    this._wrapped = new WeakSet();
  }

  begin(k) { this._t[k] = performance.now(); }
  end(k) {
    const t0 = this._t[k];
    if (t0 === undefined) return;
    this._acc[k] = (this._acc[k] || 0) + (performance.now() - t0);
    this._t[k] = undefined;
  }

  /** Wrap a context's drawImage exactly once so counting costs one increment. */
  countDrawImage(ctx) {
    if (!ctx || this._wrapped.has(ctx)) return;
    this._wrapped.add(ctx);
    const self = this;
    const orig = ctx.drawImage;
    ctx.drawImage = function (...a) { self.drawImages++; return orig.apply(this, a); };
  }

  /** Called once per rendered frame; rolls the accumulators into smoothed ms. */
  frame(now = performance.now()) {
    if (this._lastFrame) {
      const dt = now - this._lastFrame;
      this.frameMs = this.frameMs * 0.9 + dt * 0.1;
      if (dt > 0) this.fps = this.fps * 0.9 + (1000 / dt) * 0.1;
    }
    this._lastFrame = now;
    for (const s of SUBSYSTEMS) {
      this.ms[s] = this.ms[s] * 0.88 + (this._acc[s] || 0) * 0.12;
      this._acc[s] = 0;
    }
    this.drawImagesAvg = this.drawImagesAvg * 0.88 + this.drawImages * 0.12;
    this._frameDrawImages = this.drawImages;
    this.drawImages = 0;
    this.links = 0;
    this.runs = 0;
  }

  /** Recompute atlas memory from every live sprite surface. */
  measureAtlases(surfaces) {
    let bytes = 0, n = 0;
    for (const s of surfaces) {
      if (!s) continue;
      bytes += (s.width || 0) * (s.height || 0) * 4;
      n++;
    }
    this.atlasMB = bytes / (1024 * 1024);
    this.atlasCount = n;
    if (this.atlasMB > this.budgetMB) {
      console.warn(`[perf] atlas budget exceeded: ${this.atlasMB.toFixed(1)}MB ` +
                   `over ${this.budgetMB}MB across ${n} surfaces`);
    }
    return this.atlasMB;
  }

  snapshot() {
    return {
      fps: Math.round(this.fps),
      frameMs: +this.frameMs.toFixed(2),
      physics: +this.ms.physics.toFixed(2),
      chainDraw: +this.ms.chainDraw.toFixed(2),
      tagDraw: +this.ms.tagDraw.toFixed(2),
      composite: +this.ms.composite.toFixed(2),
      glints: +this.ms.glints.toFixed(2),
      drawImage: this._frameDrawImages || 0,
      drawImageAvg: Math.round(this.drawImagesAvg),
      awake: this.awake,
      atlasMB: +this.atlasMB.toFixed(1),
      atlases: this.atlasCount,
    };
  }
}

export const perf = new Perf();

// ── HUD ─────────────────────────────────────────────────────────────────────
export function buildPerfHUD(getSurfaces) {
  const el = document.createElement('div');
  el.id = 'perf-hud';
  document.getElementById('debug-panel').appendChild(el);

  const row = (k, v, warn) =>
    `<div class="ph-row${warn ? ' is-warn' : ''}"><span>${k}</span><b>${v}</b></div>`;

  let last = 0, lastAtlas = 0;
  const tick = (now) => {
    // atlases build lazily on first draw, so re-measure periodically
    if (getSurfaces && now - lastAtlas > 1000) {
      lastAtlas = now;
      perf.measureAtlases(getSurfaces());
    }
    if (now - last > 180) {            // the HUD itself must not cost anything
      last = now;
      const s = perf.snapshot();
      el.innerHTML =
        row('fps', s.fps, s.fps < 50) +
        row('frame ms', s.frameMs, s.frameMs > 20) +
        row('physics', s.physics) +
        row('chains', s.chainDraw, s.chainDraw > 8) +
        row('tags', s.tagDraw) +
        row('composite', s.composite) +
        row('glints', s.glints, s.glints > 2) +
        row('drawImage', s.drawImage, s.drawImage > 900) +
        row('awake', s.awake) +
        row('atlas MB', `${s.atlasMB} / ${perf.budgetMB}`, s.atlasMB > perf.budgetMB);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return el;
}
