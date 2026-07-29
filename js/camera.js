// camera.js — cinematic scene transitions.
//
// Two moves:
//   · DOLLY  (storefront → interior) — a push-in through the door: the
//     storefront scales up past the viewer and fades while the interior comes
//     forward from behind, its layers scaling at different rates (parallax).
//   · ZOOM   (interior → case focus) — a smooth push toward the clicked case
//     while the rest of the room blurs and darkens, then hands off to the case.
//
// The camera only produces numbers; renderers decide what to do with them.
// `layerScale(depth)` is the parallax term: 0 = far wall, 1 = nearest surface.

const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);

export class Camera {
  constructor() {
    this.kind = null;         // 'dolly' | 'zoom' | null
    this.elapsed = 0;
    this.duration = 0;
    this.focus = { x: 0, y: 0 };
    this.onDone = null;
  }

  get active() { return this.kind !== null; }

  /** Raw 0→1 through the move. */
  get u() { return this.duration ? Math.min(1, this.elapsed / this.duration) : 1; }

  /** Eased 0→1 — the value renderers should use. */
  get p() {
    const u = this.u;
    return this.kind === 'zoom' ? easeInOutCubic(u) : easeOutCubic(u);
  }

  start(kind, duration, focus, onDone) {
    this.kind = kind;
    this.duration = duration;
    this.elapsed = 0;
    this.focus = focus || { x: 0, y: 0 };
    this.onDone = onDone || null;
  }

  cancel() { this.kind = null; this.onDone = null; }

  update(dt) {
    if (!this.kind) return;
    this.elapsed += dt * 1000;
    if (this.elapsed >= this.duration) {
      const cb = this.onDone;
      this.kind = null;
      this.onDone = null;
      if (cb) cb();
    }
  }

  /**
   * Apply a scale about the focus point. `depth` gives nearer layers a larger
   * scale than far ones, which is what reads as parallax during a push-in.
   */
  applyLayer(ctx, baseScale, depth = 0, parallax = 0) {
    const s = baseScale * (1 + parallax * depth);
    ctx.translate(this.focus.x, this.focus.y);
    ctx.scale(s, s);
    ctx.translate(-this.focus.x, -this.focus.y);
  }
}
