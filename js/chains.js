// chains.js — a rail of draggable gold chains simulated with Verlet integration.
//
// Each chain is a particle rope draped over a disc holder: BOTH top ends are
// pinned to the disc, so gravity pulls it into a natural catenary sag (a single
// pin would hang straight). Distance constraints are relaxed 6× per step. The
// tip pendant carries extra mass via inverse-mass weighting, so it moves less
// per iteration → more swing inertia.
//
// Performance: only the touched chain + its two neighbors (plus any still
// settling after release) are actively simulated. Every resting chain is drawn
// once into an offscreen "rest layer" and blitted; that layer is recomposited
// only when the active set changes. Hovering near a chain wakes it.

import { DESIGN, PALETTE } from './config.js';

// ── tuning ───────────────────────────────────────────────────────────────
const FIXED = 1 / 60;      // fixed physics timestep (s)
const MAX_STEPS = 5;       // catch-up cap (avoids the spiral of death)
const GRAVITY = 2100;      // px/s²
const DAMP = 0.985;        // velocity retention per step (air drag)
const ITER = 6;            // constraint relaxation iterations
const GRAB_RADIUS = 46;    // px — how close a pointer must be to grab
const BREEZE_AMP = 460;    // idle sway acceleration (px/s²)
const BREEZE_FREQ = 0.9;   // rad/s
const SETTLE_E = 0.05;     // per-particle energy below which a chain is "at rest"
const SETTLE_FRAMES = 40;  // consecutive calm frames before baking to rest

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

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
  constructor(index, discX, discY, rng) {
    this.index = index;
    this.discX = discX;
    this.discY = discY;
    this.phase = rng() * Math.PI * 2;      // breeze phase offset

    const N = 16 + Math.floor(rng() * 7);  // 16–22 particles
    this.restLen = 26 + rng() * 12;        // segment length → varied chain drops
    const sep = 20 + rng() * 8;            // gap between the two top pins
    this.pinL = { x: discX - sep / 2, y: discY };
    this.pinR = { x: discX + sep / 2, y: discY };

    // pendant particle: the lowest point of the drape, given extra mass
    this.pendant = Math.floor(N / 2);
    const pendantMass = 4 + rng() * 3;

    this.particles = [];
    const drop = this.restLen * (N - 1) / 2 * 0.96;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      // seed an arch so settling is stable (relaxation finds the true catenary)
      const x = this.pinL.x + (this.pinR.x - this.pinL.x) * t;
      const y = discY + Math.sin(Math.PI * t) * drop;
      const pinned = i === 0 || i === N - 1;
      this.particles.push({
        x, y, px: x, py: y, t,
        w: pinned ? 0 : (i === this.pendant ? 1 / pendantMass : 1),
        baseW: pinned ? 0 : (i === this.pendant ? 1 / pendantMass : 1),
      });
    }

    this.constraints = [];
    for (let i = 0; i < N - 1; i++) {
      this.constraints.push({ a: i, b: i + 1, rest: this.restLen });
    }

    this.grabbed = -1;
    this.calm = 0;

    this._settle(140); // reach the resting catenary once, up front
    this.bakeRest();
  }

  _settle(steps) {
    for (let s = 0; s < steps; s++) {
      this.integrate(FIXED, 0);
      this.satisfy(ITER);
    }
    // zero out residual velocity so the baked pose is truly static
    for (const p of this.particles) { p.px = p.x; p.py = p.y; }
  }

  bakeRest() {
    this.rest = this.particles.map((p) => ({ x: p.x, y: p.y }));
  }

  integrate(dt, simTime) {
    const g = GRAVITY * dt * dt;
    const sway = BREEZE_AMP * Math.sin(simTime * BREEZE_FREQ + this.phase) * dt * dt;
    for (const p of this.particles) {
      if (p.w === 0) continue; // pinned or currently grabbed
      const vx = (p.x - p.px) * DAMP;
      const vy = (p.y - p.py) * DAMP;
      p.px = p.x;
      p.py = p.y;
      // breeze sways the middle of the drape most (sin curve over its length)
      p.x += vx + sway * Math.sin(Math.PI * p.t);
      p.y += vy + g;
    }
  }

  satisfy(iters) {
    const P = this.particles;
    for (let k = 0; k < iters; k++) {
      for (const c of this.constraints) {
        const a = P[c.a];
        const b = P[c.b];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = (d - c.rest) / d;
        const wsum = a.w + b.w;
        if (wsum === 0) continue;
        const fa = a.w / wsum;
        const fb = b.w / wsum;
        dx *= diff; dy *= diff;
        a.x += dx * fa; a.y += dy * fa;
        b.x -= dx * fb; b.y -= dy * fb;
      }
    }
  }

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
    const p = this.particles[this.grabbed];
    p.w = p.baseW;           // restores mass → carries momentum
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
  draw(ctx) {
    const P = this.particles;
    this._disc(ctx);

    // soft cast shadow
    ctx.save();
    ctx.translate(3, 5);
    this._strokeThrough(ctx, P, 8, 'rgba(0,0,0,0.28)');
    ctx.restore();

    // body → highlight → link gaps (dashed) for a woven-gold read
    this._strokeThrough(ctx, P, 7.5, PALETTE.goldLo);
    this._strokeThrough(ctx, P, 5, PALETTE.gold);
    this._strokeThrough(ctx, P, 2, PALETTE.goldHi);
    ctx.save();
    ctx.setLineDash([2, 6]);
    this._strokeThrough(ctx, P, 5.5, 'rgba(60,40,0,0.5)');
    ctx.restore();

    this._pendant(ctx, P[this.pendant]);
  }

  _strokeThrough(ctx, P, width, color) {
    ctx.beginPath();
    ctx.moveTo(P[0].x, P[0].y);
    for (let i = 1; i < P.length - 1; i++) {
      const mx = (P[i].x + P[i + 1].x) / 2;
      const my = (P[i].y + P[i + 1].y) / 2;
      ctx.quadraticCurveTo(P[i].x, P[i].y, mx, my);
    }
    ctx.lineTo(P[P.length - 1].x, P[P.length - 1].y);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
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

  _pendant(ctx, p) {
    const s = 15;
    ctx.save();
    ctx.translate(p.x, p.y + s * 0.7);
    // gold teardrop
    ctx.beginPath();
    ctx.moveTo(0, s);
    ctx.quadraticCurveTo(s, s * 0.2, 0, -s);
    ctx.quadraticCurveTo(-s, s * 0.2, 0, s);
    const g = ctx.createLinearGradient(-s, -s, s, s);
    g.addColorStop(0, PALETTE.goldHi);
    g.addColorStop(0.5, PALETTE.gold);
    g.addColorStop(1, PALETTE.goldLo);
    ctx.fillStyle = g;
    ctx.fill();
    // vermilion gem
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.vermilion;
    ctx.fill();
    ctx.restore();
  }

  drawDebug(ctx) {
    const P = this.particles;
    ctx.strokeStyle = 'rgba(0,229,255,0.7)';
    ctx.lineWidth = 1;
    for (const c of this.constraints) {
      ctx.beginPath();
      ctx.moveTo(P[c.a].x, P[c.a].y);
      ctx.lineTo(P[c.b].x, P[c.b].y);
      ctx.stroke();
    }
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
   * @param {Stage} stage  (for device-pixel ratio when sizing the rest layer)
   * @param {(index:number)=>void} onTap  quick tap on a chain (→ piece detail)
   */
  constructor(stage, onTap) {
    this.stage = stage;
    this.onTap = onTap || (() => {});
    this.debug = false;
    this.railY = 210;
    this.simTime = 0;
    this._acc = 0;

    const rng = mulberry32(1337); // deterministic layout every load
    this.chains = [];
    const COUNT = 22;
    const x0 = 150, x1 = DESIGN.W - 150;
    for (let i = 0; i < COUNT; i++) {
      const x = x0 + (x1 - x0) * (i / (COUNT - 1));
      this.chains.push(new Chain(i, x, this.railY, rng));
    }
    this.spacing = (x1 - x0) / (COUNT - 1);

    this.active = new Set();
    this.settleTimers = new Map();
    this.dragging = false;
    this.dragChain = -1;
    this._downX = 0; this._downY = 0; this._moved = 0;

    // offscreen rest layer
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d');
    this._layerDpr = 0;
    this._needsComposite = true;
  }

  // ── active-set management ───────────────────────────────────────────────
  _neighbors(i) {
    const s = [];
    for (let k = i - 1; k <= i + 1; k++) if (k >= 0 && k < this.chains.length) s.push(k);
    return s;
  }

  activate(i) {
    let changed = false;
    for (const k of this._neighbors(i)) {
      if (!this.active.has(k)) { this.active.add(k); changed = true; }
      this.settleTimers.set(k, 0);
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
    // grab the nearest particle across all chains within reach
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
    // proximity: wake the chain under the pointer (+ neighbors)
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
    // stays active until it settles
  }

  toggleDebug() { this.debug = !this.debug; }

  // ── simulation ────────────────────────────────────────────────────────────
  update(dt) {
    if (dt > 0) this.fps = this.fps ? this.fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;
    this._acc += Math.min(dt, 0.05);
    let steps = 0;
    while (this._acc >= FIXED && steps < MAX_STEPS) {
      this.simTime += FIXED;
      for (const i of this.active) {
        const c = this.chains[i];
        c.integrate(FIXED, this.simTime);
        c.satisfy(ITER);
      }
      this._acc -= FIXED;
      steps++;
    }
    if (steps === MAX_STEPS) this._acc = 0;

    // retire chains that have gone calm (and aren't being held)
    const retire = [];
    for (const i of this.active) {
      const c = this.chains[i];
      if (c.grabbed >= 0) { this.settleTimers.set(i, 0); continue; }
      const t = (this.settleTimers.get(i) || 0) + (c.energy() < SETTLE_E ? 1 : -1);
      const clamped = Math.max(0, t);
      this.settleTimers.set(i, clamped);
      if (clamped >= SETTLE_FRAMES) retire.push(i);
    }
    for (const i of retire) {
      this.chains[i].bakeRest();
      this.active.delete(i);
      this.settleTimers.delete(i);
      this._needsComposite = true;
    }
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
      if (!this.active.has(c.index)) c.draw(ctx);
    }
    this._needsComposite = false;
  }

  draw(ctx, now) {
    this._ensureLayer();

    if (this.debug) {
      this._rail(ctx);
      for (const c of this.chains) { c.draw(ctx); c.drawDebug(ctx); }
      this._hud(ctx);
      return;
    }

    if (this._needsComposite) this._recomposite();
    ctx.drawImage(this.layer, 0, 0, DESIGN.W, DESIGN.H); // rest layer (rail + calm chains)
    for (const i of this.active) this.chains[i].draw(ctx); // live chains on top
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
    ctx.save();
    ctx.font = '600 22px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#00e5ff';
    ctx.textAlign = 'left';
    ctx.fillText(`DEBUG · active: [${[...this.active].sort((a, b) => a - b).join(', ') || '—'}]  ` +
      `sim ${this.active.size}/${this.chains.length} chains  ·  ${Math.round(this.fps || 0)} fps`,
      70, this.railY + 620);
    ctx.restore();
  }
}
