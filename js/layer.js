// layer.js — a design-sized offscreen canvas used to pre-composite a scene's
// static content. Steady-state frames become `blit()` + dynamic overlays
// instead of re-drawing the whole scene every frame.
//
// Typical use:
//   if (this.bg.ensure(dpr)) { const c = this.bg.begin(); …draw static…; this.bg.done(); }
//   this.bg.blit(ctx);

import { DESIGN } from './config.js';

export class Layer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.dpr = 0;
    this.dirty = true;
  }

  /** Size to the current dpr. Returns true when a re-bake is needed. */
  ensure(dpr) {
    const w = Math.round(DESIGN.W * dpr);
    const h = Math.round(DESIGN.H * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h || this.dpr !== dpr) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.dpr = dpr;
      this.dirty = true;
    }
    return this.dirty;
  }

  /** Clear and return a context in design-pixel coordinates. */
  begin() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, DESIGN.W, DESIGN.H);
    return c;
  }

  done() { this.dirty = false; }
  invalidate() { this.dirty = true; }

  blit(ctx) {
    ctx.drawImage(this.canvas, 0, 0, DESIGN.W, DESIGN.H);
  }
}
