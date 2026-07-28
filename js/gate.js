// gate.js — the roll-down security gate. Fully procedural, no images.
//
// Physics model (pos ∈ [0,1]: 0 = closed on the sill, 1 = rolled up into the
// cylinder). The dominant force is an INVERTED spring `S·(pos − 0.5)`:
//   • below halfway it points DOWN  → the gate feels heavy, resists lifting
//   • above halfway it points UP    → the gate assists, springing toward open
// so 0.5 is a tipping point. While dragging, the hand adds a spring toward the
// pointer; the weight makes the gate lag the hand (heft). Release below the tip
// and gravity wins — it rattles back down and bounces on the sill. Cross the tip
// (or flick hard) and it snaps home, latches, and fires `onOpen`.

import { PALETTE } from './config.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class Gate {
  /**
   * @param {{x:number,y:number,w:number,h:number}} rect  opening in design px
   * @param {() => void} onOpen  fired once when the gate latches fully open
   */
  constructor(rect, onOpen) {
    this.rect = rect;
    this.onOpen = onOpen || (() => {});
    this.slatH = 26;

    // ── physics state ──────────────────────────────────────────────────────
    this.pos = 0;        // 0 closed → 1 open
    this.vel = 0;        // pos units / second
    this.dragging = false;
    this.hand = 0;       // pointer target while dragging
    this.opened = false;
    this.shake = 0;      // 0→1, decays; drives screen shake
    this.rattle = 0;     // 0→1, decays; drives per-slat jitter

    // ── tuning ─────────────────────────────────────────────────────────────
    this.S = 9.5;                 // inverted-spring stiffness (weight ⇄ assist)
    this.D = 2.7;                 // velocity damping (friction)
    this.H = 20;                  // hand-spring stiffness while dragging
    this.travel = rect.h * 0.85;  // px of upward drag for a full open

    this._startPointerY = 0;
    this._startPos = 0;
    this._slatGrad = null;
  }

  reset(pos = 0) {
    this.pos = pos;
    this.vel = 0;
    this.hand = pos;
    this.dragging = false;
    this.opened = false;
    this.shake = 0;
    this.rattle = 0;
  }

  /** Motorized assist (accessibility / the Abrir button): kick past the tip. */
  autoOpen() {
    if (this.opened) return;
    this.dragging = false;
    this.vel = Math.max(this.vel, 2.8);
    this.rattle = Math.max(this.rattle, 0.45);
  }

  // ── input ──────────────────────────────────────────────────────────────
  pointerDown(designY) {
    if (this.opened) return;
    this.dragging = true;
    this._startPointerY = designY;
    this._startPos = this.pos;
    this.hand = this.pos;
  }

  pointerMove(designY) {
    if (!this.dragging) return;
    const d = (this._startPointerY - designY) / this.travel; // up ⇒ positive
    this.hand = clamp(this._startPos + d, 0, 1.06);
  }

  pointerUp() {
    if (!this.dragging) return;
    this.dragging = false;
    // release feedback scales with how fast the curtain was moving
    const sp = Math.abs(this.vel);
    this.rattle = Math.max(this.rattle, Math.min(1, sp * 0.4));
    this.shake = Math.max(this.shake, Math.min(1, sp * 0.22));
  }

  /** Scroll up (deltaY < 0) nudges the gate open. */
  wheel(deltaY) {
    if (this.opened) return;
    this.vel = clamp(this.vel + -deltaY * 0.0016, -6, 6);
    this.rattle = Math.max(this.rattle, 0.22);
  }

  // ── simulation ───────────────────────────────────────────────────────────
  update(dt) {
    if (this.opened) { this._decay(dt); return; }
    dt = Math.min(dt, 1 / 30); // guard against long frames blowing up physics

    let F = this.S * (this.pos - 0.5);              // weight below .5 / assist above
    if (this.dragging) F += this.H * (this.hand - this.pos);
    if (this.pos > 0.9) F += 46 * (1 - this.pos);   // snap-home latch near the top
    F -= this.D * this.vel;                          // damping

    this.vel += F * dt;
    this.pos += this.vel * dt;

    // bottom: bounce off the sill with a rattle
    if (this.pos <= 0) {
      this.pos = 0;
      if (this.vel < -0.15) {
        const impact = Math.min(1, -this.vel);
        this.vel = -this.vel * 0.42;
        this.rattle = Math.max(this.rattle, impact);
        this.shake = Math.max(this.shake, impact * 0.75);
      } else {
        this.vel = 0;
      }
    }

    // top: latch open
    if (this.pos >= 1) {
      this.pos = 1;
      this.vel = 0;
      if (!this.opened) {
        this.opened = true;
        this.shake = Math.max(this.shake, 0.6);
        this.rattle = Math.max(this.rattle, 0.7);
        this.onOpen();
      }
    }

    this._decay(dt);
  }

  _decay(dt) {
    this.shake *= Math.exp(-7 * dt);
    this.rattle *= Math.exp(-6 * dt);
    if (this.shake < 0.001) this.shake = 0;
    if (this.rattle < 0.001) this.rattle = 0;
  }

  /** Random screen-shake offset for this frame (design px). */
  shakeOffset() {
    if (this.shake <= 0) return { x: 0, y: 0 };
    const m = this.shake * 15;
    return { x: (Math.random() * 2 - 1) * m, y: (Math.random() * 2 - 1) * m * 0.7 };
  }

  // ── rendering ────────────────────────────────────────────────────────────
  draw(ctx, now) {
    const { x, y, w, h } = this.rect;
    const sillY = y + h;
    const pos = this.pos;
    const railY = sillY - pos * h;          // bottom rail rises as it opens
    const cylH = 46 + pos * h * 0.30;        // roll thickens as slats wind on
    const cylBottom = y + cylH;

    this._sideTracks(ctx, x, y, w, h);

    // warm light spilling out of the opening beneath the rising rail
    if (pos > 0.002 && railY < sillY) {
      const spillH = 150;
      const g = ctx.createLinearGradient(0, railY, 0, railY + spillH);
      const a = 0.4 * Math.min(1, pos * 1.6);
      g.addColorStop(0, `rgba(255, 208, 140, ${a})`);
      g.addColorStop(1, 'rgba(255, 208, 140, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, railY, w, spillH);
    }

    // the metal curtain: stacked corrugated slats from top down to the rail
    if (railY > y) {
      const jit = this.rattle;
      let i = 0;
      for (let yy = y; yy < railY; yy += this.slatH, i++) {
        const sh = Math.min(this.slatH, railY - yy);
        const jx = jit ? Math.sin(now * 0.05 + i * 1.3) * jit * 3 : 0;
        this._slat(ctx, x + jx, yy, w, sh, pos, i);
      }
      this._rail(ctx, x, w, railY, pos);
    }

    // the roll at the top (drawn over the topmost slats — they wind into it)
    this._cylinder(ctx, x, y, w, cylH);
  }

  _slatGradient(ctx) {
    if (this._slatGrad) return this._slatGrad;
    const g = ctx.createLinearGradient(0, 0, 0, this.slatH);
    g.addColorStop(0.0, '#34383f');
    g.addColorStop(0.18, '#6c717a'); // ridge highlight
    g.addColorStop(0.5, '#4a4e56');
    g.addColorStop(0.85, '#2a2d32');
    g.addColorStop(1.0, '#17191c'); // groove shadow
    this._slatGrad = g;
    return g;
  }

  _slat(ctx, x, y, w, hh, pos, i) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = this._slatGradient(ctx); // gradient reused via translate
    ctx.fillRect(0, 0, w, hh);

    // light bleeding through the groove between slats — grows as it rises
    const bleed = Math.min(1, 0.12 + pos * 0.7);
    ctx.fillStyle = `rgba(255, 224, 168, ${0.14 * bleed})`;
    ctx.fillRect(0, hh - 1.5, w, 1.5);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 0, w, 1);
    ctx.restore();

    // faint vertical ribs (every ~130px) for corrugated cross-texture
    if (i % 1 === 0) {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      for (let rx = x + 130; rx < x + w; rx += 130) {
        ctx.beginPath();
        ctx.moveTo(rx, y);
        ctx.lineTo(rx, y + hh);
        ctx.stroke();
      }
    }
  }

  _rail(ctx, x, w, railY, pos) {
    const rh = 32;
    const ry = railY - rh;
    const g = ctx.createLinearGradient(0, ry, 0, ry + rh);
    g.addColorStop(0, '#5c616a');
    g.addColorStop(0.5, '#34383e');
    g.addColorStop(1, '#141518');
    ctx.fillStyle = g;
    ctx.fillRect(x, ry, w, rh);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeRect(x + 0.5, ry + 0.5, w - 1, rh - 1);

    // brass grab handle
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(x + w / 2 - 80, ry + 9, 160, rh - 18);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + w / 2 - 80, ry + 9, 160, 3);

    // vermilion padlock diamond — only while essentially closed ("locked")
    if (pos < 0.06) {
      const cx = x + w / 2;
      const cy = railY + 40;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = PALETTE.vermilion;
      ctx.fillRect(-11, -11, 22, 22);
      ctx.restore();
      ctx.strokeStyle = PALETTE.vermilion;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy - 12, 8, Math.PI, 0);
      ctx.stroke();
    }
  }

  _cylinder(ctx, x, y, w, cylH) {
    const cylBottom = y + cylH;
    const g = ctx.createLinearGradient(0, y - 8, 0, cylBottom);
    g.addColorStop(0, '#1d1f24');
    g.addColorStop(0.35, '#3d424b');
    g.addColorStop(0.55, '#4d525b');
    g.addColorStop(1, '#131417');
    ctx.fillStyle = g;
    ctx.fillRect(x - 8, y - 10, w + 16, cylH + 10);

    // wound-slat banding
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1.5;
    const bands = Math.max(3, Math.floor(cylH / 11));
    for (let b = 1; b < bands; b++) {
      const by = y + (b / bands) * cylH;
      ctx.beginPath();
      ctx.moveTo(x - 8, by);
      ctx.lineTo(x + w + 8, by);
      ctx.stroke();
    }
    // top catch light + bottom lip where the curtain emerges
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(x - 8, y - 10, w + 16, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - 8, cylBottom - 3, w + 16, 3);

    // end brackets
    ctx.fillStyle = '#0e0f12';
    ctx.fillRect(x - 14, y - 12, 8, cylH + 14);
    ctx.fillRect(x + w + 6, y - 12, 8, cylH + 14);
  }

  _sideTracks(ctx, x, y, w, h) {
    ctx.fillStyle = '#0e0f12';
    ctx.fillRect(x - 14, y, 14, h);
    ctx.fillRect(x + w, y, 14, h);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(x - 3, y, 3, h);
    ctx.fillRect(x + w, y, 3, h);
  }
}
