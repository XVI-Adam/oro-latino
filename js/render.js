// render.js — canvas draw loop. Paints the backdrop for the current state and
// a labeled gray-box placeholder for every scene element. No assets yet.

import { DESIGN, PALETTE, SCENES, STATES } from './config.js';
import { Camera } from './camera.js';

export class Renderer {
  /**
   * @param {Stage} stage
   * @param {StateMachine} machine
   * @param {() => string|null} getHover  id of hovered interactive box, or null
   */
  constructor(stage, machine, getHover, gate, chainRail, storefront, interior) {
    this.stage = stage;
    this.machine = machine;
    this.getHover = getHover;
    this.gate = gate;
    this.chainRail = chainRail;
    this.storefront = storefront;
    this.interior = interior;
    this.camera = new Camera();
    this._raf = null;
    this._last = 0;
    this._loop = this._loop.bind(this);
  }

  /**
   * Push-in through the door. Runs for the whole ENTERING transient, so the
   * dolly lands exactly as the state machine hands over to INTERIOR.
   */
  beginDolly(durationMs = 1100) {
    const d = this.storefront ? this.storefront.door : null;
    const focus = d
      ? { x: d.x + d.w / 2, y: d.y + d.h * 0.5 }
      : { x: DESIGN.W / 2, y: DESIGN.H / 2 };
    this.camera.start('dolly', durationMs, focus);
  }

  /** Smooth zoom toward a clicked case; `onDone` commits the state change. */
  beginCaseZoom(hotspot, onDone, durationMs = 620) {
    this.zoomRect = { x: hotspot.x, y: hotspot.y, w: hotspot.w, h: hotspot.h };
    this.camera.start('zoom', durationMs,
      { x: hotspot.x + hotspot.w / 2, y: hotspot.y + hotspot.h / 2 }, onDone);
  }

  start() { if (!this._raf) this._raf = requestAnimationFrame(this._loop); }
  stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }

  _loop(now) {
    const dt = this._last ? (now - this._last) / 1000 : 0;
    this._last = now;
    if (this.gate && this._isGateState()) this.gate.update(dt);
    if (this.chainRail &&
        (this.machine.state === STATES.CASE_FOCUS || this.machine.state === STATES.PIECE_DETAIL)) {
      this.chainRail.update(dt);
    }
    if (this.storefront && this.machine.state === STATES.STOREFRONT) this.storefront.update(dt);
    this.camera.update(dt);
    if (this.onCamera) {
      // ramp the chrome out fast at the start of a move, back in when it ends
      this.onCamera(this.camera.active ? Math.min(1, this.camera.u * 3) : 0);
    }
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

    const state = this.machine.state;
    const dpr = this.stage.dpr;
    const cam = this.camera;
    this._backdrop(ctx, scene.backdrop);

    if (state === STATES.STOREFRONT && this.storefront) {
      // A zoom out of the storefront never happens, so this is the plain view —
      // unless a case zoom is mid-flight (see INTERIOR below).
      this.storefront.draw(ctx, now, 1, dpr);
    }

    // ── storefront → interior: push-in dolly with layer parallax ──────────
    if (state === STATES.ENTERING && this.interior) {
      const p = cam.kind === 'dolly' ? cam.p : this.machine.transitionProgress(now);
      // The room comes forward from behind, nearer layers growing faster.
      this.interior.draw(ctx, now, null, dpr, {
        scale: 0.84 + 0.16 * p,
        parallax: 0.16 * (1 - p),
        focus: cam.focus,
      });
      // We pass through the storefront: it scales up past us and fades out.
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p * 1.25);
      cam.applyLayer(ctx, 1 + 1.7 * p);
      if (this.storefront) this.storefront.draw(ctx, now, 1, dpr);
      ctx.restore();
    }

    // ── interior (steady, or zooming toward a case) ───────────────────────
    if (state === STATES.INTERIOR && this.interior) {
      const zooming = cam.kind === 'zoom';
      const p = zooming ? cam.p : 0;
      this.interior.draw(ctx, now, zooming ? null : (this.getHover ? this.getHover() : null), dpr, {
        scale: 1 + 1.9 * p,
        parallax: 0.28 * p,          // the counter rushes past faster than the wall
        focus: cam.focus,
        blur: 11 * p,
        darken: 0.62 * p,
        focusRect: this.zoomRect,
      });
    }

    // The lifted chain sits over the dimmed case it came from.
    if (state === STATES.PIECE_DETAIL && this.chainRail) {
      this.chainRail.draw(ctx, now);
      this.chainRail.drawFocused(ctx, now);
    }

    if (state === STATES.CASE_FOCUS && this.chainRail) {
      this.chainRail.draw(ctx, now);
      // land the zoom: the case settles back from a slight overshoot
      if (cam.kind === 'zoom') {
        const q = 1 - cam.p;
        ctx.save();
        ctx.globalAlpha = Math.min(1, cam.p * 2);
        cam.applyLayer(ctx, 1 + 0.12 * q);
        ctx.restore();
      }
    }

    const hover = this.getHover ? this.getHover() : null;
    for (const box of scene.boxes) {
      this._box(ctx, box, box.id === hover);
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
    // Reveal-behind: the real storefront, its glow scaling with the gate.
    if (this.storefront) this.storefront.draw(ctx, now, this.gate.pos, this.stage.dpr);

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

}
