// stage.js — maps the fixed 1848×1080 design surface onto any viewport.
//
// The stage fits a *design-space rect* to the screen: on landscape that rect is
// the whole design space (classic letterbox); on a portrait phone it is the
// current scene's 9:16 crop (see MOBILE_FRAMES), so each scene keeps a
// meaningful composition instead of shrinking into a letterboxed sliver.
//
// Canvas and DOM overlay both live inside #stage, so one transform moves the
// entire scene — the overlay stays pixel-aligned with what the canvas draws.
// The active frame is also published as CSS custom properties so portrait
// chrome can position itself relative to the visible crop.

import { DESIGN, FULL_FRAME } from './config.js';

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
    this.frame = { ...FULL_FRAME };

    stageEl.style.width = `${DESIGN.W}px`;
    stageEl.style.height = `${DESIGN.H}px`;

    this._onResize = this.fit.bind(this);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    this.fit();
  }

  /** Choose the design-space rect to fit. Re-fits immediately. */
  setFrame(rect) {
    const f = rect || FULL_FRAME;
    if (f.x === this.frame.x && f.y === this.frame.y &&
        f.w === this.frame.w && f.h === this.frame.h) return;
    this.frame = { ...f };
    this.fit();
  }

  /** Recompute the transform and resize the canvas backing store. */
  fit() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const f = this.frame;

    // fit the frame inside the viewport, then centre it
    this.scale = Math.min(vw / f.w, vh / f.h);
    const tx = vw / 2 - (f.x + f.w / 2) * this.scale;
    const ty = vh / 2 - (f.y + f.h / 2) * this.scale;
    this.stageEl.style.transform = `translate(${tx}px, ${ty}px) scale(${this.scale})`;

    // publish the visible crop so portrait chrome can sit inside it
    const s = this.stageEl.style;
    s.setProperty('--fx', `${f.x}px`);
    s.setProperty('--fy', `${f.y}px`);
    s.setProperty('--fw', `${f.w}px`);
    s.setProperty('--fh', `${f.h}px`);

    // Crisp canvas: backing store in device pixels, CSS box in design pixels.
    // Cap the effective dpr on very dense screens — beyond ~2.5 the extra
    // fill cost buys nothing visible on a phone.
    const raw = Math.max(1, window.devicePixelRatio || 1);
    this.dpr = Math.min(raw, 2);   // beyond 2x buys nothing and costs fill rate
    const bw = Math.round(DESIGN.W * this.dpr);
    const bh = Math.round(DESIGN.H * this.dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.canvas.style.width = `${DESIGN.W}px`;
    this.canvas.style.height = `${DESIGN.H}px`;
    // Draw in design-pixel coordinates regardless of dpr.
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Convert a design-pixel point to viewport (client) coordinates. */
  toClient(designX, designY) {
    const rect = this.stageEl.getBoundingClientRect();
    return {
      x: rect.left + designX * this.scale,
      y: rect.top + designY * this.scale,
    };
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
    window.removeEventListener('orientationchange', this._onResize);
  }
}
