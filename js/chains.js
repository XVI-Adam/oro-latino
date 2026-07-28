// chains.js — a rail of draggable gold chains simulated with Verlet integration,
// engineered so every chain always returns to a clean hanging rest.
//
// Four cooperating systems keep the case honest:
//   1. Baked rest pose  — at load each chain converges under gravity only; the
//      resulting particle positions are the ground truth for "settled".
//   2. Settle assist    — while not dragged, a weak spring pulls each particle
//      toward its rest pose, gated by kinetic energy (≈0 while swinging hard,
//      ramping up as it slows) + linear damping + quadratic air drag.
//   3. Sleep / wake     — once kinetic energy stays low for ~30 frames a chain
//      eases to its rest pose over 300ms, sleeps, and is baked into the static
//      background composite; proximity wakes it (and its neighbors) again.
//   4. Lane + loop      — a soft horizontal lane centered on the disc keeps a
//      chain in its own slot; cross-strand constraints keep the two strands of
//      the loop parallel so it can never rest tangled with a neighbor.
//
// Only awake/settling chains are simulated & drawn live; sleeping chains render
// from a pre-composited offscreen layer, restoring the per-frame perf win.

import { DESIGN, PALETTE } from './config.js';
import { CHAIN_STYLES, PENDANT_TYPES } from './jewelry.js';

// ── tuning (defaults; damping/settleSpring/sleepThreshold/laneWidth are live) ─
const FIXED = 1 / 60;      // fixed physics timestep (s)
const MAX_STEPS = 5;       // catch-up cap (avoids the spiral of death)
const GRAVITY = 2100;      // px/s²
const ITER = 6;            // constraint relaxation iterations
const AIR = 0.045;         // quadratic air-drag coefficient (big swings bleed fast)
const KE_LIVELY = 2.5;     // kinetic energy above which settle assist ≈ 0
const LANE_K = 24;         // lane restoring stiffness (px/s² per px of overshoot)
const SLEEP_FRAMES = 30;   // calm frames before a chain begins settling to sleep
const BLEND_MS = 300;      // eased blend-to-rest duration
const BAKE_MAX = 700;      // max iterations when baking the rest pose
const GRAB_RADIUS = 46;    // px — how close a pointer must be to grab
const BREEZE_AMP = 210;    // idle sway acceleration (small: must stay sub-sleep)
const BREEZE_FREQ = 0.9;   // rad/s

const DEFAULT_PARAMS = {
  damping: 0.985,          // velocity retained per step
  settleSpring: 34,        // settle-assist stiffness at zero energy (px/s² per px)
  sleepThreshold: 0.08,    // avg per-particle energy below which a chain is calm
  laneWidth: 90,           // ± lane half-width around the disc (px)
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

// Tiny deterministic PRNG so the rail looks the same every load.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── a single Verlet chain ─────────────────────────────────────────────────
class Chain {
  constructor(index, discX, discY, rng, spec) {
    this.index = index;
    this.discX = discX;
    this.discY = discY;
    this.phase = rng() * Math.PI * 2;      // breeze phase offset

    this.style = spec.style;               // link style: rope/box/figaro/cuban
    this.gauge = spec.gauge;               // per-chain link thickness
    this.pendantType = spec.pendantType;   // cross/crucifix/medallion/tablet/null

    const N = 16 + Math.floor(rng() * 7);  // 16–22 particles
    this.restLen = 26 + rng() * 12;        // segment length → varied chain drops
    const sep = 20 + rng() * 8;            // gap between the two top pins
    this.sep = sep;
    this.pinL = { x: discX - sep / 2, y: discY };
    this.pinR = { x: discX + sep / 2, y: discY };

    // pendant particle: the lowest point of the drape; a real pendant weighs more
    this.pendant = Math.floor(N / 2);
    const pendantMass = spec.pendantType ? 4 + rng() * 3 : 1.6;

    this.particles = [];
    const drop = this.restLen * (N - 1) / 2 * 0.96;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      // seed an arch so settling is stable (relaxation finds the true catenary)
      const x = this.pinL.x + (this.pinR.x - this.pinL.x) * t;
      const y = discY + Math.sin(Math.PI * t) * drop;
      const pinned = i === 0 || i === N - 1;
      const w = pinned ? 0 : (i === this.pendant ? 1 / pendantMass : 1);
      this.particles.push({ x, y, px: x, py: y, t, w, baseW: w });
    }

    this.constraints = [];
    for (let i = 0; i < N - 1; i++) {
      this.constraints.push({ a: i, b: i + 1, rest: this.restLen });
    }
    this.crossPairs = []; // built after the rest pose exists (loop integrity)

    this.grabbed = -1;
    this.calmFrames = 0;
    this.sleepState = 'asleep'; // 'awake' | 'settling' | 'asleep'
    this.blendFrom = null;
    this.blendT = 0;

    this._bakeRestPose();
  }

  // ── system 1: baked rest pose ───────────────────────────────────────────
  _bakeRestPose() {
    // Converge privately under gravity + distance constraints only (no breeze,
    // no assist, no lane) — a straight vertical hang under the pendant's weight.
    for (let i = 0; i < BAKE_MAX; i++) {
      this.integrate(FIXED, {});
      this.satisfy(ITER);
      if (i > 40 && this.energy() < 1e-5) break;
    }
    for (const p of this.particles) { p.px = p.x; p.py = p.y; }
    this.restPose = this.particles.map((p) => ({ x: p.x, y: p.y }));
    this._buildCrossPairs();
    this.sleepState = 'asleep';
  }

  // ── system 4: cross-strand constraints for loop integrity ───────────────
  _buildCrossPairs() {
    const N = this.particles.length;
    const mid = this.pendant;
    const rp = this.restPose;
    for (const f of [0.28, 0.5, 0.72, 0.9]) {
      const li = Math.round(f * mid);
      const ri = N - 1 - li;
      if (li < 1 || li >= ri) continue;
      const restD = Math.hypot(rp[ri].x - rp[li].x, rp[ri].y - rp[li].y);
      // clamp band: keeps strands from crossing (min) or scissoring open (max)
      this.crossPairs.push({
        a: li, b: ri,
        min: Math.max(4, restD * 0.45),
        max: restD * 1.9 + 30,
      });
    }
  }

  // ── integration (gravity + optional breeze/assist/lane) ─────────────────
  integrate(dt, { breezeAccel = 0, assistK = 0, laneWidth = Infinity, damping = 0.985 }) {
    const dt2 = dt * dt;
    const P = this.particles;
    const rp = this.restPose;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (p.w === 0) continue; // pinned or currently grabbed
      let vx = (p.x - p.px) * damping;
      let vy = (p.y - p.py) * damping;
      // quadratic air drag — high speeds lose a larger fraction, tiny sway persists
      const qd = 1 / (1 + AIR * Math.hypot(vx, vy));
      vx *= qd; vy *= qd;

      let ax = breezeAccel * Math.sin(Math.PI * p.t);
      let ay = GRAVITY;
      if (assistK > 0 && rp) {              // system 2: settle assist toward rest
        ax += assistK * (rp[i].x - p.x);
        ay += assistK * (rp[i].y - p.y);
      }
      const off = p.x - this.discX;         // system 4: soft horizontal lane
      if (off > laneWidth) ax -= LANE_K * (off - laneWidth);
      else if (off < -laneWidth) ax -= LANE_K * (off + laneWidth);

      p.px = p.x; p.py = p.y;
      p.x += vx + ax * dt2;
      p.y += vy + ay * dt2;
    }
  }

  satisfy(iters) {
    const P = this.particles;
    for (let k = 0; k < iters; k++) {
      for (const c of this.constraints) {
        const a = P[c.a], b = P[c.b];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const wsum = a.w + b.w;
        if (wsum === 0) continue;
        const diff = (d - c.rest) / d;
        const fa = a.w / wsum, fb = b.w / wsum;
        dx *= diff; dy *= diff;
        a.x += dx * fa; a.y += dy * fa;
        b.x -= dx * fb; b.y -= dy * fb;
      }
      // cross-strand band clamp (loop can flex but never cross or scissor open)
      for (const cp of this.crossPairs) {
        const a = P[cp.a], b = P[cp.b];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        let target = 0;
        if (d > cp.max) target = cp.max;
        else if (d < cp.min) target = cp.min;
        else continue;
        const wsum = a.w + b.w;
        if (wsum === 0) continue;
        const diff = (d - target) / d;
        const fa = a.w / wsum, fb = b.w / wsum;
        dx *= diff; dy *= diff;
        a.x += dx * fa; a.y += dy * fa;
        b.x -= dx * fb; b.y -= dy * fb;
      }
    }
  }

  // ── one simulation step for an awake chain ──────────────────────────────
  step(dt, simTime, params) {
    const ke = this.energy();
    const assistK = params.settleSpring * clamp(1 - ke / KE_LIVELY, 0, 1);
    const breezeAccel = BREEZE_AMP * Math.sin(simTime * BREEZE_FREQ + this.phase);
    this.integrate(dt, { breezeAccel, assistK, laneWidth: params.laneWidth, damping: params.damping });
    this.satisfy(ITER);
  }

  // ── system 3: sleep blend ───────────────────────────────────────────────
  beginSettle() {
    this.blendFrom = this.particles.map((p) => ({ x: p.x, y: p.y }));
    this.blendT = 0;
    this.sleepState = 'settling';
  }

  blendStep(dt) {
    this.blendT += dt * 1000;
    const e = easeInOutCubic(clamp(this.blendT / BLEND_MS, 0, 1));
    const P = this.particles, from = this.blendFrom, rp = this.restPose;
    for (let i = 0; i < P.length; i++) {
      P[i].x = from[i].x + (rp[i].x - from[i].x) * e;
      P[i].y = from[i].y + (rp[i].y - from[i].y) * e;
      P[i].px = P[i].x; P[i].py = P[i].y; // zero velocity through the blend
    }
    return this.blendT >= BLEND_MS;
  }

  finishSettle() {
    const P = this.particles, rp = this.restPose;
    for (let i = 0; i < P.length; i++) {
      P[i].x = rp[i].x; P[i].y = rp[i].y; P[i].px = rp[i].x; P[i].py = rp[i].y;
    }
    this.sleepState = 'asleep';
    this.calmFrames = 0;
  }

  wake() { this.sleepState = 'awake'; this.calmFrames = 0; }

  // ── grabbing ──────────────────────────────────────────────────────────
  nearest(x, y) {
    let best = -1, bd = GRAB_RADIUS * GRAB_RADIUS;
    for (let i = 1; i < this.particles.length - 1; i++) {
      const p = this.particles[i];
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  grab(i, x, y) {
    this.grabbed = i;
    const p = this.particles[i];
    p.w = 0;                 // immovable by constraints while held
    p.x = p.px = x;
    p.y = p.py = y;
  }

  drag(x, y) {
    if (this.grabbed < 0) return;
    const p = this.particles[this.grabbed];
    p.px = p.x; p.py = p.y;  // velocity = pointer delta → throwable on release
    p.x = x; p.y = y;
  }

  release() {
    if (this.grabbed < 0) return;
    this.particles[this.grabbed].w = this.particles[this.grabbed].baseW;
    this.grabbed = -1;
  }

  energy() {
    let e = 0;
    for (const p of this.particles) {
      if (p.w === 0) continue;
      e += (p.x - p.px) ** 2 + (p.y - p.py) ** 2;
    }
    return e / this.particles.length;
  }

  // ── rendering ─────────────────────────────────────────────────────────
  draw(ctx, jewelry) {
    const P = this.particles;
    this._disc(ctx);
    jewelry.strokeChain(ctx, P, this.style, this.gauge);
    if (this.pendantType) {
      const p = P[this.pendant];
      const a = P[this.pendant - 1], b = P[this.pendant + 1];
      const ang = Math.atan2(p.y - (a.y + b.y) / 2, p.x - (a.x + b.x) / 2);
      jewelry.stampPendant(ctx, this.pendantType, p.x, p.y, ang, this.gauge);
    }
  }

  _disc(ctx) {
    const { discX: x, discY: y } = this;
    ctx.fillStyle = '#0c0c0d';
    ctx.fillRect(x - 3, y - 26, 6, 20); // hook stem into the rail
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, 14);
    g.addColorStop(0, PALETTE.goldHi);
    g.addColorStop(1, PALETTE.goldLo);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1206';
    ctx.fill();
  }

  drawDebug(ctx, laneWidth) {
    const P = this.particles;
    // lane bounds
    if (laneWidth != null) {
      ctx.strokeStyle = 'rgba(226,58,46,0.25)';
      ctx.setLineDash([4, 6]); ctx.lineWidth = 1;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(this.discX + s * laneWidth, this.discY);
        ctx.lineTo(this.discX + s * laneWidth, this.discY + 620);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // distance constraints
    ctx.strokeStyle = 'rgba(0,229,255,0.7)'; ctx.lineWidth = 1;
    for (const c of this.constraints) {
      ctx.beginPath(); ctx.moveTo(P[c.a].x, P[c.a].y); ctx.lineTo(P[c.b].x, P[c.b].y); ctx.stroke();
    }
    // cross-strand loop constraints
    ctx.strokeStyle = 'rgba(255,0,200,0.55)'; ctx.lineWidth = 1.4;
    for (const cp of this.crossPairs) {
      ctx.beginPath(); ctx.moveTo(P[cp.a].x, P[cp.a].y); ctx.lineTo(P[cp.b].x, P[cp.b].y); ctx.stroke();
    }
    // particles
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.w === 0 ? 4 : (i === this.pendant ? 5 : 2.6), 0, Math.PI * 2);
      ctx.fillStyle = p.w === 0 ? '#ff3b30' : (i === this.pendant ? '#ffd60a' : '#00e5ff');
      ctx.fill();
    }
  }
}

// ── the rail of chains ─────────────────────────────────────────────────────
export class ChainRail {
  /**
   * @param {Stage} stage
   * @param {Jewelry} jewelry
   * @param {(index:number)=>void} onTap
   */
  constructor(stage, jewelry, onTap) {
    this.stage = stage;
    this.jewelry = jewelry;
    this.onTap = onTap || (() => {});
    this.debug = false;
    this.railY = 210;
    this.simTime = 0;
    this._acc = 0;
    this.params = { ...DEFAULT_PARAMS };

    const rng = mulberry32(1337); // deterministic layout every load
    this.chains = [];
    const COUNT = 22;
    const x0 = 150, x1 = DESIGN.W - 150;
    const pendants = [...PENDANT_TYPES, null, null];
    for (let i = 0; i < COUNT; i++) {
      const x = x0 + (x1 - x0) * (i / (COUNT - 1));
      const spec = {
        style: CHAIN_STYLES[i % CHAIN_STYLES.length],
        gauge: 0.82 + rng() * 0.5,
        pendantType: pendants[i % pendants.length],
      };
      this.chains.push(new Chain(i, x, this.railY, rng, spec));
    }
    this.spacing = (x1 - x0) / (COUNT - 1);

    // Live set = chains that are awake or settling (simulated + drawn on top).
    this.active = new Set();
    this.dragging = false;
    this.dragChain = -1;
    this._downX = 0; this._downY = 0; this._moved = 0;

    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d');
    this._layerDpr = 0;
    this._needsComposite = true;
  }

  // ── wake / sleep set management ─────────────────────────────────────────
  _neighbors(i) {
    const s = [];
    for (let k = i - 1; k <= i + 1; k++) if (k >= 0 && k < this.chains.length) s.push(k);
    return s;
  }

  /** Wake chain i and its two neighbors (pulling them out of the composite). */
  activate(i) {
    let changed = false;
    for (const k of this._neighbors(i)) {
      const c = this.chains[k];
      if (c.sleepState === 'asleep') { changed = true; }
      c.wake();                 // asleep → awake, or cancel an in-progress settle
      if (!this.active.has(k)) this.active.add(k);
    }
    if (changed) this._needsComposite = true;
  }

  _chainAtX(x) {
    let best = 0, bd = Infinity;
    for (const c of this.chains) {
      const d = Math.abs(c.discX - x);
      if (d < bd) { bd = d; best = c.index; }
    }
    return best;
  }

  // ── input ───────────────────────────────────────────────────────────────
  pointerDown(x, y) {
    this._downX = x; this._downY = y; this._moved = 0;
    let best = -1, bestP = -1, bd = GRAB_RADIUS * GRAB_RADIUS;
    for (const c of this.chains) {
      const i = c.nearest(x, y);
      if (i < 0) continue;
      const p = c.particles[i];
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = c.index; bestP = i; }
    }
    if (best < 0) return false;
    this.activate(best);
    this.chains[best].grab(bestP, x, y);
    this.dragging = true;
    this.dragChain = best;
    return true;
  }

  pointerMove(x, y, isDown) {
    if (this.dragging) {
      this._moved += Math.hypot(x - this._downX, y - this._downY);
      this.chains[this.dragChain].drag(x, y);
      return;
    }
    if (!isDown) {
      const i = this._chainAtX(x);
      if (Math.abs(this.chains[i].discX - x) < this.spacing * 1.2) this.activate(i);
    }
  }

  pointerUp() {
    if (!this.dragging) return;
    const c = this.chains[this.dragChain];
    const tap = this._moved < 8;
    c.release();
    this.dragging = false;
    const idx = this.dragChain;
    this.dragChain = -1;
    if (tap) this.onTap(idx);
    // stays awake and decays; the settle/sleep systems bring it home.
  }

  toggleDebug() { this.debug = !this.debug; }

  // ── simulation + sleep/wake bookkeeping ─────────────────────────────────
  update(dt) {
    if (dt > 0) this.fps = this.fps ? this.fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;

    this._acc += Math.min(dt, 0.05);
    let steps = 0;
    while (this._acc >= FIXED && steps < MAX_STEPS) {
      this.simTime += FIXED;
      for (const i of this.active) {
        const c = this.chains[i];
        if (c.sleepState === 'awake') c.step(FIXED, this.simTime, this.params);
      }
      this._acc -= FIXED;
      steps++;
    }
    if (steps === MAX_STEPS) this._acc = 0;

    // per-frame: drive chains toward sleep, and finish blends
    const done = [];
    for (const i of this.active) {
      const c = this.chains[i];
      if (c.sleepState === 'awake') {
        if (c.grabbed >= 0) { c.calmFrames = 0; continue; }
        if (c.energy() < this.params.sleepThreshold) c.calmFrames++; else c.calmFrames = 0;
        if (c.calmFrames >= SLEEP_FRAMES) c.beginSettle();
      } else if (c.sleepState === 'settling') {
        if (c.blendStep(dt)) { c.finishSettle(); done.push(i); }
      }
    }
    for (const i of done) { this.active.delete(i); this._needsComposite = true; }
  }

  /** Chains currently in motion (awake or settling). */
  simCount() {
    let n = 0;
    for (const i of this.active) if (this.chains[i].sleepState !== 'asleep') n++;
    return n;
  }

  // ── rendering ─────────────────────────────────────────────────────────────
  _ensureLayer() {
    const dpr = this.stage.dpr;
    const w = Math.round(DESIGN.W * dpr);
    const h = Math.round(DESIGN.H * dpr);
    if (this.layer.width !== w || this.layer.height !== h || this._layerDpr !== dpr) {
      this.layer.width = w;
      this.layer.height = h;
      this._layerDpr = dpr;
      this._needsComposite = true;
    }
  }

  _recomposite() {
    const ctx = this.lctx;
    ctx.setTransform(this._layerDpr, 0, 0, this._layerDpr, 0, 0);
    ctx.clearRect(0, 0, DESIGN.W, DESIGN.H);
    this._rail(ctx);
    for (const c of this.chains) {
      if (!this.active.has(c.index)) c.draw(ctx, this.jewelry); // asleep chains only
    }
    this._needsComposite = false;
  }

  draw(ctx, now) {
    this._ensureLayer();

    if (this.debug) {
      this._rail(ctx);
      for (const c of this.chains) { c.draw(ctx, this.jewelry); c.drawDebug(ctx, this.params.laneWidth); }
      this._hud(ctx);
      return;
    }

    if (this._needsComposite) this._recomposite();
    ctx.drawImage(this.layer, 0, 0, DESIGN.W, DESIGN.H); // sleeping chains (static)
    for (const i of this.active) this.chains[i].draw(ctx, this.jewelry); // live chains
  }

  _rail(ctx) {
    const y = this.railY;
    const g = ctx.createLinearGradient(0, y - 30, 0, y - 6);
    g.addColorStop(0, '#3a3f49');
    g.addColorStop(1, '#14171d');
    ctx.fillStyle = g;
    ctx.fillRect(60, y - 30, DESIGN.W - 120, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(60, y - 30, DESIGN.W - 120, 3);
  }

  _hud(ctx) {
    const p = this.params;
    ctx.save();
    ctx.font = '600 20px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#00e5ff';
    ctx.textAlign = 'left';
    const asleep = this.chains.length - this.simCount();
    ctx.fillText(
      `DEBUG · sim ${this.simCount()}  asleep ${asleep}/${this.chains.length}  ·  ${Math.round(this.fps || 0)} fps`,
      70, this.railY + 600);
    ctx.fillStyle = 'rgba(0,229,255,0.7)';
    ctx.font = '500 16px ui-monospace, Menlo, monospace';
    ctx.fillText(
      `damping ${p.damping.toFixed(3)}  ·  settleSpring ${p.settleSpring.toFixed(0)}  ·  ` +
      `sleepThresh ${p.sleepThreshold.toFixed(3)}  ·  laneWidth ${p.laneWidth.toFixed(0)}`,
      70, this.railY + 626);
    ctx.restore();
  }
}
