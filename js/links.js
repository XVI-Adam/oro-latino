// links.js — the metal. Link geometry, shading and the rotation atlas.
//
// Physical model, all of it baked once into sprites:
//
//  · SCALE      every link is authored in millimetres and converted through one
//               PX_PER_MM constant, so a 10 mm Cuban is genuinely four times the
//               metal of a 2.5 mm rope rather than an arbitrary art choice.
//  · INTERLOCK  each style has two variants — a face-on ring and an edge-on
//               profile. Chains alternate them, and the rope is drawn in three
//               passes so the edge-on links visibly thread the face-on ones.
//  · LIGHT      one global direction (top-left, matching the interior track
//               lights). The body gradient is baked in link-local space, but the
//               specular hotspot and occlusion are composited in *cell* space,
//               unrotated — so as a link turns through the atlas's rotation
//               steps the highlight migrates across it instead of riding along.

export const PX_PER_MM = 1.5;          // one conversion for the whole system
                                       // (a 60cm chain hangs ~550px, so this is
                                       //  life-size x1.6 — uniform, ratios intact)
export const BASE_MM = 8;              // every sprite is authored at this size
export const N_ROT = 16;               // rotation steps for the link atlas
export const N_RUN_ROT = 16;           // rotation steps for run strips
export const RUN_LINKS = 8;            // links baked into one run sprite
// A pathology guard, NOT a quality lever. Run sprites already collapse 8 links
// into one stamp, so a dense chain is cheap; capping hard enough to matter
// visibly spreads the links apart and exposes the cord between them.
export const MAX_LINKS_PER_CHAIN = 420;
export const ATLAS_BUDGET_MB = 64;

/** Thin chains don't need 2x source; heavy ones do. */
export function supersampleFor(mm) { return mm >= 6 ? 2 : 1.25; }

// Light comes from the upper-left, matching the interior's track spots.
export const LIGHT_ANGLE = -Math.PI * 0.72;
const PI2 = Math.PI * 2;

// Gold ramp: deep amber-brown core → mid → bright → near-white specular.
const SHADOW = '#5C3D0E';
const MID = '#B8892A';
const BRIGHT = '#EBC85F';
const SPEC = '#FFF6D8';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Cross-section shading for a piece of round stock lit from `LIGHT_ANGLE`. */
function stockGradient(ctx, halfThick) {
  const g = ctx.createLinearGradient(0, -halfThick, 0, halfThick);
  g.addColorStop(0.00, MID);
  g.addColorStop(0.22, BRIGHT);
  g.addColorStop(0.55, MID);
  g.addColorStop(1.00, SHADOW);
  return g;
}

// ── link geometry, in millimetres at BASE_MM ────────────────────────────────
// Each variant reports its footprint in mm so the atlas can size its cells,
// and draws itself centred on the origin with its long axis on +x.

function ringFace(ctx, rxMM, ryMM, thickMM, S) {
  const rx = rxMM * S, ry = ryMM * S, t = thickMM * S;
  ctx.lineWidth = t;
  ctx.strokeStyle = stockGradient(ctx, t / 2);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx - t / 2, ry - t / 2, 0, 0, PI2);
  ctx.stroke();
  // inner + outer contact lines give the stock a rounded read
  ctx.lineWidth = Math.max(0.6, t * 0.16);
  ctx.strokeStyle = 'rgba(50,32,4,0.55)';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, PI2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(0.5, rx - t), Math.max(0.5, ry - t), 0, 0, PI2);
  ctx.stroke();
}

/** The same ring seen edge-on: a short foreshortened bar with visible stock. */
function ringEdge(ctx, lenMM, thickMM, S) {
  const L = lenMM * S, t = thickMM * S;
  ctx.lineCap = 'round';
  ctx.lineWidth = t;
  ctx.strokeStyle = stockGradient(ctx, t / 2);
  // two parallel shanks — what you actually see of a ring turned 90°
  for (const off of [-t * 0.42, t * 0.42]) {
    ctx.beginPath();
    ctx.moveTo(-L / 2 + t * 0.3, off);
    ctx.lineTo(L / 2 - t * 0.3, off);
    ctx.stroke();
  }
  // the far bend closing the loop
  ctx.lineWidth = Math.max(0.6, t * 0.5);
  ctx.strokeStyle = 'rgba(70,46,6,0.75)';
  ctx.beginPath();
  ctx.moveTo(-L / 2 + t * 0.3, -t * 0.42);
  ctx.lineTo(-L / 2 + t * 0.3, t * 0.42);
  ctx.moveTo(L / 2 - t * 0.3, -t * 0.42);
  ctx.lineTo(L / 2 - t * 0.3, t * 0.42);
  ctx.stroke();
}

function boxFace(ctx, sizeMM, thickMM, S) {
  const s = sizeMM * S, t = thickMM * S, r = s * 0.16;
  ctx.lineWidth = t;
  ctx.strokeStyle = stockGradient(ctx, t / 2);
  ctx.beginPath();
  const h = (s - t) / 2;
  ctx.moveTo(-h + r, -h);
  ctx.arcTo(h, -h, h, h, r);
  ctx.arcTo(h, h, -h, h, r);
  ctx.arcTo(-h, h, -h, -h, r);
  ctx.arcTo(-h, -h, h, -h, r);
  ctx.closePath();
  ctx.stroke();
  ctx.lineWidth = Math.max(0.5, t * 0.14);
  ctx.strokeStyle = 'rgba(50,32,4,0.5)';
  ctx.stroke();
}

export const VARIANTS = {
  // ── Cuban: fat interlocked ovals, the signature weave ─────────────────
  cubanFace: { wMM: 1.62, hMM: 1.20, draw: (c, S) => ringFace(c, 0.81, 0.60, 0.30, S) },
  cubanEdge: { wMM: 1.12, hMM: 0.52, draw: (c, S) => ringEdge(c, 1.02, 0.34, S) },
  // ── rope: tight twisted stock ─────────────────────────────────────────
  ropeFace: { wMM: 1.05, hMM: 0.86, draw: (c, S) => ringFace(c, 0.52, 0.43, 0.26, S) },
  ropeEdge: { wMM: 0.80, hMM: 0.40, draw: (c, S) => ringEdge(c, 0.72, 0.26, S) },
  // ── box: square links ─────────────────────────────────────────────────
  boxFace: { wMM: 1.00, hMM: 1.00, draw: (c, S) => boxFace(c, 0.94, 0.26, S) },
  boxEdge: { wMM: 0.72, hMM: 0.42, draw: (c, S) => ringEdge(c, 0.66, 0.28, S) },
  // ── figaro: three short + one long ────────────────────────────────────
  figShortFace: { wMM: 0.92, hMM: 0.80, draw: (c, S) => ringFace(c, 0.45, 0.39, 0.22, S) },
  figShortEdge: { wMM: 0.70, hMM: 0.38, draw: (c, S) => ringEdge(c, 0.62, 0.24, S) },
  figLongFace: { wMM: 1.70, hMM: 0.80, draw: (c, S) => ringFace(c, 0.85, 0.39, 0.22, S) },
  figLongEdge: { wMM: 0.78, hMM: 0.38, draw: (c, S) => ringEdge(c, 0.70, 0.24, S) },
};

// ── per-style weave: which variants alternate, and how densely ──────────────
// `pitch` is in units of the link's own mm gauge, so spacing scales with size.
// Cuban sits at 0.70 → each fat oval overlaps its neighbour by ~30%.
export const STYLES = {
  cuban: {
    mm: [6, 12], period: 2,
    seq: (i) => (i % 2 === 0
      ? { v: 'cubanFace', pitch: 0.567, ang: 0, edge: false }   // ~30% overlap
      : { v: 'cubanEdge', pitch: 0.567, ang: 0, edge: true }),
  },
  rope: {
    mm: [2.5, 4], period: 2,
    seq: (i) => (i % 2 === 0
      ? { v: 'ropeFace', pitch: 0.30, ang: 0.5, edge: false }    // tight twist
      : { v: 'ropeEdge', pitch: 0.30, ang: -0.5, edge: true }),
  },
  box: {
    mm: [2, 3], period: 2,
    seq: (i) => (i % 2 === 0
      ? { v: 'boxFace', pitch: 0.42, ang: 0, edge: false }
      : { v: 'boxEdge', pitch: 0.42, ang: 0, edge: true }),
  },
  figaro: {
    mm: [3, 5], period: 8,
    seq: (i) => {
      const m = i % 8;                       // 3 short pairs then 1 long pair
      if (m === 6) return { v: 'figLongFace', pitch: 0.80, ang: 0, edge: false };
      if (m === 7) return { v: 'figLongEdge', pitch: 0.52, ang: 0, edge: true };
      return m % 2 === 0
        ? { v: 'figShortFace', pitch: 0.36, ang: 0, edge: false }
        : { v: 'figShortEdge', pitch: 0.36, ang: 0, edge: true };
    },
  },
};

/** Clamp a real gauge so the heaviest chain is at most ~4x the lightest. */
export function visualMM(mm) {
  const m = Number(mm) || 4;
  // 2.5 → 2.5, 12 → 10: keeps the range legible without flattening it
  return clamp(2.5 + (m - 2.5) * 0.79, 2.2, 10);
}

// ── the rotation atlas ──────────────────────────────────────────────────────
export class LinkAtlas {
  /**
   * @param {string} variant key into VARIANTS
   * @param {number} dpr     device pixel ratio (atlas renders at >= 2x this)
   */
  constructor(variant, ss = 2, table = VARIANTS, baseGauge = BASE_MM * PX_PER_MM) {
    const meta = table[variant];
    // footprint in design px at BASE_MM, then supersampled
    this.baseGauge = baseGauge;
    this.designW = meta.wMM * baseGauge;
    this.designH = meta.hMM * baseGauge;
    const diag = Math.ceil(Math.hypot(this.designW, this.designH) * ss) + 8;
    this.diag = diag;
    this.designSize = diag / ss;
    this.rotSteps = N_ROT;
    this.cols = 8;
    const rows = Math.ceil(N_ROT / this.cols);
    this.canvas = makeCanvas(this.cols * diag, rows * diag);
    const atlas = this.canvas.getContext('2d');

    // Scale that turns the variant's mm numbers into supersampled pixels.
    const S = baseGauge * ss;

    // Each rotation is composed in its own cell buffer so the specular and
    // occlusion passes can use source-atop against just this link.
    const cell = makeCanvas(diag, diag);
    const c = cell.getContext('2d');

    for (let i = 0; i < N_ROT; i++) {
      const theta = (i / N_ROT) * PI2;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, diag, diag);
      c.translate(diag / 2, diag / 2);

      // 1 — body, in link-local space
      c.save();
      c.rotate(theta);
      meta.draw(c, S);
      c.restore();

      // 2 — occlusion crescent where the link tucks under its neighbours:
      //     a dark sliver at each end of the long axis, rotating with the link
      c.save();
      c.globalCompositeOperation = 'source-atop';
      c.rotate(theta);
      const halfL = (this.designW * ss) / 2;
      for (const sgn of [-1, 1]) {
        const g = c.createRadialGradient(sgn * halfL, 0, 0, sgn * halfL, 0, halfL * 0.85);
        g.addColorStop(0, 'rgba(30,18,2,0.60)');
        g.addColorStop(0.6, 'rgba(30,18,2,0.16)');
        g.addColorStop(1, 'rgba(30,18,2,0)');
        c.fillStyle = g;
        c.fillRect(-diag, -diag, diag * 2, diag * 2);
      }
      c.restore();

      // 3 — specular hotspot, composed UNROTATED so it stays with the light.
      //     This is what makes the highlight migrate as the link turns.
      c.save();
      c.globalCompositeOperation = 'source-atop';
      const r = Math.min(this.designW, this.designH) * ss * 0.5;
      const hx = Math.cos(LIGHT_ANGLE) * r * 0.62;
      const hy = Math.sin(LIGHT_ANGLE) * r * 0.62;
      // broad lift on the lit side
      const lift = c.createLinearGradient(
        Math.cos(LIGHT_ANGLE) * diag * 0.5, Math.sin(LIGHT_ANGLE) * diag * 0.5,
        -Math.cos(LIGHT_ANGLE) * diag * 0.5, -Math.sin(LIGHT_ANGLE) * diag * 0.5);
      lift.addColorStop(0, 'rgba(255,240,200,0.26)');
      lift.addColorStop(0.45, 'rgba(255,220,150,0.04)');
      lift.addColorStop(1, 'rgba(20,12,0,0.46)');
      c.fillStyle = lift;
      c.fillRect(-diag, -diag, diag * 2, diag * 2);
      // small hard hotspot
      const hot = c.createRadialGradient(hx, hy, 0, hx, hy, r * 0.42);
      hot.addColorStop(0, SPEC);
      hot.addColorStop(0.30, 'rgba(255,246,216,0.40)');
      hot.addColorStop(1, 'rgba(255,246,216,0)');
      c.fillStyle = hot;
      c.fillRect(-diag, -diag, diag * 2, diag * 2);
      c.restore();

      const col = i % this.cols, row = (i / this.cols) | 0;
      atlas.drawImage(cell, col * diag, row * diag);
    }
  }

  /**
   * Stamp one link.
   * @param {number} mm         real gauge in millimetres
   * @param {number} along      compression along the path tangent (curvature)
   */
  stamp(ctx, x, y, angle, gaugePx, along = 1) {
    let b = Math.round((((angle % PI2) + PI2) % PI2) / PI2 * N_ROT) % N_ROT;
    const col = b % this.cols, row = (b / this.cols) | 0;
    const src = this.diag;
    const dst = this.designSize * (gaugePx / this.baseGauge);

    // Only a real bend earns a transform; mild squeeze is imperceptible and
    // a plain drawImage keeps the frame loop free of save/restore churn.
    if (along >= 0.86) {
      ctx.drawImage(this.canvas, col * src, row * src, src, src,
        x - dst / 2, y - dst / 2, dst, dst);
      return;
    }
    // Curved run: squeeze the sprite along the tangent so links turning a
    // corner foreshorten into ellipses instead of piling up as beads.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(along, 1);
    ctx.rotate(-angle);
    ctx.drawImage(this.canvas, col * src, row * src, src, src,
      -dst / 2, -dst / 2, dst, dst);
    ctx.restore();
  }
}


// ── run atlas ───────────────────────────────────────────────────────────────
// A "run" is RUN_LINKS consecutive links, already interlocked and already
// shaded, baked as ONE sprite per rotation step. Straight stretches of rope
// stamp a single run instead of eight links plus eight clips, which is where
// the frame budget actually went. RUN_LINKS is a multiple of every style's
// weave period, so a run always starts on the same phase and one variant per
// style suffices.
export class RunAtlas {
  /**
   * @param {string} style
   * @param {(ctx:CanvasRenderingContext2D, seq:object, x:number, ss:number)=>void} stampLink
   */
  constructor(style, ss, buildStrip, count = RUN_LINKS, styles = STYLES, baseGauge = BASE_MM * PX_PER_MM) {
    const layout = styles[style];
    const gaugePx = baseGauge;
    // advance per link, in design px at BASE_MM
    let len = 0;
    for (let i = 0; i < count; i++) len += layout.seq(i).pitch * gaugePx;
    this.runLenDesign = len;
    this.linkCount = count;

    // tallest variant in the sequence decides the strip height
    let hMM = 0;
    const table = styles === STYLES ? VARIANTS : GFX_VARIANTS;
    for (let i = 0; i < count; i++) hMM = Math.max(hMM, table[layout.seq(i).v].hMM);
    const hDesign = hMM * gaugePx * 1.25;

    const diag = Math.ceil(Math.hypot(len, hDesign) * ss) + 8;
    this.diag = diag;
    this.designSize = diag / ss;
    this.cols = 4;
    const rows = Math.ceil(N_RUN_ROT / this.cols);
    this.canvas = makeCanvas(this.cols * diag, rows * diag);
    const atlas = this.canvas.getContext('2d');

    const cell = makeCanvas(diag, diag);
    const c = cell.getContext('2d');
    for (let i = 0; i < N_RUN_ROT; i++) {
      const theta = (i / N_RUN_ROT) * PI2;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, diag, diag);
      c.translate(diag / 2, diag / 2);
      c.rotate(theta);
      // the strip is drawn centred, running along local +x
      buildStrip(c, -len * ss / 2, ss);
      const col = i % this.cols, row = (i / this.cols) | 0;
      atlas.drawImage(cell, col * diag, row * diag);
    }
  }

  /** Plain drawImage — no save/restore, no clip, no gradient. */
  stamp(ctx, x, y, angle, scale) {
    const b = Math.round((((angle % PI2) + PI2) % PI2) / PI2 * N_RUN_ROT) % N_RUN_ROT;
    const col = b % this.cols, row = (b / this.cols) | 0;
    const src = this.diag;
    const dst = this.designSize * scale;
    ctx.drawImage(this.canvas, col * src, row * src, src, src,
      x - dst / 2, y - dst / 2, dst, dst);
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// GRAPHIC TIER — the case-level look.
//
// At case scale a photographic link is wasted: it's 6px of gold competing with
// 500 neighbours. This tier trades micro-detail for a bolder, calmer read —
// bigger links, far fewer of them, and 3–4 flat value steps instead of a
// continuous metallic ramp. The alternating face/edge interlock is kept, since
// that is what makes a chain read as a chain rather than a string of beads.
//
// Sizes here are PIXELS, not millimetres: real mm still lives in the piece data
// and the tag copy, but the drawn size comes from graphicGauge().

export const BASE_GFX_PX = 26;        // graphic sprites are authored at this size

/**
 * Compress the real 3–12mm range into a drawn 16–34px range. A power curve, so
 * a heavy Cuban still clearly outweighs a fine rope but the ratio falls from
 * ~4x to ~2.1x and the whole rail sits in one visual family.
 */
export function graphicGauge(mm) {
  const m = clamp(Number(mm) || 4, 3, 12);
  const t = (m - 3) / 9;                       // 0…1 across the real range
  return 16 + 18 * Math.pow(t, 0.55);          // 16px … 34px
}

// Four flat steps. No gradients at draw time and none baked either — the whole
// point is that you can see the steps.
const G_EDGE = '#4A3008';    // dark contour
const G_MID = '#C9962E';     // body
const G_BRIGHT = '#F0D275';  // lit band
const G_SPEC = '#FFFBEE';    // the single crisp dot

/** A face-on ring: flat body, one bright band, hard contour. */
function gfxRingFace(ctx, rx, ry, thick, S) {
  const RX = rx * S, RY = ry * S, T = thick * S;
  ctx.lineCap = 'round';
  // contour first, slightly fatter — reads as a drawn outline
  ctx.lineWidth = T + Math.max(2, T * 0.30);
  ctx.strokeStyle = G_EDGE;
  ctx.beginPath();
  ctx.ellipse(0, 0, RX, RY, 0, 0, PI2);
  ctx.stroke();
  // body
  ctx.lineWidth = T;
  ctx.strokeStyle = G_MID;
  ctx.beginPath();
  ctx.ellipse(0, 0, RX, RY, 0, 0, PI2);
  ctx.stroke();
  // lit band across the top-left third of the ring
  ctx.lineWidth = T * 0.42;
  ctx.strokeStyle = G_BRIGHT;
  ctx.beginPath();
  ctx.ellipse(0, 0, RX, RY, 0, Math.PI * 1.02, Math.PI * 1.72);
  ctx.stroke();
}

/** The same ring turned edge-on: a clean capsule, one bright edge. */
function gfxRingEdge(ctx, len, thick, S) {
  const L = len * S, T = thick * S;
  ctx.lineCap = 'round';
  ctx.lineWidth = T + Math.max(2, T * 0.30);
  ctx.strokeStyle = G_EDGE;
  ctx.beginPath();
  ctx.moveTo(-L / 2, 0); ctx.lineTo(L / 2, 0);
  ctx.stroke();
  ctx.lineWidth = T;
  ctx.strokeStyle = G_MID;
  ctx.beginPath();
  ctx.moveTo(-L / 2, 0); ctx.lineTo(L / 2, 0);
  ctx.stroke();
  ctx.lineWidth = T * 0.34;
  ctx.strokeStyle = G_BRIGHT;
  ctx.beginPath();
  ctx.moveTo(-L / 2 + T * 0.3, -T * 0.26); ctx.lineTo(L / 2 - T * 0.3, -T * 0.26);
  ctx.stroke();
}

function gfxBoxFace(ctx, size, thick, S) {
  const H = (size * S) / 2, T = thick * S, R = H * 0.34;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(-H + R, -H);
    ctx.arcTo(H, -H, H, H, R);
    ctx.arcTo(H, H, -H, H, R);
    ctx.arcTo(-H, H, -H, -H, R);
    ctx.arcTo(-H, -H, H, -H, R);
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  ctx.lineWidth = T + Math.max(2, T * 0.30);
  ctx.strokeStyle = G_EDGE; path(); ctx.stroke();
  ctx.lineWidth = T;
  ctx.strokeStyle = G_MID; path(); ctx.stroke();
  ctx.lineWidth = T * 0.40;
  ctx.strokeStyle = G_BRIGHT;
  ctx.beginPath();
  ctx.moveTo(-H + R, -H); ctx.lineTo(H - R, -H);
  ctx.stroke();
}

// Footprints are multiples of the drawn gauge, same convention as the mm tier.
// Footprints are ~1.7x the mm tier's: at case level a link should be a shape
// you can read, not a texture. Wide pitch plus wide links keeps the ~25%
// overlap that makes the weave legible.
export const GFX_VARIANTS = {
  cubanFace: { wMM: 2.60, hMM: 1.95, draw: (c, S) => gfxRingFace(c, 1.06, 0.76, 0.42, S) },
  cubanEdge: { wMM: 1.70, hMM: 0.78, draw: (c, S) => gfxRingEdge(c, 1.32, 0.44, S) },
  ropeFace:  { wMM: 1.95, hMM: 1.62, draw: (c, S) => gfxRingFace(c, 0.78, 0.64, 0.40, S) },
  ropeEdge:  { wMM: 1.48, hMM: 0.74, draw: (c, S) => gfxRingEdge(c, 1.10, 0.40, S) },
  boxFace:   { wMM: 1.86, hMM: 1.86, draw: (c, S) => gfxBoxFace(c, 1.44, 0.40, S) },
  boxEdge:   { wMM: 1.38, hMM: 0.78, draw: (c, S) => gfxRingEdge(c, 1.00, 0.42, S) },
  figShortFace: { wMM: 1.76, hMM: 1.52, draw: (c, S) => gfxRingFace(c, 0.70, 0.60, 0.38, S) },
  figShortEdge: { wMM: 1.34, hMM: 0.72, draw: (c, S) => gfxRingEdge(c, 0.96, 0.38, S) },
  figLongFace:  { wMM: 2.90, hMM: 1.52, draw: (c, S) => gfxRingFace(c, 1.26, 0.60, 0.38, S) },
  figLongEdge:  { wMM: 1.48, hMM: 0.72, draw: (c, S) => gfxRingEdge(c, 1.06, 0.38, S) },
};

// Much wider pitch than the mm tier: fewer, larger, calmer links.
// Pitch is ~1.0x gauge — roughly double the mm tier — so link counts fall hard
// while the enlarged footprints keep the faces overlapping.
export const GFX_STYLES = {
  cuban:  { period: 2, seq: (i) => (i % 2 === 0
    ? { v: 'cubanFace', pitch: 1.02, ang: 0, edge: false }
    : { v: 'cubanEdge', pitch: 1.02, ang: 0, edge: true }) },
  rope:   { period: 2, seq: (i) => (i % 2 === 0
    ? { v: 'ropeFace', pitch: 0.80, ang: 0.42, edge: false }
    : { v: 'ropeEdge', pitch: 0.80, ang: -0.42, edge: true }) },
  box:    { period: 2, seq: (i) => (i % 2 === 0
    ? { v: 'boxFace', pitch: 0.92, ang: 0, edge: false }
    : { v: 'boxEdge', pitch: 0.92, ang: 0, edge: true }) },
  figaro: { period: 8, seq: (i) => {
    const m = i % 8;
    if (m === 6) return { v: 'figLongFace', pitch: 1.55, ang: 0, edge: false };
    if (m === 7) return { v: 'figLongEdge', pitch: 1.00, ang: 0, edge: true };
    return m % 2 === 0
      ? { v: 'figShortFace', pitch: 0.86, ang: 0, edge: false }
      : { v: 'figShortEdge', pitch: 0.86, ang: 0, edge: true };
  } },
};

/** Tier descriptor: which tables to use and what the sprites were authored at. */
export function tierSpec(tier) {
  // A run strip has to be baked into a square cell big enough to rotate in, so
  // its memory grows with the SQUARE of the strip length. The graphic tier's
  // links are ~1.7x wider, which made 8-link strips cost ~12MB apiece — so it
  // uses 4-link strips at 1.5x source instead. Same look, a fraction of the VRAM.
  return tier === 'detail'
    ? { variants: VARIANTS, styles: STYLES, baseGauge: BASE_MM * PX_PER_MM,
        ss: 2, runLinks: 8 }
    : { variants: GFX_VARIANTS, styles: GFX_STYLES, baseGauge: BASE_GFX_PX,
        ss: 1.5, runLinks: 4 };
}
