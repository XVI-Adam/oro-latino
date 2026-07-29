// interior.js — 01 · Adentro (Inside). The shop interior, drawn in layers:
//   · a backlit acrylic light box hanging on chains from the ceiling
//   · two wall cases (white shelves on black backing, wood surround) plus a
//     chain rack on black hooks — each a hover-highlightable hit region whose
//     bilingual label lives in DOM chrome (see overlay.js)
//   · track spotlights casting warm pools down over the wall cases
//   · the sticker wall on the left as a dense procedural collage (colorful
//     rectangles now, real sticker cutouts later)
//   · an L-shaped glass counter with aluminum framing in the foreground
//   · a multi-pane window on the right showing the storefront in reverse —
//     the fascia sign reads backwards from in here, as it would in life
//
// Everything is procedural; the case interiors reuse the jewelry renderer.

import { DESIGN, PALETTE, STATES } from './config.js';
import { Layer } from './layer.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STICKER_COLORS = [
  '#E23A2E', '#D4AF37', '#1FA55A', '#2F6FD0', '#E8C86A',
  '#F4EBD9', '#C0392B', '#7B4BC9', '#E8752A', '#18A5A5',
];

// Wall furniture geometry (design px).
const RACK = { x: 360, y: 250, w: 320, h: 330 };
const CASE_A = { x: 720, y: 250, w: 350, h: 330 };
const CASE_B = { x: 1110, y: 250, w: 350, h: 330 };
// kept clear of the route index chrome in the top-left corner
const STICKERS = { x: 92, y: 252, w: 232, h: 358 };
const WINDOW = { x: 1512, y: 196, w: 292, h: 344 };
const LIGHTBOX = { x: 694, y: 92, w: 470, h: 140 };
const CEILING_H = 62;
const WALL_BOTTOM = 648;

export class Interior {
  /** @param {Jewelry} jewelry procedural jewelry renderer (case goods) */
  constructor(jewelry) {
    this.jewelry = jewelry;

    // Hover-able hit regions; `to` marks the one that navigates.
    this.hotspots = [
      { id: 'rack',  ...RACK,   es: 'Cadenas', en: 'Chains',   to: STATES.CASE_FOCUS },
      { id: 'caseA', ...CASE_A, es: 'Anillos', en: 'Rings' },
      { id: 'caseB', ...CASE_B, es: 'Dijes',   en: 'Pendants' },
    ];

    // Pre-composited static content, split by depth so the push-in can
    // parallax them and the case zoom can blur them with two drawImages.
    this.far = new Layer();   // room shell, sticker wall, window, cases, rack
    this.near = new Layer();  // the counter in the foreground

    this._buildStickers();
    this._buildRack();
  }

  /** Re-bake the static layers if the dpr changed. */
  _bake(dpr) {
    if (this.far.ensure(dpr)) {
      const c = this.far.begin();
      this._room(c);
      this._window(c);
      this._stickerWall(c);
      this._wallCase(c, CASE_A, 'rings');
      this._wallCase(c, CASE_B, 'pendants');
      this._chainRack(c);
      this._spotlights(c);
      this.far.done();
    }
    if (this.near.ensure(dpr)) {
      const c = this.near.begin();
      this._counter(c);
      this.near.done();
    }
  }

  hitTest(x, y) {
    for (const h of this.hotspots) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }

  _buildStickers() {
    const rng = mulberry32(90210);
    this.stickers = [];
    for (let i = 0; i < 150; i++) {
      const w = 26 + rng() * 62;
      const h = 18 + rng() * 40;
      this.stickers.push({
        x: STICKERS.x + rng() * (STICKERS.w - w * 0.4) - w * 0.2,
        y: STICKERS.y + rng() * (STICKERS.h - h * 0.4) - h * 0.2,
        w, h,
        rot: (rng() - 0.5) * 0.7,
        color: STICKER_COLORS[(rng() * STICKER_COLORS.length) | 0],
        round: rng() < 0.28,
        band: rng() < 0.45,
      });
    }
  }

  _buildRack() {
    const rng = mulberry32(7788);
    this.rackChains = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const x = RACK.x + 34 + i * ((RACK.w - 68) / (n - 1));
      const drop = 150 + rng() * 90;
      this.rackChains.push({
        x, drop,
        style: ['rope', 'box', 'figaro', 'cuban'][i % 4],
        gauge: 0.5 + rng() * 0.22,
      });
    }
  }

  // ── main draw ─────────────────────────────────────────────────────────
  /**
   * Steady state is two blits plus the animated overlays. `cam` optionally
   * carries { scale, parallax, focus, blur, darken } for the transitions.
   */
  draw(ctx, now, hoverId = null, dpr = 1, cam = null) {
    this._bake(dpr);

    const scale = cam?.scale ?? 1;
    const parallax = cam?.parallax ?? 0;
    const focus = cam?.focus ?? { x: DESIGN.W / 2, y: DESIGN.H / 2 };
    const blur = cam?.blur ?? 0;

    const place = (depth, fn) => {
      ctx.save();
      const s = scale * (1 + parallax * depth);
      ctx.translate(focus.x, focus.y);
      ctx.scale(s, s);
      ctx.translate(-focus.x, -focus.y);
      fn();
      ctx.restore();
    };

    const blurring = blur > 0.05;
    if (blurring) ctx.filter = `blur(${blur.toFixed(2)}px)`;
    place(0, () => this.far.blit(ctx));                 // far wall
    place(0.35, () => this._lightBox(ctx, now));        // hangs off the ceiling
    place(1, () => this.near.blit(ctx));                // counter, nearest
    if (blurring) ctx.filter = 'none';

    // live details that must not be baked
    if (!blurring) {
      place(0, () => this._windowSweep(ctx, now));
      if (hoverId) place(0, () => this._hover(ctx, hoverId, now));
    }

    const darken = cam?.darken ?? 0;
    if (darken > 0.001) {
      ctx.fillStyle = `rgba(0,0,0,${darken})`;
      ctx.fillRect(0, 0, DESIGN.W, DESIGN.H);
    }

    // The case being zoomed toward stays sharp and lit while the room falls
    // away around it — re-blit just that region, unfiltered and undimmed.
    const fr = cam?.focusRect;
    if (blurring && fr) {
      place(0, () => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(fr.x - 12, fr.y - 12, fr.w + 24, fr.h + 24);
        ctx.clip();
        this.far.blit(ctx);
        ctx.restore();
      });
    }
  }

  // room shell: ceiling, back wall, floor
  _room(ctx) {
    const { W, H } = DESIGN;

    const wall = ctx.createLinearGradient(0, CEILING_H, 0, WALL_BOTTOM);
    wall.addColorStop(0, '#2b2117');
    wall.addColorStop(0.55, '#241b12');
    wall.addColorStop(1, '#171009');
    ctx.fillStyle = wall;
    ctx.fillRect(0, CEILING_H, W, WALL_BOTTOM - CEILING_H);

    ctx.fillStyle = '#0a0806';
    ctx.fillRect(0, 0, W, CEILING_H);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, CEILING_H - 3, W, 3);

    // track rail + fixtures
    ctx.fillStyle = '#15171b';
    ctx.fillRect(120, CEILING_H - 18, W - 240, 12);
    for (const fx of this._fixtures()) {
      ctx.fillStyle = '#1d2026';
      ctx.fillRect(fx - 13, CEILING_H - 24, 26, 22);
      ctx.fillStyle = '#FFDCA8';
      ctx.fillRect(fx - 9, CEILING_H - 5, 18, 4);
    }

    // floor
    const floor = ctx.createLinearGradient(0, WALL_BOTTOM, 0, H);
    floor.addColorStop(0, '#16110b');
    floor.addColorStop(1, '#0b0806');
    ctx.fillStyle = floor;
    ctx.fillRect(0, WALL_BOTTOM, W, H - WALL_BOTTOM);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, WALL_BOTTOM, W, 6);
  }

  _fixtures() {
    return [
      RACK.x + RACK.w / 2,
      CASE_A.x + CASE_A.w / 2,
      CASE_B.x + CASE_B.w / 2,
    ];
  }

  // warm pools thrown down the wall onto the cases
  _spotlights(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const fx of this._fixtures()) {
      const top = CEILING_H;
      const bottom = WALL_BOTTOM - 20;

      // cone
      const cone = ctx.createLinearGradient(0, top, 0, bottom);
      cone.addColorStop(0, 'rgba(255,196,120,0.16)');
      cone.addColorStop(0.6, 'rgba(255,186,108,0.07)');
      cone.addColorStop(1, 'rgba(255,180,100,0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(fx - 26, top);
      ctx.lineTo(fx + 26, top);
      ctx.lineTo(fx + 250, bottom);
      ctx.lineTo(fx - 250, bottom);
      ctx.closePath();
      ctx.fill();

      // pool on the case face
      const pool = ctx.createRadialGradient(fx, 400, 20, fx, 400, 260);
      pool.addColorStop(0, 'rgba(255,200,130,0.13)');
      pool.addColorStop(1, 'rgba(255,200,130,0)');
      ctx.fillStyle = pool;
      ctx.fillRect(fx - 280, 200, 560, 440);
    }
    ctx.restore();
  }

  // ── sticker wall (dense procedural collage) ───────────────────────────
  _stickerWall(ctx) {
    const S = STICKERS;
    ctx.save();
    ctx.beginPath();
    ctx.rect(S.x, S.y, S.w, S.h);
    ctx.clip();

    ctx.fillStyle = '#0f0b07';
    ctx.fillRect(S.x, S.y, S.w, S.h);

    for (const s of this.stickers) {
      ctx.save();
      ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
      ctx.rotate(s.rot);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(-s.w / 2 + 2, -s.h / 2 + 3, s.w, s.h);
      ctx.fillStyle = s.color;
      if (s.round) {
        ctx.beginPath();
        ctx.ellipse(0, 0, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-s.w / 2, -s.h / 2, s.w, s.h);
      }
      if (s.band) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(-s.w / 2, -s.h * 0.12, s.w, s.h * 0.24);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(-s.w / 2, -s.h / 2, s.w, 2);
      ctx.restore();
    }

    // grimy vignette over the collage
    const v = ctx.createLinearGradient(S.x, S.y, S.x, S.y + S.h);
    v.addColorStop(0, 'rgba(0,0,0,0.45)');
    v.addColorStop(0.5, 'rgba(0,0,0,0.12)');
    v.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = v;
    ctx.fillRect(S.x, S.y, S.w, S.h);
    ctx.restore();
  }

  // ── wall cases: white shelves on black backing, wood surround ─────────
  _wallCase(ctx, R, kind) {
    const J = this.jewelry;

    // wood surround
    const wood = ctx.createLinearGradient(R.x, R.y, R.x, R.y + R.h);
    wood.addColorStop(0, '#6B4526');
    wood.addColorStop(0.5, '#54341B');
    wood.addColorStop(1, '#3E2513');
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(R.x + 6, R.y + 8, R.w, R.h);
    ctx.fillStyle = wood;
    ctx.fillRect(R.x, R.y, R.w, R.h);
    ctx.fillStyle = 'rgba(255,214,150,0.14)';
    ctx.fillRect(R.x, R.y, R.w, 4);

    // black backing
    const inset = 20;
    const bx = R.x + inset, by = R.y + inset;
    const bw = R.w - inset * 2, bh = R.h - inset * 2;
    ctx.fillStyle = '#0C0C0E';
    ctx.fillRect(bx, by, bw, bh);

    // white shelves + goods
    const shelves = 3;
    const sh = bh / shelves;
    for (let i = 0; i < shelves; i++) {
      const sy = by + i * sh + sh - 13;
      ctx.fillStyle = '#F2EEE4';
      ctx.fillRect(bx + 8, sy, bw - 16, 9);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(bx + 8, sy + 9, bw - 16, 5);

      const cy = sy - 22;
      if (kind === 'rings') {
        for (let k = 0; k < 5; k++) {
          J.ring(ctx, bx + 34 + k * ((bw - 68) / 4), cy, 13,
            { gauge: 0.8, gem: true, gemColor: k % 2 ? '#1FA55A' : PALETTE.vermilion, ao: true });
        }
      } else {
        const types = ['cross', 'medallion', 'tablet', 'crucifix'];
        for (let k = 0; k < 4; k++) {
          J.stampPendant(ctx, types[(k + i) % 4],
            bx + 40 + k * ((bw - 80) / 3), cy - 26, Math.PI / 2, 0.62);
        }
      }
    }

    // interior glow + glass sheen
    const g = ctx.createLinearGradient(bx, by, bx, by + bh);
    g.addColorStop(0, 'rgba(255,214,150,0.10)');
    g.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = g;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + bw * 0.45, by);
    ctx.lineTo(bx, by + bh * 0.7);
    ctx.closePath();
    ctx.fill();
  }

  // ── chain rack on black hooks ─────────────────────────────────────────
  _chainRack(ctx) {
    const R = RACK;

    // black board + hook bar
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(R.x + 6, R.y + 8, R.w, R.h);
    ctx.fillStyle = '#100F12';
    ctx.fillRect(R.x, R.y, R.w, R.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    ctx.strokeRect(R.x + 1, R.y + 1, R.w - 2, R.h - 2);

    const barY = R.y + 44;
    const bar = ctx.createLinearGradient(0, barY - 8, 0, barY + 6);
    bar.addColorStop(0, '#3a3f49');
    bar.addColorStop(1, '#14171d');
    ctx.fillStyle = bar;
    ctx.fillRect(R.x + 16, barY - 8, R.w - 32, 12);

    for (const c of this.rackChains) {
      // black hook
      ctx.strokeStyle = '#0A0A0C';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(c.x, barY + 4, 7, Math.PI, Math.PI * 2.1);
      ctx.stroke();

      // a straight hanging chain, stamped from the same link atlas
      const top = barY + 11;
      const pts = [];
      const n = 7;
      for (let i = 0; i < n; i++) {
        pts.push({ x: c.x, y: top + (c.drop * i) / (n - 1) });
      }
      this.jewelry.strokeChain(ctx, pts, c.style, c.gauge);
    }
  }

  // ── backlit acrylic light box, hanging on chains ──────────────────────
  _lightBox(ctx, now) {
    const B = LIGHTBOX;
    const pulse = 0.92 + 0.08 * Math.sin(now * 0.0011);

    // hanging chains from the ceiling
    for (const hx of [B.x + 56, B.x + B.w - 56]) {
      const pts = [];
      for (let i = 0; i < 5; i++) {
        pts.push({ x: hx, y: CEILING_H - 6 + ((B.y - CEILING_H + 6) * i) / 4 });
      }
      this.jewelry.strokeChain(ctx, pts, 'box', 0.5);
    }

    // halo
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(
      B.x + B.w / 2, B.y + B.h / 2, 40, B.x + B.w / 2, B.y + B.h / 2, B.w * 0.8);
    halo.addColorStop(0, `rgba(255,240,210,${0.16 * pulse})`);
    halo.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(B.x - 300, B.y - 180, B.w + 600, B.h + 380);
    ctx.restore();

    // aluminum case
    ctx.fillStyle = '#0d0d0f';
    ctx.fillRect(B.x - 9, B.y - 9, B.w + 18, B.h + 18);
    ctx.fillStyle = '#8b9099';
    ctx.fillRect(B.x - 6, B.y - 6, B.w + 12, B.h + 12);

    // white acrylic face
    const face = ctx.createLinearGradient(B.x, B.y, B.x, B.y + B.h);
    face.addColorStop(0, `rgba(255,255,252,${pulse})`);
    face.addColorStop(0.5, `rgba(246,246,240,${pulse})`);
    face.addColorStop(1, `rgba(228,228,222,${pulse})`);
    ctx.fillStyle = face;
    ctx.fillRect(B.x, B.y, B.w, B.h);

    // black lettering + red diamond mark
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#121214';
    ctx.font = '800 40px "Avenir Next Condensed", Futura, "Trebuchet MS", sans-serif';
    try { ctx.letterSpacing = '3px'; } catch { /* older engines */ }
    ctx.fillText('ORO LATINO INC', B.x + B.w / 2 + 26, B.y + 50);
    ctx.font = '600 27px ui-monospace, "SF Mono", Menlo, monospace';
    try { ctx.letterSpacing = '2px'; } catch { /* older engines */ }
    ctx.fillText('212-925-1538', B.x + B.w / 2 + 26, B.y + 98);
    try { ctx.letterSpacing = '0px'; } catch { /* older engines */ }
    ctx.restore();

    this._diamondMark(ctx, B.x + 58, B.y + B.h / 2, 22);

    // face sheen
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.moveTo(B.x, B.y);
    ctx.lineTo(B.x + B.w * 0.34, B.y);
    ctx.lineTo(B.x, B.y + B.h * 0.85);
    ctx.closePath();
    ctx.fill();
  }

  // red diamond with sparkle lines
  _diamondMark(ctx, cx, cy, r) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = PALETTE.vermilion;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const r0 = r * 1.25, r1 = i % 2 === 0 ? r * 1.95 : r * 1.6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = PALETTE.vermilion;
    ctx.fillRect(-r * 0.72, -r * 0.72, r * 1.44, r * 1.44);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(-r * 0.72, -r * 0.72, r * 0.66, r * 0.66);
    ctx.restore();
  }

  // ── multi-pane window: the storefront seen from inside (reversed) ─────
  _window(ctx) {
    const V = WINDOW;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(V.x + 5, V.y + 6, V.w, V.h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(V.x, V.y, V.w, V.h);
    ctx.clip();

    // night street beyond the glass
    const night = ctx.createLinearGradient(0, V.y, 0, V.y + V.h);
    night.addColorStop(0, '#0a1020');
    night.addColorStop(0.62, '#0d1526');
    night.addColorStop(0.63, '#14161a');
    night.addColorStop(1, '#1b1d22');
    ctx.fillStyle = night;
    ctx.fillRect(V.x, V.y, V.w, V.h);

    // far streetlight glow + a couple of lit windows across the way
    const gl = ctx.createRadialGradient(V.x + V.w * 0.72, V.y + 70, 8, V.x + V.w * 0.72, V.y + 70, 120);
    gl.addColorStop(0, 'rgba(255,214,150,0.5)');
    gl.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(V.x, V.y, V.w, V.h);
    ctx.fillStyle = 'rgba(255,220,160,0.28)';
    ctx.fillRect(V.x + 30, V.y + 42, 16, 22);
    ctx.fillRect(V.x + 58, V.y + 76, 14, 18);

    // our own fascia sign, seen from behind → mirrored text
    const sy = V.y + V.h * 0.34;
    ctx.fillStyle = 'rgba(8,8,9,0.92)';
    ctx.fillRect(V.x, sy - 30, V.w, 52);
    ctx.save();
    ctx.translate(V.x + V.w / 2, sy);
    ctx.scale(-1, 1); // reversed: we're reading the sign from the inside
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(212,175,55,0.55)';
    ctx.font = '800 25px "Avenir Next Condensed", Futura, "Trebuchet MS", sans-serif';
    ctx.fillText('ORO LATINO INC.', 0, -4);
    ctx.font = '500 13px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(220,220,220,0.42)';
    ctx.fillText('212-925-1538', 0, 15);
    ctx.restore();

    // the sidewalk light pool spilling from our own window
    const spill = ctx.createRadialGradient(
      V.x + V.w / 2, V.y + V.h * 0.78, 10, V.x + V.w / 2, V.y + V.h * 0.78, V.w * 0.7);
    spill.addColorStop(0, 'rgba(255,196,120,0.22)');
    spill.addColorStop(1, 'rgba(255,196,120,0)');
    ctx.fillStyle = spill;
    ctx.fillRect(V.x, V.y + V.h * 0.5, V.w, V.h * 0.5);

    ctx.restore();

    // mullions: 3 × 4 panes
    ctx.strokeStyle = '#15171b';
    ctx.lineWidth = 7;
    for (let i = 1; i < 3; i++) {
      const x = V.x + (V.w * i) / 3;
      ctx.beginPath(); ctx.moveTo(x, V.y); ctx.lineTo(x, V.y + V.h); ctx.stroke();
    }
    for (let i = 1; i < 4; i++) {
      const y = V.y + (V.h * i) / 4;
      ctx.beginPath(); ctx.moveTo(V.x, y); ctx.lineTo(V.x + V.w, y); ctx.stroke();
    }
    // frame
    ctx.strokeStyle = '#0d0e11';
    ctx.lineWidth = 16;
    ctx.strokeRect(V.x - 8, V.y - 8, V.w + 16, V.h + 16);
    ctx.strokeStyle = 'rgba(212,175,55,0.2)';
    ctx.lineWidth = 2;
    ctx.strokeRect(V.x, V.y, V.w, V.h);
  }

  /** Slow reflection drifting across the window glass (kept out of the bake). */
  _windowSweep(ctx, now) {
    const V = WINDOW;
    const c = 0.3 + 0.06 * Math.sin(now * 0.00019);
    ctx.save();
    ctx.beginPath();
    ctx.rect(V.x, V.y, V.w, V.h);
    ctx.clip();
    const sweep = ctx.createLinearGradient(V.x, V.y, V.x + V.w, V.y + V.h);
    sweep.addColorStop(clamp(c - 0.12, 0, 1), 'rgba(255,255,255,0)');
    sweep.addColorStop(clamp(c, 0, 1), 'rgba(255,255,255,0.05)');
    sweep.addColorStop(clamp(c + 0.12, 0, 1), 'rgba(255,255,255,0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(V.x, V.y, V.w, V.h);
    ctx.restore();
  }

  // ── L-shaped glass counter, aluminum framed, in the foreground ────────
  _counter(ctx) {
    const back = { x: 96, y: 690, w: 1120, h: 220 };   // long run along the wall
    const wing = { x: 1216, y: 690, w: 470, h: 330 };  // return leg toward us

    for (const R of [back, wing]) this._counterBody(ctx, R);

    // aluminum corner post where the two legs meet
    ctx.fillStyle = '#9aa0a8';
    ctx.fillRect(back.x + back.w - 4, back.y - 6, 26, wing.h + 12);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(back.x + back.w - 4, back.y - 6, 8, wing.h + 12);

    // warm reflection of the light box on the counter glass
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = ctx.createLinearGradient(0, back.y, 0, back.y + 90);
    r.addColorStop(0, 'rgba(255,236,200,0.13)');
    r.addColorStop(1, 'rgba(255,236,200,0)');
    ctx.fillStyle = r;
    ctx.fillRect(LIGHTBOX.x - 60, back.y, LIGHTBOX.w + 120, 90);
    ctx.restore();
  }

  _counterBody(ctx, R) {
    // dark vitrine interior
    const inside = ctx.createLinearGradient(0, R.y, 0, R.y + R.h);
    inside.addColorStop(0, '#1b1d22');
    inside.addColorStop(1, '#0b0c0e');
    ctx.fillStyle = inside;
    ctx.fillRect(R.x, R.y, R.w, R.h);

    // navy display pads with goods
    const J = this.jewelry;
    const pads = Math.max(2, Math.round(R.w / 300));
    const pw = (R.w - 40) / pads - 20;
    for (let i = 0; i < pads; i++) {
      const px = R.x + 30 + i * (pw + 20);
      const py = R.y + 42;
      const ph = R.h - 96;
      ctx.fillStyle = PALETTE.felt;
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);

      const cy = py + ph / 2;
      if (i % 2 === 0) {
        for (let k = 0; k < 4; k++) {
          J.ring(ctx, px + 34 + k * ((pw - 68) / 3), cy, 15,
            { gauge: 0.85, gem: true, gemColor: k % 2 ? PALETTE.vermilion : '#1FA55A', ao: true });
        }
      } else {
        for (let k = 0; k < 3; k++) {
          J.bangle(ctx, px + 46 + k * ((pw - 92) / 2), cy, 40, 16, { gauge: 0.8, ao: true });
        }
      }
    }

    // glass top + aluminum framing
    ctx.fillStyle = 'rgba(180,205,225,0.09)';
    ctx.fillRect(R.x, R.y, R.w, R.h);
    const alu = ctx.createLinearGradient(0, R.y - 12, 0, R.y + 6);
    alu.addColorStop(0, '#c3c9d1');
    alu.addColorStop(0.5, '#8b9199');
    alu.addColorStop(1, '#565c64');
    ctx.fillStyle = alu;
    ctx.fillRect(R.x - 6, R.y - 12, R.w + 12, 18);         // top rail
    ctx.fillStyle = '#7d838b';
    ctx.fillRect(R.x - 6, R.y + R.h - 6, R.w + 12, 14);    // bottom rail
    ctx.fillRect(R.x - 6, R.y - 12, 12, R.h + 20);         // left post
    ctx.fillRect(R.x + R.w - 6, R.y - 12, 12, R.h + 20);   // right post
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(R.x - 6, R.y - 12, R.w + 12, 3);

    // glass sheen streaks
    ctx.save();
    ctx.beginPath();
    ctx.rect(R.x, R.y, R.w, R.h);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 3; i++) {
      const sx = R.x + 60 + i * (R.w / 3);
      ctx.beginPath();
      ctx.moveTo(sx, R.y);
      ctx.lineTo(sx + 70, R.y);
      ctx.lineTo(sx + 10, R.y + R.h);
      ctx.lineTo(sx - 60, R.y + R.h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ── hover highlight on a hit region ───────────────────────────────────
  _hover(ctx, hoverId, now) {
    if (!hoverId) return;
    const h = this.hotspots.find((s) => s.id === hoverId);
    if (!h) return;
    const a = 0.5 + 0.18 * Math.sin(now * 0.005);
    ctx.save();
    ctx.strokeStyle = `rgba(212,175,55,${a})`;
    ctx.lineWidth = 3;
    ctx.strokeRect(h.x - 4, h.y - 4, h.w + 8, h.h + 8);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,214,150,0.05)';
    ctx.fillRect(h.x, h.y, h.w, h.h);
    ctx.restore();
  }
}
