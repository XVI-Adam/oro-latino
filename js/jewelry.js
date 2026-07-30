// jewelry.js — procedural jewelry renderer with a sprite-atlas + rotation cache.
//
// Chain LINKS are the hot path: a chain has ~50 links and there are dozens of
// chains, so we NEVER draw link geometry per frame. Instead each link "variant"
// is drawn once at N rotations into an offscreen atlas; rendering a chain walks
// the particle path and stamps the nearest cached rotation with drawImage.
// Per-gauge thickness is a drawImage scale, so one atlas serves every gauge.
//
// PENDANTS and RING/BANGLE primitives are cached as single upright sprites and
// likewise stamped. Every sprite first asks the AssetRegistry for a photographic
// cutout by key and, absent one, draws its procedural version — so the page has
// zero required image dependencies.

import { LinkAtlas, RunAtlas, STYLES, VARIANTS, visualMM, PX_PER_MM, LIGHT_ANGLE,
         BASE_MM, RUN_LINKS, MAX_LINKS_PER_CHAIN, supersampleFor,
         graphicGauge, tierSpec } from './links.js';
import { perf } from './perf.js';

const BASE_MM_PX = 8 * PX_PER_MM;

const PI2 = Math.PI * 2;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function goldGrad(ctx, half) {
  const g = ctx.createLinearGradient(0, -half, 0, half);
  g.addColorStop(0, '#F2DC90');
  g.addColorStop(0.5, '#D4AF37');
  g.addColorStop(1, '#7d5f10');
  return g;
}

export class Jewelry {
  /**
   * @param {AssetRegistry} registry
   * @param {() => number} getDpr
   */
  constructor(registry, getDpr) {
    this.reg = registry;
    this.getDpr = getDpr;
    this.dpr = getDpr();
    this.links = new Map();    // variant@tier → LinkAtlas
    this.runs = new Map();     // style@tier  → RunAtlas
    this.runQuality = 1;
    this.pendants = new Map(); // type → { canvas, w, h }
    this._subscribed = new Set();
  }

  /** Every live sprite surface, for the memory budget check. */
  atlasSurfaces() {
    const out = [];
    for (const a of this.links.values()) out.push(a.canvas);
    for (const r of this.runs.values()) out.push(r.canvas);
    for (const p of this.pendants.values()) out.push(p.canvas);
    return out;
  }

  _checkDpr() {
    const d = this.getDpr();
    if (d !== this.dpr) { this.dpr = d; this.links.clear(); this.runs.clear(); this.pendants.clear(); }
  }

  _link(variant, spec, tierName) {
    const key = `${tierName}:${variant}`;
    let rc = this.links.get(key);
    if (!rc) {
      rc = new LinkAtlas(variant, spec.ss, spec.variants, spec.baseGauge);
      this.links.set(key, rc);
    }
    return rc;
  }

  _watch(key, invalidate) {
    if (this._subscribed.has(key) || !this.reg.manifest.has(key)) return;
    this._subscribed.add(key);
    this.reg.onLoad(key, invalidate);
  }

  // ── chains ────────────────────────────────────────────────────────────────
  /**
   * Resolve every link along the rope: position, tangent angle, and how much
   * the local curvature should foreshorten it. Shared by the stamping passes
   * and the glint pass so they can never disagree about link placement.
   */
  _layout(P, layout, gaugePx) {
    const n = P.length;
    if (n < 2) return [];
    // Cap the link count: a 2.5mm rope over a 1100px path would otherwise want
    // ~1000 links. Stretch the pitch instead — at this gauge nobody can count.
    let pathLen = 0;
    for (let i = 0; i < n - 1; i++) pathLen += Math.hypot(P[i+1].x - P[i].x, P[i+1].y - P[i].y);
    const nominalPitch = layout.seq(0).pitch * gaugePx;
    const wanted = pathLen / Math.max(nominalPitch, 0.01);
    const stretch = wanted > MAX_LINKS_PER_CHAIN ? wanted / MAX_LINKS_PER_CHAIN : 1;

    // per-segment direction and length
    const segA = new Array(n - 1), segL = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      const dx = P[i + 1].x - P[i].x, dy = P[i + 1].y - P[i].y;
      segA[i] = Math.atan2(dy, dx);
      segL[i] = Math.hypot(dx, dy) || 1e-6;
    }
    const wrap = (a) => { while (a > Math.PI) a -= PI2; while (a < -Math.PI) a += PI2; return a; };

    const out = [];
    let idx = 0;
    const mmPx = gaugePx * stretch;            // already px; pitch-capped
    let need = layout.seq(0).pitch * mmPx * 0.5;
    for (let s = 0; s < n - 1; s++) {
      const ax = P[s].x, ay = P[s].y;
      const dx = P[s + 1].x - ax, dy = P[s + 1].y - ay;
      const len = segL[s];
      // smooth the tangent across the joint, and measure how hard it turns
      const prevA = s > 0 ? segA[s - 1] : segA[s];
      const nextA = s < n - 2 ? segA[s + 1] : segA[s];
      const turn = Math.abs(wrap(nextA - prevA));
      const arc = (s > 0 ? segL[s - 1] : 0) + len + (s < n - 2 ? segL[s + 1] : 0);
      const curv = turn / Math.max(arc, 1e-6);          // rad per px
      // a tight bend squeezes links toward ellipses and packs them closer
      const squeeze = Math.max(0.55, 1 - curv * 165);

      let pos = 0;
      while (pos + need <= len) {
        pos += need;
        const f = pos / len;
        // blend toward the neighbouring segment angles across the joint
        const a = f < 0.5
          ? segA[s] + wrap(prevA - segA[s]) * (0.5 - f) * 0.5
          : segA[s] + wrap(nextA - segA[s]) * (f - 0.5) * 0.5;
        const link = layout.seq(idx);
        out.push({
          v: link.v, edge: !!link.edge, i: idx,
          x: ax + dx * f, y: ay + dy * f,
          a: a + link.ang,   // drawing angle: tangent + the variant's own twist
          pa: a,             // path tangent alone — what run grouping must test
          squeeze,
        });
        idx++;
        need = layout.seq(idx).pitch * mmPx * squeeze;
      }
      need -= (len - pos);
    }
    return out;
  }

  /** Millimetre gauge for a chain, clamped into a legible range. */
  gaugeMM(mm) { return visualMM(mm); }

  /**
   * Draw a chain. `mm` is the real gauge in millimetres.
   *
   * Three passes give the weave: edge-on links go down first, the face-on
   * rings are laid over them, then the edge-on links are re-stamped through a
   * narrow clip so their shanks read as passing *through* the rings.
   */
  /** Baked run-strip for a style, at the supersample tier its gauge deserves. */
  _run(style, spec, tierName, count = 8) {
    const key = `${tierName}:${style}x${count}`;
    let r = this.runs.get(key);
    if (!r) {
      const layout = spec.styles[style];
      // The strip is built with the same three-pass interlock the single-link
      // path used — but ONCE, at bake time, so the clip never costs a frame.
      const build = (c, x0, ss) => {
        const gaugePx = spec.baseGauge * ss;
        const pos = [];
        let x = x0;
        for (let i = 0; i < count; i++) {
          const seq = layout.seq(i);
          x += seq.pitch * gaugePx;
          pos.push({ seq, x: x - seq.pitch * gaugePx * 0.5 });
        }
        const drawOne = (seq, px) => {
          const a = this._link(seq.v, spec, tierName);
          const src = a.diag, dst = a.designSize * ss;
          const b = Math.round((((seq.ang % PI2) + PI2) % PI2) / PI2 * a.rotSteps) % a.rotSteps;
          const col = b % a.cols, row = (b / a.cols) | 0;
          c.drawImage(a.canvas, col * src, row * src, src, src, px - dst / 2, -dst / 2, dst, dst);
        };
        for (const p of pos) if (p.seq.edge) drawOne(p.seq, p.x);
        for (const p of pos) if (!p.seq.edge) drawOne(p.seq, p.x);
        // threading sliver, baked in
        for (const p of pos) {
          if (!p.seq.edge) continue;
          const band = gaugePx * 0.30;
          c.save();
          c.beginPath();
          c.rect(p.x - band, -band * 2.2, band * 2, band * 4.4);
          c.clip();
          drawOne(p.seq, p.x);
          c.restore();
        }
      };
      r = new RunAtlas(style, spec.ss, build, count, spec.styles, spec.baseGauge);
      this.runs.set(key, r);
    }
    return r;
  }

  /**
   * Draw a chain. The frame loop here is deliberately nothing but drawImage:
   * no gradients, no clips, no per-link save/restore — all of that is baked.
   *
   * Straight stretches stamp one RUN sprite per 8 links; only the tail and
   * genuinely curved stretches fall back to individual links, where a strip
   * would visibly bend the wrong way.
   */
  /**
   * Draw a chain.
   *
   * @param {number} mm    the piece's real gauge — still the source of truth
   * @param {string} tier  'graphic' (case level: bold, few, flat-shaded)
   *                       'detail'  (piece view: full metallic, dense)
   *
   * Real millimetres stay in the data and on the tag; the *drawn* size comes
   * from graphicGauge() at case level, which compresses 3–12mm into 16–34px.
   */
  strokeChain(ctx, P, style, mm = 4, depth = 1, cull = null, tier = 'graphic') {
    this._checkDpr();
    const spec = tierSpec(tier);
    const layout = spec.styles[style] || spec.styles.rope;
    const g = (tier === 'detail' ? visualMM(mm) * PX_PER_MM : graphicGauge(mm)) * depth;
    const links = this._layout(P, layout, g);
    if (!links.length) return;

    this._core(ctx, P, g * 0.72, 'rgba(0,0,0,0.24)');
    this._core(ctx, P, g * 0.30, 'rgba(46,30,4,0.92)');

    const longLen = spec.runLinks;
    const runLong = this._run(style, spec, tier, longLen);
    const period = layout.period || 2;
    const shortLen = (period <= 4 && longLen >= 8) ? longLen / 2 : 0;
    const runShort = shortLen ? this._run(style, spec, tier, shortLen) : null;
    // RunAtlas.stamp wants a RATIO against the size the strip was authored at,
    // not an absolute gauge.
    const scale = (g / spec.baseGauge) * (this.runQuality || 1);
    const ANG_TOL = 0.50;

    const fits = (i, len, tol) => {
      if (i + len > links.length || i % period !== 0) return false;
      let minA = Infinity, maxA = -Infinity;
      for (let k = i; k < i + len; k++) {
        if (links[k].squeeze < 0.86) return false;
        if (links[k].pa < minA) minA = links[k].pa;
        if (links[k].pa > maxA) maxA = links[k].pa;
      }
      return maxA - minA <= tol;
    };
    const stampRun = (atlas, i, len) => {
      const a = links[i], b = links[i + len - 1];
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (cull && (cx < cull.x0 || cx > cull.x1 || cy < cull.y0 || cy > cull.y1)) return;
      atlas.stamp(ctx, cx, cy, Math.atan2(b.y - a.y, b.x - a.x), scale);
      perf.runs++;
    };

    let i = 0;
    while (i < links.length) {
      if (fits(i, longLen, ANG_TOL)) { stampRun(runLong, i, longLen); i += longLen; continue; }
      if (runShort && fits(i, shortLen, ANG_TOL * 1.5)) {
        stampRun(runShort, i, shortLen); i += shortLen; continue;
      }
      const L = links[i];
      if (!cull || (L.x > cull.x0 && L.x < cull.x1 && L.y > cull.y0 && L.y < cull.y1)) {
        this._link(L.v, spec, tier).stamp(ctx, L.x, L.y, L.a, g, L.squeeze);
        perf.links++;
      }
      i++;
    }
  }

  /** How many links a chain resolves to at a given tier — for the HUD. */
  linkCount(P, style, mm, depth = 1, tier = 'graphic') {
    const spec = tierSpec(tier);
    const g = (tier === 'detail' ? visualMM(mm) * PX_PER_MM : graphicGauge(mm)) * depth;
    return this._layout(P, spec.styles[style] || spec.styles.rope, g).length;
  }

  /** Release every sprite built for a tier (detail LOD unloads on exit). */
  releaseTier(tier) {
    for (const k of [...this.links.keys()]) if (k.startsWith(tier + ':')) this.links.delete(k);
    for (const k of [...this.runs.keys()]) if (k.startsWith(tier + ':')) this.runs.delete(k);
  }

  /**
   * Brighten a short run of links, biased toward those facing the light.
   * @param {number} centre index of the brightest link
   * @param {number} span   how many links either side pick up the sweep
   */
  glintChain(ctx, P, style, mm = 4, centre = 0, span = 2, strength = 1, depth = 1, tier = 'graphic') {
    this._checkDpr();
    const spec = tierSpec(tier);
    const layout = spec.styles[style] || spec.styles.rope;
    const g = (tier === 'detail' ? visualMM(mm) * PX_PER_MM : graphicGauge(mm)) * depth;
    const links = this._layout(P, layout, g);
    if (!links.length) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const L of links) {
      const d = Math.abs(L.i - centre);
      if (d > span) continue;
      // links whose face turns toward the light take the highlight hardest
      const facing = 0.55 + 0.45 * Math.cos(L.a - LIGHT_ANGLE);
      const fall = 1 - d / (span + 1);
      ctx.globalAlpha = Math.max(0, fall * fall * facing * 0.5 * strength);
      this._link(L.v, spec, tier).stamp(ctx, L.x, L.y, L.a, g, L.squeeze);
    }
    ctx.restore();
  }

  /** Where along the chain the links are — used to place sparkles. */
  linkPositions(P, style, mm = 4, depth = 1, tier = 'graphic') {
    const spec = tierSpec(tier);
    const g = (tier === 'detail' ? visualMM(mm) * PX_PER_MM : graphicGauge(mm)) * depth;
    return this._layout(P, spec.styles[style] || spec.styles.rope, g);
  }

  /**
   * The sparkle, rendered once. Glints stamp this — they never build a
   * gradient or a path at frame time, and never ask a chain to re-simulate.
   */
  sparkleSprite() {
    if (this._spark) return this._spark;
    const R = 48;
    const c = document.createElement('canvas');
    c.width = c.height = R * 2;
    const g2 = c.getContext('2d');
    g2.translate(R, R);
    const core = g2.createRadialGradient(0, 0, 0, 0, 0, R * 0.42);
    core.addColorStop(0, 'rgba(255,250,232,1)');
    core.addColorStop(0.35, 'rgba(255,232,170,0.34)');
    core.addColorStop(1, 'rgba(255,232,170,0)');
    g2.fillStyle = core;
    g2.fillRect(-R, -R, R * 2, R * 2);
    g2.fillStyle = 'rgba(255,250,232,0.9)';
    g2.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * PI2;
      const long = R * (k % 2 === 0 ? 0.95 : 0.6);
      g2.moveTo(0, 0);
      g2.lineTo(Math.cos(a - 0.10) * R * 0.12, Math.sin(a - 0.10) * R * 0.12);
      g2.lineTo(Math.cos(a) * long, Math.sin(a) * long);
      g2.lineTo(Math.cos(a + 0.10) * R * 0.12, Math.sin(a + 0.10) * R * 0.12);
    }
    g2.closePath();
    g2.fill();
    this._spark = c;
    return c;
  }

  /** Two plain drawImages: the star, and a soft bloom on the metal under it. */
  sparkle(ctx, x, y, r, alpha = 1) {
    const sp = this.sparkleSprite();
    const d = r * 3.2;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sp, x - d / 2, y - d / 2, d, d);
    const b = d * 1.7;
    ctx.globalAlpha = alpha * 0.30;
    ctx.drawImage(sp, x - b / 2, y - b / 2, b, b);
    ctx.globalAlpha = 1;
  }

  _core(ctx, P, width, color) {
    ctx.beginPath();
    ctx.moveTo(P[0].x, P[0].y);
    for (let i = 1; i < P.length - 1; i++) {
      const mx = (P[i].x + P[i + 1].x) / 2, my = (P[i].y + P[i + 1].y) / 2;
      ctx.quadraticCurveTo(P[i].x, P[i].y, mx, my);
    }
    ctx.lineTo(P[P.length - 1].x, P[P.length - 1].y);
    ctx.lineWidth = width; ctx.strokeStyle = color;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // ── pendants ────────────────────────────────────────────────────────────
  _pendantSprite(type) {
    let sp = this.pendants.get(type);
    if (sp) return sp;
    const dpr = this.dpr;
    const meta = PENDANTS[type] || PENDANTS.cross;
    const canvas = makeCanvas(meta.w * dpr, meta.h * dpr);
    const c = canvas.getContext('2d');
    c.translate((meta.w / 2) * dpr, 0);
    const key = 'pendant:' + type;
    this._watch(key, () => this.pendants.delete(type));
    const img = this.reg.cutout(key);
    if (img) c.drawImage(img, -(meta.w / 2) * dpr, 0, meta.w * dpr, meta.h * dpr);
    else meta.draw(c, dpr);
    sp = { canvas, w: meta.w, h: meta.h };
    this.pendants.set(type, sp);
    return sp;
  }

  /** Hang a pendant from (x,y), tilted to `angle` (radians, its +y axis). */
  stampPendant(ctx, type, x, y, angle, gauge = 1) {
    this._checkDpr();
    const sp = this._pendantSprite(type);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle - Math.PI / 2);
    const w = sp.w * gauge, h = sp.h * gauge;
    ctx.drawImage(sp.canvas, -w / 2, -3 * gauge, w, h);
    ctx.restore();
  }

  /**
   * Tight ambient occlusion where a piece meets velvet — a small, dense,
   * fast-falloff pool right at the contact point (not a soft drop shadow).
   */
  ao(ctx, x, y, rx, ry, strength = 0.55) {
    // one cached sprite, stretched — no gradient is built at frame time
    if (!this._ao) {
      const R = 32;
      const c = document.createElement('canvas');
      c.width = c.height = R * 2;
      const g2 = c.getContext('2d');
      const g = g2.createRadialGradient(R, R, 0, R, R, R);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.45, 'rgba(0,0,0,0.42)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      g2.fillStyle = g;
      g2.fillRect(0, 0, R * 2, R * 2);
      this._ao = c;
    }
    ctx.globalAlpha = strength;
    ctx.drawImage(this._ao, x - rx, y - ry, rx * 2, ry * 2);
    ctx.globalAlpha = 1;
  }

  // ── ring & bangle primitives (for later cases) ──────────────────────────
  ring(ctx, x, y, r, { gauge = 1, gem = true, gemColor = '#E23A2E', ao = false } = {}) {
    this._checkDpr();
    if (ao) this.ao(ctx, x, y + r * 0.92, r * 1.15, r * 0.42, 0.6);
    if (this.reg.has('ring:solitaire')) {
      const img = this.reg.cutout('ring:solitaire');
      ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
      return;
    }
    const band = 5 * gauge;
    ctx.save();
    ctx.lineWidth = band;
    const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    g.addColorStop(0, '#F2DC90'); g.addColorStop(0.5, '#D4AF37'); g.addColorStop(1, '#7d5f10');
    ctx.strokeStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, PI2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = band * 0.3;
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.6); ctx.stroke();
    if (gem) {
      ctx.translate(x, y - r);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = gemColor;
      const s = 6 * gauge; ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(-s / 2, -s / 2, s / 2, s / 2);
    }
    ctx.restore();
  }

  bangle(ctx, x, y, rx, ry, { gauge = 1, ao = false } = {}) {
    this._checkDpr();
    if (ao) this.ao(ctx, x, y + ry * 0.95, rx * 0.95, ry * 0.5, 0.55);
    if (this.reg.has('bangle:plain')) {
      const img = this.reg.cutout('bangle:plain');
      ctx.drawImage(img, x - rx, y - ry, rx * 2, ry * 2);
      return;
    }
    ctx.save();
    ctx.lineWidth = 9 * gauge;
    const g = ctx.createLinearGradient(0, y - ry, 0, y + ry);
    g.addColorStop(0, '#F2DC90'); g.addColorStop(0.5, '#D4AF37'); g.addColorStop(1, '#7d5f10');
    ctx.strokeStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, PI2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2.5 * gauge;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, Math.PI * 1.05, Math.PI * 1.7); ctx.stroke();
    ctx.restore();
  }
}

// ── pendant geometry (upright, bail at top-center, body hanging on +y) ──────
function bail(ctx, dpr) {
  ctx.strokeStyle = '#C99A2E'; ctx.lineWidth = 3 * dpr;
  ctx.beginPath(); ctx.arc(0, 6 * dpr, 5 * dpr, 0, PI2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1 * dpr;
  ctx.beginPath(); ctx.arc(0, 6 * dpr, 5 * dpr, Math.PI * 1.1, Math.PI * 1.7); ctx.stroke();
}

function crossShape(ctx, dpr, barW, top, bottom, armY, armHalf) {
  ctx.fillStyle = goldGrad(ctx, (bottom - top) / 2);
  roundRect(ctx, -barW / 2, top, barW, bottom - top, barW * 0.28); ctx.fill();
  roundRect(ctx, -armHalf, armY - barW / 2, armHalf * 2, barW, barW * 0.28); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.2 * dpr;
  ctx.beginPath(); ctx.moveTo(-barW / 2 + 1.5 * dpr, top + 2 * dpr); ctx.lineTo(-barW / 2 + 1.5 * dpr, bottom - 2 * dpr); ctx.stroke();
}

const PENDANTS = {
  cross: {
    w: 44, h: 66,
    draw(ctx, dpr) {
      bail(ctx, dpr);
      crossShape(ctx, dpr, 10 * dpr, 11 * dpr, 60 * dpr, 27 * dpr, 17 * dpr);
    },
  },
  crucifix: {
    w: 46, h: 68,
    draw(ctx, dpr) {
      bail(ctx, dpr);
      crossShape(ctx, dpr, 11 * dpr, 11 * dpr, 62 * dpr, 28 * dpr, 18 * dpr);
      // corpus silhouette in relief (darker gold)
      ctx.fillStyle = 'rgba(90,64,10,0.85)';
      ctx.beginPath(); ctx.arc(0, 21 * dpr, 3.2 * dpr, 0, PI2); ctx.fill();       // head
      roundRect(ctx, -2.6 * dpr, 24 * dpr, 5.2 * dpr, 18 * dpr, 2 * dpr); ctx.fill(); // torso
      ctx.strokeStyle = 'rgba(90,64,10,0.85)'; ctx.lineWidth = 3 * dpr; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-14 * dpr, 28 * dpr); ctx.lineTo(14 * dpr, 28 * dpr); ctx.stroke(); // arms
      ctx.beginPath(); ctx.moveTo(-3 * dpr, 42 * dpr); ctx.lineTo(-5 * dpr, 52 * dpr); ctx.moveTo(3 * dpr, 42 * dpr); ctx.lineTo(5 * dpr, 52 * dpr); ctx.stroke(); // legs
    },
  },
  medallion: {
    w: 54, h: 70,
    draw(ctx, dpr) {
      bail(ctx, dpr);
      const cy = 36 * dpr, rx = 24 * dpr, ry = 30 * dpr;
      ctx.fillStyle = goldGrad(ctx, ry);
      ctx.beginPath(); ctx.ellipse(0, cy, rx, ry, 0, 0, PI2); ctx.fill();
      // beaded rim
      ctx.strokeStyle = 'rgba(90,64,10,0.7)'; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.ellipse(0, cy, rx - 3 * dpr, ry - 3 * dpr, 0, 0, PI2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.ellipse(0, cy, rx - 1.5 * dpr, ry - 1.5 * dpr, 0, Math.PI * 1.05, Math.PI * 1.7); ctx.stroke();
      // saint bust silhouette (engraved relief)
      ctx.save();
      ctx.beginPath(); ctx.ellipse(0, cy, rx - 5 * dpr, ry - 5 * dpr, 0, 0, PI2); ctx.clip();
      ctx.fillStyle = 'rgba(90,64,10,0.55)';
      ctx.beginPath(); ctx.arc(0, cy - 4 * dpr, 7 * dpr, 0, PI2); ctx.fill();               // head
      ctx.beginPath(); ctx.ellipse(0, cy + 18 * dpr, 15 * dpr, 12 * dpr, 0, Math.PI, 0); ctx.fill(); // shoulders
      ctx.strokeStyle = 'rgba(255,240,190,0.5)'; ctx.lineWidth = 1.2 * dpr;                  // halo
      ctx.beginPath(); ctx.arc(0, cy - 5 * dpr, 10 * dpr, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      ctx.restore();
    },
  },
  tablet: {
    w: 44, h: 66,
    draw(ctx, dpr) {
      bail(ctx, dpr);
      const top = 12 * dpr, bot = 60 * dpr, w = 34 * dpr;
      ctx.fillStyle = goldGrad(ctx, (bot - top) / 2);
      roundRect(ctx, -w / 2, top, w, bot - top, 6 * dpr); ctx.fill();
      ctx.strokeStyle = 'rgba(90,64,10,0.7)'; ctx.lineWidth = 2 * dpr;
      roundRect(ctx, -w / 2 + 4 * dpr, top + 4 * dpr, w - 8 * dpr, bot - top - 8 * dpr, 4 * dpr); ctx.stroke();
      // engraved cross motif
      ctx.strokeStyle = 'rgba(90,64,10,0.6)'; ctx.lineWidth = 3 * dpr; ctx.lineCap = 'round';
      const my = (top + bot) / 2;
      ctx.beginPath(); ctx.moveTo(0, my - 12 * dpr); ctx.lineTo(0, my + 12 * dpr); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8 * dpr, my - 3 * dpr); ctx.lineTo(8 * dpr, my - 3 * dpr); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.moveTo(-w / 2 + 4 * dpr, top + 5 * dpr); ctx.lineTo(w / 2 - 4 * dpr, top + 5 * dpr); ctx.stroke();
    },
  },
};

export const PENDANT_TYPES = Object.keys(PENDANTS);
export const CHAIN_STYLES = Object.keys(STYLES);
