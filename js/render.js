// render.js — canvas draw loop. Paints the backdrop for the current state and
// a labeled gray-box placeholder for every scene element. No assets yet.

import { DESIGN, PALETTE, SCENES, STATES } from './config.js';

export class Renderer {
  /**
   * @param {Stage} stage
   * @param {StateMachine} machine
   * @param {() => string|null} getHover  id of hovered interactive box, or null
   */
  constructor(stage, machine, getHover, gate, chainRail) {
    this.stage = stage;
    this.machine = machine;
    this.getHover = getHover;
    this.gate = gate;
    this.chainRail = chainRail;
    this._raf = null;
    this._last = 0;
    this._loop = this._loop.bind(this);
  }

  start() { if (!this._raf) this._raf = requestAnimationFrame(this._loop); }
  stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }

  _loop(now) {
    const dt = this._last ? (now - this._last) / 1000 : 0;
    this._last = now;
    if (this.gate && this._isGateState()) this.gate.update(dt);
    if (this.chainRail && this.machine.state === STATES.CASE_FOCUS) this.chainRail.update(dt);
    this.draw(now);
    this._raf = requestAnimationFrame(this._loop);
  }

  _isGateState() {
    return this.machine.state === STATES.GATE_CLOSED || this.machine.state === STATES.GATE_OPENING;
  }

  draw(now = performance.now()) {
    const ctx = this.stage.ctx;

    if (this._isGateState()) { this._drawGate(ctx, now); return; }

    const scene = SCENES[this.machine.state];
    if (!scene) return;

    this._backdrop(ctx, scene.backdrop);

    if (this.machine.state === STATES.CASE_FOCUS && this.chainRail) {
      this.chainRail.draw(ctx, now);
    }

    const hover = this.getHover ? this.getHover() : null;
    for (const box of scene.boxes) {
      this._box(ctx, box, box.id === hover);
    }

    if (this.machine.state === STATES.ENTERING) {
      this._dolly(ctx, this.machine.transitionProgress(now));
    }
  }

  // Storefront revealed slat-by-slat behind the gate, plus the gate itself,
  // with a physics-driven screen shake on release / impact.
  _drawGate(ctx, now) {
    const { W, H } = DESIGN;
    // Solid black first so the shake translate never exposes stale pixels.
    ctx.fillStyle = PALETTE.black;
    ctx.fillRect(0, 0, W, H);

    const shake = this.gate.shakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);

    this._backdrop(ctx, 'fascia');
    // Reveal-behind: the actual storefront placeholders.
    for (const box of SCENES[STATES.STOREFRONT].boxes) this._box(ctx, box, false);

    this.gate.draw(ctx, now);
    ctx.restore();
  }

  // ── backdrops ───────────────────────────────────────────────────────────
  _backdrop(ctx, kind) {
    const { W, H } = DESIGN;
    if (kind === 'fascia') {
      ctx.fillStyle = PALETTE.black;
      ctx.fillRect(0, 0, W, H);
    } else if (kind === 'interior') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#2A2118');
      g.addColorStop(1, '#15100B');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else if (kind === 'felt') {
      const g = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, W * 0.7);
      g.addColorStop(0, PALETTE.felt);
      g.addColorStop(1, PALETTE.feltLo);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ── placeholder gray box ────────────────────────────────────────────────
  _box(ctx, box, isHover) {
    const { x, y, w, h, es, en, to } = box;

    ctx.fillStyle = PALETTE.box;
    ctx.fillRect(x, y, w, h);

    ctx.lineWidth = isHover ? 6 : 3;
    ctx.strokeStyle = isHover ? PALETTE.gold : (to ? PALETTE.goldLo : PALETTE.boxLine);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // Diagonal hatch so it reads as "placeholder", not final art.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    for (let i = -h; i < w; i += 36) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i + h, y + h);
      ctx.stroke();
    }
    ctx.restore();

    // Labels centered in the box.
    ctx.fillStyle = PALETTE.boxText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 30px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.fillText(es, x + w / 2, y + h / 2 - 20);
    ctx.font = '400 22px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.fillStyle = 'rgba(43,43,46,0.7)';
    ctx.fillText(en, x + w / 2, y + h / 2 + 16);

    // "tap" hint on interactive boxes.
    if (to) {
      ctx.fillStyle = PALETTE.vermilion;
      ctx.beginPath();
      ctx.arc(x + w - 26, y + 26, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── transient cues ──────────────────────────────────────────────────────
  _dolly(ctx, p) {
    // Simple push-in vignette to sell walking through the doorway.
    const { W, H } = DESIGN;
    ctx.fillStyle = `rgba(0,0,0,${1 - p})`;
    ctx.fillRect(0, 0, W, H);
  }
}
