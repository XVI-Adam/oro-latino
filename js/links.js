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
 * Real 3–12mm → drawn 14–40px. A ~2.9x spread, wide enough that a heavy Cuban
 * and a fine rope are obviously different chains rather than the same chain at
 * two sizes. Real millimetres stay in the data and on the tag.
 */
export function graphicGauge(mm) {
  const m = clamp(Number(mm) || 4, 3, 12);
  return 14 + 26 * Math.pow((m - 3) / 9, 0.70);
}

/**
 * Governing rule for spacing. Link COUNT is an output, never a target — it is
 * just path length ÷ pitch. What we actually govern:
 *   · overlap  consecutive links overlap at least this much, so no background
 *              shows through the chain
 *   · repeats  a style's full pattern unit must repeat at least 8 times over
 *              the hang, so a figaro's 3+1 reads as rhythm and not accident
 */
export const MIN_OVERLAP = 0.40;
export const MIN_PATTERN_REPEATS = 8;

// Four flat steps — you should be able to see them.
const G_EDGE = '#4A3008';
const G_MID = '#C9962E';
const G_BRIGHT = '#F0D275';
const G_DARK = '#7A5410';
const G_SPEC = '#FFFBEE';

// ── silhouette language ─────────────────────────────────────────────────────
// Each style gets a genuinely different shape, not a re-proportioned oval. The
// test is whether you can name the style from a grayscale silhouette.

/** ROPE — no discrete links: one tile of a two-strand twist, tiled seamlessly. */
function gfxRopeTwist(ctx, len, thick, S) {
  const L = len * S, T = thick * S;
  ctx.lineCap = 'butt';
  // two strands crossing, drawn as steep diagonals so tiling reads as a helix
  for (const [off, shade] of [[-0.22, G_DARK], [0.22, G_MID]]) {
    ctx.strokeStyle = shade;
    ctx.lineWidth = T * 0.92;
    ctx.beginPath();
    ctx.moveTo(-L / 2, off * T * 2.1);
    ctx.lineTo(L / 2, -off * T * 2.1);
    ctx.stroke();
  }
  // the groove between them — the diagonal that makes it read as spiralled
  ctx.strokeStyle = G_EDGE;
  ctx.lineWidth = Math.max(1.4, T * 0.20);
  ctx.beginPath();
  ctx.moveTo(-L / 2, T * 0.46);
  ctx.lineTo(L / 2, -T * 0.46);
  ctx.stroke();
  // lit crest along the upper strand
  ctx.strokeStyle = G_BRIGHT;
  ctx.lineWidth = T * 0.26;
  ctx.beginPath();
  ctx.moveTo(-L / 2, -T * 0.16);
  ctx.lineTo(L / 2, -T * 0.52);
  ctx.stroke();
}

/** BOX — hard square, flat faces, crisp 90° corners. Architectural. */
function gfxBox(ctx, size, thick, S) {
  const H = (size * S) / 2, T = thick * S;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  const rect = () => { ctx.beginPath(); ctx.rect(-H, -H, H * 2, H * 2); ctx.closePath(); };
  ctx.lineWidth = T + Math.max(2, T * 0.34);
  ctx.strokeStyle = G_EDGE; rect(); ctx.stroke();
  ctx.lineWidth = T;
  ctx.strokeStyle = G_MID; rect(); ctx.stroke();
  // only the two lit faces catch light — keeps the corners reading as corners
  ctx.lineWidth = T * 0.5;
  ctx.strokeStyle = G_BRIGHT;
  ctx.beginPath();
  ctx.moveTo(-H, H); ctx.lineTo(-H, -H); ctx.lineTo(H, -H);
  ctx.stroke();
}

/** CUBAN — wide, flattened interlock: noticeably wider than tall. */
function gfxCuban(ctx, rx, ry, thick, S) {
  const RX = rx * S, RY = ry * S, T = thick * S;
  ctx.lineCap = 'round';
  ctx.lineWidth = T + Math.max(2, T * 0.32);
  ctx.strokeStyle = G_EDGE;
  ctx.beginPath(); ctx.ellipse(0, 0, RX, RY, 0, 0, PI2); ctx.stroke();
  ctx.lineWidth = T;
  ctx.strokeStyle = G_MID;
  ctx.beginPath(); ctx.ellipse(0, 0, RX, RY, 0, 0, PI2); ctx.stroke();
  ctx.lineWidth = T * 0.44;
  ctx.strokeStyle = G_BRIGHT;
  ctx.beginPath(); ctx.ellipse(0, 0, RX, RY, 0, Math.PI * 1.04, Math.PI * 1.70); ctx.stroke();
}

/** CABLE / clásico — simple round open link. The most air of any style. */
function gfxCable(ctx, r, thick, S) {
  const R = r * S, T = thick * S;
  ctx.lineCap = 'round';
  ctx.lineWidth = T + Math.max(1.6, T * 0.34);
  ctx.strokeStyle = G_EDGE;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, PI2); ctx.stroke();
  ctx.lineWidth = T;
  ctx.strokeStyle = G_MID;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, PI2); ctx.stroke();
  ctx.lineWidth = T * 0.42;
  ctx.strokeStyle = G_BRIGHT;
  ctx.beginPath(); ctx.arc(0, 0, R, Math.PI * 1.05, Math.PI * 1.65); ctx.stroke();
}

/** DIAMOND-CUT — flat faceted planes with hard bright/dark edges. */
function gfxDiamond(ctx, rx, ry, S) {
  const RX = rx * S, RY = ry * S;
  const facet = (pts, fill) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * RX, pts[0][1] * RY);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * RX, pts[i][1] * RY);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  // four planes meeting at a ridge — the faceting IS the signature
  facet([[-1, 0], [-0.3, -1], [0.3, -1], [1, 0]], G_BRIGHT);
  facet([[-1, 0], [1, 0], [0.3, 0.35], [-0.3, 0.35]], G_MID);
  facet([[-1, 0], [-0.3, 0.35], [-0.3, 1], [-1, 0.3]], G_DARK);
  facet([[1, 0], [0.3, 0.35], [0.3, 1], [1, 0.3]], G_DARK);
  ctx.strokeStyle = G_EDGE;
  ctx.lineWidth = Math.max(1.2, RY * 0.10);
  ctx.beginPath();
  ctx.moveTo(-RX, 0); ctx.lineTo(RX, 0);
  ctx.stroke();
  ctx.strokeStyle = G_SPEC;
  ctx.lineWidth = Math.max(1, RY * 0.07);
  ctx.beginPath();
  ctx.moveTo(-RX * 0.3, -RY); ctx.lineTo(RX * 0.3, -RY);
  ctx.stroke();
}

// Footprints are multiples of the drawn gauge. All ~57% of the previous pass.
export const GFX_VARIANTS = {
  ropeTwist:    { wMM: 0.62, hMM: 0.98, draw: (c, S) => gfxRopeTwist(c, 0.62, 0.46, S) },

  boxFace:      { wMM: 1.06, hMM: 1.06, draw: (c, S) => gfxBox(c, 0.84, 0.20, S) },
  boxEdge:      { wMM: 0.50, hMM: 0.46, draw: (c, S) => gfxCable(c, 0.19, 0.19, S) },

  cubanFace:    { wMM: 1.62, hMM: 0.98, draw: (c, S) => gfxCuban(c, 0.66, 0.36, 0.24, S) },
  cubanEdge:    { wMM: 0.72, hMM: 0.44, draw: (c, S) => gfxCuban(c, 0.26, 0.15, 0.20, S) },

  figShortFace: { wMM: 0.78, hMM: 0.76, draw: (c, S) => gfxCable(c, 0.30, 0.17, S) },
  figLongFace:  { wMM: 1.86, hMM: 0.76, draw: (c, S) => gfxCuban(c, 0.80, 0.28, 0.17, S) },

  cableFace:    { wMM: 0.90, hMM: 0.90, draw: (c, S) => gfxCable(c, 0.36, 0.14, S) },
  cableEdge:    { wMM: 0.40, hMM: 0.78, draw: (c, S) => gfxCable(c, 0.31, 0.13, S) },

  diaFace:      { wMM: 1.02, hMM: 0.84, draw: (c, S) => gfxDiamond(c, 0.42, 0.33, S) },
  diaEdge:      { wMM: 0.46, hMM: 0.60, draw: (c, S) => gfxDiamond(c, 0.19, 0.26, S) },
};

/**
 * Pitch is a fraction of the FACE link's own width, so the overlap it produces
 * is explicit and independent of gauge. `pattern` is how many entries make one
 * full repeat, used for the 8-repeats rule.
 */
export const GFX_STYLES = {
  // continuous cord: tiles abut exactly, no discrete links at all
  rope: { period: 1, pattern: 1, continuous: true,
    seq: () => ({ v: 'ropeTwist', pitch: 0.615, ang: 0, edge: false }) },

  box: { period: 2, pattern: 2,
    seq: (i) => (i % 2 === 0
      ? { v: 'boxFace', pitch: 0.30, ang: 0, edge: false }
      : { v: 'boxEdge', pitch: 0.30, ang: 0, edge: true }) },

  // ~45% overlap, and every link wider than it is tall
  cuban: { period: 2, pattern: 2,
    seq: (i) => (i % 2 === 0
      ? { v: 'cubanFace', pitch: 0.445, ang: 0, edge: false }
      : { v: 'cubanEdge', pitch: 0.445, ang: 0, edge: true }) },

  // 3 short then 1 long; the long link is 2.4x the short one
  figaro: { period: 4, pattern: 4,
    seq: (i) => (i % 4 === 3
      ? { v: 'figLongFace', pitch: 0.72, ang: 0, edge: false }
      : { v: 'figShortFace', pitch: 0.34, ang: 0, edge: false }) },

  cable: { period: 2, pattern: 2,
    seq: (i) => (i % 2 === 0
      ? { v: 'cableFace', pitch: 0.40, ang: 0, edge: false }
      : { v: 'cableEdge', pitch: 0.40, ang: Math.PI / 2, edge: true }) },

  diamond: { period: 2, pattern: 2,
    seq: (i) => (i % 2 === 0
      ? { v: 'diaFace', pitch: 0.34, ang: 0, edge: false }
      : { v: 'diaEdge', pitch: 0.34, ang: 0, edge: true }) },
};

/** Drawn width of a style's widest (face) link, in px — pendants size off this. */
export function linkWidthPx(style, mm) {
  const st = GFX_STYLES[style] || GFX_STYLES.cable;
  const v = GFX_VARIANTS[st.seq(0).v];
  return (v ? v.wMM : 1) * graphicGauge(mm);
}

/** Tier descriptor: which tables to use and what the sprites were authored at. */
export function tierSpec(tier) {
  // A run strip bakes into a square cell big enough to rotate in, so its memory
  // grows with the SQUARE of strip length. Smaller graphic links (this pass)
  // mean smaller cells, which buys back room for longer strips: 6 links.
  return tier === 'detail'
    ? { variants: VARIANTS, styles: STYLES, baseGauge: BASE_MM * PX_PER_MM,
        ss: 2, runLinks: 8 }
    : { variants: GFX_VARIANTS, styles: GFX_STYLES, baseGauge: BASE_GFX_PX,
        ss: 1.6, runLinks: 6 };
}
