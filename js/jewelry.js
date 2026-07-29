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

import { LinkAtlas, STYLES, VARIANTS, visualMM, PX_PER_MM, LIGHT_ANGLE } from './links.js';

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
    this.links = new Map();    // variant → RotationCache
    this.pendants = new Map(); // type → { canvas, w, h }
    this._subscribed = new Set();
  }

  _checkDpr() {
    const d = this.getDpr();
    if (d !== this.dpr) { this.dpr = d; this.links.clear(); this.pendants.clear(); }
  }

  _link(variant) {
    let rc = this.links.get(variant);
    if (!rc) { rc = new LinkAtlas(variant, this.dpr); this.links.set(variant, rc); }
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
  _layout(P, layout, mm) {
    const n = P.length;
    if (n < 2) return [];

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
    const mmPx = mm * PX_PER_MM;               // gauge in pixels
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
          a: a + link.ang,
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
  strokeChain(ctx, P, style, mm = 4, depth = 1) {
    this._checkDpr();
    const layout = STYLES[style] || STYLES.rope;
    const g = visualMM(mm) * depth;   // `depth` shrinks distant depictions only
    const links = this._layout(P, layout, g);
    if (!links.length) return;

    // soft cast shadow + a dark cord so the chain reads as one object
    ctx.save();
    ctx.translate(2, 4);
    this._core(ctx, P, g * PX_PER_MM * 0.85, 'rgba(0,0,0,0.22)');
    ctx.restore();
    this._core(ctx, P, g * PX_PER_MM * 0.34, 'rgba(52,34,4,0.9)');

    // pass 1 — edge-on links (they sit behind)
    for (const L of links) {
      if (!L.edge) continue;
      this._link(L.v).stamp(ctx, L.x, L.y, L.a, g, L.squeeze);
    }
    // pass 2 — face-on rings over them
    for (const L of links) {
      if (L.edge) continue;
      this._link(L.v).stamp(ctx, L.x, L.y, L.a, g, L.squeeze);
    }
    // pass 3 — the threading sliver: re-stamp each edge-on link clipped to a
    // band across the chain, so it visibly passes through the ring it links.
    const band = g * PX_PER_MM * 0.30;
    for (const L of links) {
      if (!L.edge) continue;
      ctx.save();
      ctx.translate(L.x, L.y);
      ctx.rotate(L.a);
      ctx.beginPath();
      ctx.rect(-band, -band * 2.2, band * 2, band * 4.4);
      ctx.clip();
      ctx.rotate(-L.a);
      ctx.translate(-L.x, -L.y);
      this._link(L.v).stamp(ctx, L.x, L.y, L.a, g, L.squeeze);
      ctx.restore();
    }
  }

  /**
   * Brighten a short run of links, biased toward those facing the light.
   * @param {number} centre index of the brightest link
   * @param {number} span   how many links either side pick up the sweep
   */
  glintChain(ctx, P, style, mm = 4, centre = 0, span = 2, strength = 1, depth = 1) {
    this._checkDpr();
    const layout = STYLES[style] || STYLES.rope;
    const g = visualMM(mm) * depth;
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
      this._link(L.v).stamp(ctx, L.x, L.y, L.a, g, L.squeeze);
    }
    ctx.restore();
  }

  /** Where along the chain the links are — used to place sparkles. */
  linkPositions(P, style, mm = 4, depth = 1) {
    return this._layout(P, STYLES[style] || STYLES.rope, visualMM(mm) * depth);
  }

  /** A small 4-point star catching the light. */
  sparkle(ctx, x, y, r, alpha = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = 'lighter';
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    core.addColorStop(0, `rgba(255,250,232,${0.95 * alpha})`);
    core.addColorStop(0.35, `rgba(255,232,170,${0.35 * alpha})`);
    core.addColorStop(1, 'rgba(255,232,170,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, PI2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,250,232,${0.85 * alpha})`;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * PI2;
      const long = r * (k % 2 === 0 ? 2.5 : 1.6);
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a - 0.10) * r * 0.28, Math.sin(a - 0.10) * r * 0.28);
      ctx.lineTo(Math.cos(a) * long, Math.sin(a) * long);
      ctx.lineTo(Math.cos(a + 0.10) * r * 0.28, Math.sin(a + 0.10) * r * 0.28);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
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
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(0.45, `rgba(0,0,0,${strength * 0.42})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / Math.max(rx, ry));
    ctx.translate(-x, -y);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(rx, ry), 0, PI2);
    ctx.fill();
    ctx.restore();
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
