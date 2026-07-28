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

const PI2 = Math.PI * 2;
const N_ROT = 48; // rotation buckets over 360°

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

// ── link-variant geometry (drawn centered at origin, long axis on +x) ───────
// Each draw(ctx, dpr) renders in device pixels. `w`/`h` bound the sprite (design
// px) so the rotation cache can size its cells.
const VARIANTS = {
  rope: {
    w: 16, h: 10,
    draw(ctx, dpr) {
      const L = 16 * dpr, T = 9 * dpr;
      ctx.fillStyle = goldGrad(ctx, T / 2);
      roundRect(ctx, -L / 2, -T / 2, L, T, T / 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.moveTo(-L / 2 + T / 2, -T / 2 + 1.3 * dpr); ctx.lineTo(L / 2 - T / 2, -T / 2 + 1.3 * dpr); ctx.stroke();
      ctx.strokeStyle = 'rgba(60,42,4,0.55)'; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.moveTo(-L / 2 + T / 2, T / 2 - 1.1 * dpr); ctx.lineTo(L / 2 - T / 2, T / 2 - 1.1 * dpr); ctx.stroke();
    },
  },
  box: {
    w: 15, h: 15,
    draw(ctx, dpr) {
      const s = 13 * dpr, t = 3.4 * dpr, r = 3 * dpr;
      ctx.fillStyle = goldGrad(ctx, s / 2);
      roundRect(ctx, -s / 2, -s / 2, s, s, r); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.3 * dpr;
      ctx.beginPath(); ctx.moveTo(-s / 2 + r, -s / 2 + 0.9 * dpr); ctx.lineTo(s / 2 - r, -s / 2 + 0.9 * dpr); ctx.stroke();
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      roundRect(ctx, -s / 2 + t, -s / 2 + t, s - 2 * t, s - 2 * t, r * 0.6); ctx.fill();
      ctx.restore();
    },
  },
  cuban: {
    w: 27, h: 21,
    draw(ctx, dpr) {
      const rx = 13 * dpr, ry = 10 * dpr, t = 5.2 * dpr;
      ctx.fillStyle = goldGrad(ctx, ry);
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, PI2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath(); ctx.ellipse(-rx * 0.12, -ry * 0.12, rx - t * 0.6, ry - t * 0.6, 0, Math.PI * 1.02, Math.PI * 1.82); ctx.stroke();
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.ellipse(0, 0, rx - t, ry - t, 0, 0, PI2); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(70,48,4,0.6)'; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.ellipse(0, 0, rx - 0.6 * dpr, ry - 0.6 * dpr, 0, 0, PI2); ctx.stroke();
    },
  },
  figShort: {
    w: 15, h: 12,
    draw(ctx, dpr) { ovalRing(ctx, dpr, 7, 5.4, 2.8); },
  },
  figLong: {
    w: 27, h: 12,
    draw(ctx, dpr) { ovalRing(ctx, dpr, 13, 5.4, 2.8); },
  },
};

function ovalRing(ctx, dpr, rx, ry, t) {
  rx *= dpr; ry *= dpr; t *= dpr;
  ctx.fillStyle = goldGrad(ctx, ry);
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, PI2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = Math.max(1, t * 0.5);
  ctx.beginPath(); ctx.ellipse(0, 0, rx - t * 0.5, ry - t * 0.5, 0, Math.PI * 1.05, Math.PI * 1.8); ctx.stroke();
  ctx.save(); ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.ellipse(0, 0, rx - t, ry - t, 0, 0, PI2); ctx.fill();
  ctx.restore();
}

// Per-style layout: which variants, their spacing (pitch), and the extra
// per-link rotation that gives each weave its character.
const STYLES = {
  rope:   { seq: (i) => ({ v: 'rope',  pitch: 6.5, ang: (i % 2 ? 1 : -1) * 0.55 }) },
  box:    { seq: (i) => ({ v: 'box',   pitch: 11,  ang: (i % 2 ? Math.PI / 2 : 0) }) },
  cuban:  { seq: (i) => ({ v: 'cuban', pitch: 14,  ang: (i % 2 ? 1 : -1) * 0.26 }) },
  figaro: { seq: (i) => (i % 4 === 3 ? { v: 'figLong', pitch: 22, ang: 0 } : { v: 'figShort', pitch: 12, ang: 0 }) },
};

// ── rotation cache: one variant pre-rendered at N_ROT angles ────────────────
class RotationCache {
  constructor(variant, dpr, buildUnit) {
    const meta = VARIANTS[variant];
    const diag = Math.ceil(Math.hypot(meta.w, meta.h) * dpr) + 4 * dpr;
    this.diag = diag;
    this.designSize = diag / dpr;
    this.cols = 8;
    const rows = Math.ceil(N_ROT / this.cols);
    this.canvas = makeCanvas(this.cols * diag, rows * diag);
    const c = this.canvas.getContext('2d');
    for (let i = 0; i < N_ROT; i++) {
      const col = i % this.cols, row = (i / this.cols) | 0;
      c.save();
      c.translate(col * diag + diag / 2, row * diag + diag / 2);
      c.rotate((i / N_ROT) * PI2);
      buildUnit(c);
      c.restore();
    }
  }

  stamp(ctx, x, y, angle, gauge) {
    let b = Math.round((((angle % PI2) + PI2) % PI2) / PI2 * N_ROT) % N_ROT;
    const col = b % this.cols, row = (b / this.cols) | 0;
    const src = this.diag;
    const dst = this.designSize * gauge;
    ctx.drawImage(this.canvas, col * src, row * src, src, src, x - dst / 2, y - dst / 2, dst, dst);
  }
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

  // Build closure that prefers a photographic cutout, else procedural geometry.
  _unitBuilder(variant) {
    const key = 'link:' + variant;
    this._watch(key, () => this.links.delete(variant));
    const meta = VARIANTS[variant];
    return (c) => {
      const img = this.reg.cutout(key);
      if (img) {
        const w = meta.w * this.dpr, h = meta.h * this.dpr;
        c.drawImage(img, -w / 2, -h / 2, w, h);
      } else {
        meta.draw(c, this.dpr);
      }
    };
  }

  _link(variant) {
    let rc = this.links.get(variant);
    if (!rc) { rc = new RotationCache(variant, this.dpr, this._unitBuilder(variant)); this.links.set(variant, rc); }
    return rc;
  }

  _watch(key, invalidate) {
    if (this._subscribed.has(key) || !this.reg.manifest.has(key)) return;
    this._subscribed.add(key);
    this.reg.onLoad(key, invalidate);
  }

  // ── chains ────────────────────────────────────────────────────────────────
  /**
   * Stamp a chain of `style` along the particle polyline `P` at `gauge` scale.
   * @param {Array<{x:number,y:number}>} P
   */
  strokeChain(ctx, P, style, gauge = 1) {
    this._checkDpr();
    const layout = STYLES[style] || STYLES.rope;

    // one soft shadow polyline for depth + continuity (a single stroke, not
    // per-link geometry) — keeps the chain reading as one object under motion
    ctx.save();
    ctx.translate(2, 4);
    this._core(ctx, P, 5 * gauge, 'rgba(0,0,0,0.28)');
    ctx.restore();
    this._core(ctx, P, 2.2 * gauge, 'rgba(90,66,10,0.6)'); // thin gold cord

    let idx = 0;
    let need = layout.seq(0).pitch * gauge * 0.5;
    for (let s = 0; s < P.length - 1; s++) {
      const ax = P[s].x, ay = P[s].y;
      let dx = P[s + 1].x - ax, dy = P[s + 1].y - ay;
      const len = Math.hypot(dx, dy) || 1e-6;
      const ang = Math.atan2(dy, dx);
      let pos = 0;
      while (pos + need <= len) {
        pos += need;
        const t = pos / len;
        const link = layout.seq(idx);
        this._link(link.v).stamp(ctx, ax + dx * t, ay + dy * t, ang + link.ang, gauge);
        idx++;
        need = layout.seq(idx).pitch * gauge;
      }
      need -= (len - pos);
    }
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

  // ── ring & bangle primitives (for later cases) ──────────────────────────
  ring(ctx, x, y, r, { gauge = 1, gem = true } = {}) {
    this._checkDpr();
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
      ctx.fillStyle = '#E23A2E';
      const s = 6 * gauge; ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(-s / 2, -s / 2, s / 2, s / 2);
    }
    ctx.restore();
  }

  bangle(ctx, x, y, rx, ry, { gauge = 1 } = {}) {
    this._checkDpr();
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
