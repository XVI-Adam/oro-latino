// stage.js — maps the fixed 1848×1080 design surface onto any viewport.
// The stage is scaled by a single uniform factor (letterboxed) and centered.
// Canvas backing store is sized to design×dpr so drawing stays crisp.

import { DESIGN } from './config.js';

export class Stage {
  /**
   * @param {HTMLElement} stageEl   the fixed-size design surface
   * @param {HTMLCanvasElement} canvas
   */
  constructor(stageEl, canvas) {
    this.stageEl = stageEl;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    stageEl.style.width = `${DESIGN.W}px`;
    stageEl.style.height = `${DESIGN.H}px`;

    this._onResize = this.fit.bind(this);
    window.addEventListener('resize', this._onResize);
    this.fit();
  }

  /** Recompute the letterbox scale and resize the canvas backing store. */
  fit() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.scale = Math.min(vw / DESIGN.W, vh / DESIGN.H);

    // Scale + center the whole design surface.
    this.stageEl.style.transform = `translate(-50%, -50%) scale(${this.scale})`;

    // Crisp canvas: backing store in device pixels, CSS box in design pixels.
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(DESIGN.W * this.dpr);
    this.canvas.height = Math.round(DESIGN.H * this.dpr);
    this.canvas.style.width = `${DESIGN.W}px`;
    this.canvas.style.height = `${DESIGN.H}px`;
    // Draw in design-pixel coordinates regardless of dpr.
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Convert a viewport (client) point to design-pixel coordinates. */
  toDesign(clientX, clientY) {
    const rect = this.stageEl.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / this.scale,
      y: (clientY - rect.top) / this.scale,
    };
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
  }
}
