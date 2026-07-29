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
const CURSOR_SWIPE = 9;    // how strongly cursor motion drags nearby particles

const DEFAULT_PARAMS = {
  damping: 0.981,          // velocity retained per step (tuned for the long case chains)
  settleSpring: 34,        // settle-assist stiffness at zero energy (px/s² per px)
  sleepThreshold: 0.18,    // avg per-particle energy below which a chain is calm
                           // (~27 px/s drift — the 300ms eased blend hides it)
  laneWidth: 90,           // ± lane half-width around the disc (px)
  cursorForce: 2100,       // hover repulsion strength at the cursor (px/s²)
  cursorRadius: 160,       // hover influence radius (px)
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

    const scale = spec.scale ?? 1;         // overall size (storefront rail is smaller)
    const dropScale = spec.dropScale ?? 1; // lengthens the hang without fattening links
    const N = 16 + Math.floor(rng() * 7);  // 16–22 particles
    this.restLen = (26 + rng() * 12) * scale * dropScale; // segment length → chain drop
    const sep = (20 + rng() * 8) * scale;  // gap between the two top pins
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

    // Price tag: a short Verlet pendulum tied to one strand of the chain.
    this.piece = spec.piece || null;
    if (spec.tag !== false) this._buildTag(scale, rng);

    this._bakeRestPose();
  }

  _buildTag(scale, rng) {
    // tie it partway down one strand so it hangs clear of the pendant
    const anchorIdx = Math.max(1, Math.round(this.pendant * (0.52 + rng() * 0.12)));
    const a = this.particles[anchorIdx];
    const len = 20 * scale;
    this.tag = {
      anchorIdx,
      len,
      w: 58 * scale,
      h: 38 * scale,
      parts: [
        { x: a.x, y: a.y + len, px: a.x, py: a.y + len },
        { x: a.x, y: a.y + len * 2, px: a.x, py: a.y + len * 2 },
      ],
    };
  }

  /** One Verlet step for the tag pendulum (runs after the chain has settled). */
  _stepTag(dt, damping) {
    const T = this.tag;
    if (!T) return;
    const g = GRAVITY * 0.6 * dt * dt;
    for (const p of T.parts) {
      const vx = (p.x - p.px) * damping;
      const vy = (p.y - p.py) * damping;
      p.px = p.x; p.py = p.y;
      p.x += vx;
      p.y += vy + g;
    }
    const A = this.particles[T.anchorIdx];
    for (let k = 0; k < 4; k++) {
      this._tie(A, T.parts[0], T.len, false);   // anchor is driven by the chain
      this._tie(T.parts[0], T.parts[1], T.len, true);
    }
  }

  /** Distance constraint; `moveA` false pins the first point. */
  _tie(a, b, rest, moveA) {
    let dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    const diff = (d - rest) / d;
    if (moveA) {
      a.x += dx * diff * 0.5; a.y += dy * diff * 0.5;
      b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5;
    } else {
      b.x -= dx * diff; b.y -= dy * diff;
    }
  }

  /** Is (x,y) on the tag face? */
  tagHit(x, y) {
    const T = this.tag;
    if (!T) return false;
    const p = T.parts[1];
    return Math.abs(x - p.x) <= T.w * 0.75 && Math.abs(y - p.y) <= T.h * 1.1;
  }

  // ── system 1: baked rest pose ───────────────────────────────────────────
  _bakeRestPose() {
    // Converge privately under gravity + distance constraints only (no breeze,
    // no assist, no lane) — a straight vertical hang under the pendant's weight.
    for (let i = 0; i < BAKE_MAX; i++) {
      this.integrate(FIXED, {});
      this.satisfy(ITER);
      this._stepTag(FIXED, 0.96);
      if (i > 40 && this.energy() < 1e-5) break;
    }
    for (const p of this.particles) { p.px = p.x; p.py = p.y; }
    if (this.tag) {
      for (const p of this.tag.parts) { p.px = p.x; p.py = p.y; }
      this.tag.rest = this.tag.parts.map((p) => ({ x: p.x, y: p.y }));
    }
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

  // ── integration (gravity + optional breeze/assist/lane/cursor) ──────────
  integrate(dt, { breezeAccel = 0, assistK = 0, laneWidth = Infinity, damping = 0.985,
                  cursor = null, cursorForce = 0, cursorRadius = 0 }) {
    const dt2 = dt * dt;
    const P = this.particles;
    const rp = this.restPose;
    const cR2 = cursorRadius * cursorRadius;
    const cursorOn = cursor && cursor.active && cursorForce > 0;
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

      if (cursorOn) {                       // hover: push away + drag along the swipe
        const dxr = p.x - cursor.x, dyr = p.y - cursor.y;
        const d2 = dxr * dxr + dyr * dyr;
        if (d2 < cR2) {
          const d = Math.sqrt(d2) || 1e-6;
          const fall = 1 - d / cursorRadius;         // 0 at edge → 1 at cursor
          const rep = cursorForce * fall * fall;
          ax += (dxr / d) * rep + cursor.vx * CURSOR_SWIPE * fall;
          ay += (dyr / d) * rep + cursor.vy * CURSOR_SWIPE * fall;
        }
      }

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
  step(dt, simTime, params, cursor) {
    const ke = this.energy();
    const assistK = params.settleSpring * clamp(1 - ke / KE_LIVELY, 0, 1);
    const breezeAccel = BREEZE_AMP * Math.sin(simTime * BREEZE_FREQ + this.phase);
    this.integrate(dt, {
      breezeAccel, assistK, laneWidth: params.laneWidth, damping: params.damping,
      cursor, cursorForce: params.cursorForce, cursorRadius: params.cursorRadius,
    });
    this.satisfy(ITER);
    this._stepTag(dt, params.damping);
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
    if (this.tag && this.tag.rest) {
      this.tag.parts.forEach((p, i) => {
        p.x = this.tag.rest[i].x; p.y = this.tag.rest[i].y;
        p.px = p.x; p.py = p.y;
      });
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
    this._contactShadow(ctx);
    this._disc(ctx);
    jewelry.strokeChain(ctx, P, this.style, this.gauge);
    if (this.pendantType) {
      const p = P[this.pendant];
      const a = P[this.pendant - 1], b = P[this.pendant + 1];
      const ang = Math.atan2(p.y - (a.y + b.y) / 2, p.x - (a.x + b.x) / 2);
      // tight AO where the pendant rests against the velvet backing
      jewelry.ao(ctx, p.x, p.y + 16 * this.gauge, 20 * this.gauge, 8 * this.gauge, 0.5);
      jewelry.stampPendant(ctx, this.pendantType, p.x, p.y, ang, this.gauge);
    }
    this._drawTag(ctx);
  }

  /** Small white price tag swinging on its string. */
  _drawTag(ctx, highlight = false) {
    const T = this.tag;
    if (!T) return;
    const A = this.particles[T.anchorIdx];
    const a = T.parts[0], b = T.parts[1];

    // string
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(238,232,216,0.72)';
    ctx.lineWidth = Math.max(1, 1.6 * this.gauge);
    ctx.lineCap = 'round';
    ctx.stroke();

    const ang = Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2;
    const w = T.w, h = T.h;

    ctx.save();
    ctx.translate(b.x, b.y + h * 0.42);
    ctx.rotate(ang);

    // cast shadow so the tag sits off the felt
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 5, w, h);

    // paper
    ctx.fillStyle = highlight ? '#FFFFFF' : '#F6F2E6';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = highlight ? 'rgba(212,175,55,0.95)' : 'rgba(120,105,70,0.45)';
    ctx.lineWidth = highlight ? 2.2 : 1;
    ctx.strokeRect(-w / 2, -h / 2, w, h);

    // punched hole + a hint of writing
    ctx.beginPath();
    ctx.arc(0, -h / 2 + h * 0.17, h * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(90,78,50,0.55)';
    ctx.fill();

    const label = this.piece && this.piece.price ? this.piece.price : '$ ?';
    ctx.fillStyle = '#2A2417';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(h * 0.34)}px ui-monospace, Menlo, monospace`;
    ctx.fillText(label, 0, h * 0.16);
    ctx.restore();
  }

  /**
   * Soft contact shadow cast on the case backing — an offset silhouette of the
   * actual chain, not a static blob. It stays tight where the chain touches its
   * holder and separates further down, and it slides with the swing: the more a
   * particle is displaced from its rest position, the further its shadow trails.
   */
  _contactShadow(ctx) {
    const P = this.particles, rp = this.restPose;
    if (!rp) return;
    const g = this.gauge;
    const pts = new Array(P.length);
    for (let i = 0; i < P.length; i++) {
      const drop = Math.sin(Math.PI * P[i].t);       // 0 at the pins, 1 at the tip
      const swing = P[i].x - rp[i].x;                // displacement drives separation
      const off = (2.5 + 9 * drop) * g;
      pts[i] = { x: P[i].x + off * 0.6 + swing * 0.26, y: P[i].y + off };
    }
    // three widening passes read as a blur without paying for ctx.filter
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const w = 6 * g;
    for (const [mult, alpha] of [[2.9, 0.05], [1.9, 0.07], [1.15, 0.10]]) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.lineWidth = w * mult;
      ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
      ctx.stroke();
    }
    ctx.restore();
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
  constructor(stage, jewelry, onTap, opts = {}) {
    const {
      railY = 210, x0 = 150, x1 = DESIGN.W - 150, seed = 1337, scale = 1,
      dropScale = 1, pieces = null, tags = false,
    } = opts;
    const count = pieces ? pieces.length : (opts.count ?? 22);
    this.stage = stage;
    this.jewelry = jewelry;
    this.onTap = onTap || (() => {});
    this.debug = false;
    this.railY = railY;
    this.x0 = x0;
    this.x1 = x1;
    this.simTime = 0;
    this._acc = 0;
    this.params = { ...DEFAULT_PARAMS };

    const rng = mulberry32(seed); // deterministic layout every load
    this.chains = [];
    const pendants = [...PENDANT_TYPES, null, null];
    for (let i = 0; i < count; i++) {
      const x = x0 + (x1 - x0) * (i / (count - 1));
      const piece = pieces ? pieces[i] : null;
      // With inventory loaded, every visual property comes from the data.
      const spec = piece
        ? {
            style: CHAIN_STYLES.includes(piece.chain) ? piece.chain : 'rope',
            gauge: (piece.renderGauge ?? 1) * scale,
            pendantType: piece.pendant || null,
            scale, dropScale, piece, tag: tags,
          }
        : {
            style: CHAIN_STYLES[i % CHAIN_STYLES.length],
            gauge: (0.82 + rng() * 0.5) * scale,
            pendantType: pendants[i % pendants.length],
            scale, dropScale, tag: tags,
          };
      this.chains.push(new Chain(i, x, this.railY, rng, spec));
    }
    this.spacing = (x1 - x0) / (count - 1);

    // Live set = chains that are awake or settling (simulated + drawn on top).
    this.active = new Set();
    this.dragging = false;
    this.dragChain = -1;
    this._downX = 0; this._downY = 0; this._moved = 0;

    // Hover cursor field — pushes/drags nearby chains without grabbing them.
    this.cursor = { x: 0, y: 0, vx: 0, vy: 0, active: false };

    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d');
    this._layerDpr = 0;
    this._needsComposite = true;

    // PIECE_DETAIL: the selected chain lifts forward and centers.
    this.focusIndex = -1;
    this.focusT = 0;
    this.hoverTag = -1;
  }

  /** Lift a chain forward for PIECE_DETAIL. */
  focus(i) {
    this.focusIndex = i;
    this.focusT = 0;
    this.activate(i);
  }

  unfocus() { this.focusIndex = -1; this.focusT = 0; }

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

  /** Wake every chain whose holder is within `radius` of x (plus neighbors). */
  wakeNear(x, radius) {
    for (const c of this.chains) {
      if (Math.abs(c.discX - x) <= radius) this.activate(c.index);
    }
  }

  // ── hover cursor field ──────────────────────────────────────────────────
  setCursor(x, y) {
    const c = this.cursor;
    if (c.active) {
      // approximate px/s velocity (EMA), decayed each frame in update()
      c.vx = c.vx * 0.5 + (x - c.x) * 60 * 0.5;
      c.vy = c.vy * 0.5 + (y - c.y) * 60 * 0.5;
    }
    c.x = x; c.y = y; c.active = true;
    this.wakeNear(x, this.params.cursorRadius);
  }

  clearCursor() { this.cursor.active = false; this.cursor.vx = 0; this.cursor.vy = 0; }

  // ── input ───────────────────────────────────────────────────────────────
  /** Index of the chain whose price tag is under (x,y), or -1. */
  tagAt(x, y) {
    for (const c of this.chains) if (c.tagHit(x, y)) return c.index;
    return -1;
  }

  pointerDown(x, y) {
    this._downX = x; this._downY = y; this._moved = 0;
    this.clearCursor(); // the grab drives motion during a drag, not the field

    // A tag is a bigger, friendlier target than the chain itself; grabbing it
    // grabs the strand it hangs from, so a drag still swings the piece.
    const tagged = this.tagAt(x, y);
    if (tagged >= 0) {
      const c = this.chains[tagged];
      this.activate(tagged);
      c.grab(c.tag.anchorIdx, c.particles[c.tag.anchorIdx].x, c.particles[c.tag.anchorIdx].y);
      this.dragging = true;
      this.dragChain = tagged;
      return true;
    }

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
    if (!isDown) this.setCursor(x, y); // hover: wake + push nearby chains
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

    // cursor swipe velocity fades when the mouse stops moving
    this.cursor.vx *= 0.8; this.cursor.vy *= 0.8;

    // ease the focused chain forward
    if (this.focusIndex >= 0 && this.focusT < 1) {
      this.focusT = Math.min(1, this.focusT + dt * 2.6);
    }

    this._acc += Math.min(dt, 0.05);
    let steps = 0;
    while (this._acc >= FIXED && steps < MAX_STEPS) {
      this.simTime += FIXED;
      for (const i of this.active) {
        const c = this.chains[i];
        if (c.sleepState === 'awake') c.step(FIXED, this.simTime, this.params, this.cursor);
      }
      this._acc -= FIXED;
      steps++;
    }
    if (steps === MAX_STEPS) this._acc = 0;

    const cur = this.cursor;
    // per-frame: drive chains toward sleep, and finish blends
    const done = [];
    for (const i of this.active) {
      const c = this.chains[i];
      if (c.sleepState === 'awake') {
        if (c.grabbed >= 0 || i === this.focusIndex) { c.calmFrames = 0; continue; }
        // stay awake & reactive while the hover field is over this chain
        if (cur.active && Math.abs(c.discX - cur.x) < this.params.cursorRadius) c.calmFrames = 0;
        else if (c.energy() < this.params.sleepThreshold) c.calmFrames++;
        else c.calmFrames = 0;
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
      if (this.cursor.active) {
        ctx.strokeStyle = 'rgba(255,214,10,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(this.cursor.x, this.cursor.y, this.params.cursorRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
      this._hud(ctx);
      return;
    }

    if (this._needsComposite) this._recomposite();
    ctx.drawImage(this.layer, 0, 0, DESIGN.W, DESIGN.H); // sleeping chains (static)
    for (const i of this.active) {
      if (i === this.focusIndex) continue;              // drawn lifted, on top
      this.chains[i].draw(ctx, this.jewelry);
    }
    if (this.hoverTag >= 0 && this.hoverTag !== this.focusIndex) {
      this.chains[this.hoverTag]._drawTag(ctx, true);   // highlight under cursor
    }
  }

  /**
   * PIECE_DETAIL: dim the case and bring the selected chain forward, centered
   * to the left so the DOM card can sit beside it. The chain keeps simulating,
   * so it still sways while you read.
   */
  drawFocused(ctx, now) {
    const c = this.chains[this.focusIndex];
    if (!c) return;
    const t = easeInOutCubic(this.focusT);

    ctx.fillStyle = `rgba(4,9,20,${0.72 * t})`;
    ctx.fillRect(0, 0, DESIGN.W, DESIGN.H);

    const cx = c.discX, cy = this.railY;
    const tx = DESIGN.W * 0.32, ty = this.railY - 30;
    const s = 1 + 0.42 * t;

    ctx.save();
    ctx.translate(cx + (tx - cx) * t, cy + (ty - cy) * t);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    c.draw(ctx, this.jewelry);
    ctx.restore();
  }

  _rail(ctx) {
    const y = this.railY;
    const rx = this.x0 - 70, rw = (this.x1 - this.x0) + 140;
    const g = ctx.createLinearGradient(0, y - 30, 0, y - 6);
    g.addColorStop(0, '#3a3f49');
    g.addColorStop(1, '#14171d');
    ctx.fillStyle = g;
    ctx.fillRect(rx, y - 30, rw, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(rx, y - 30, rw, 3);
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
