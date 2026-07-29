// storefront.js — 00 · La Vitrina. The layered nighttime storefront:
//   · black fascia sign — gold "ORO LATINO INC.", white phone, rayed diamond mark
//   · display window — live chain rail up top (the same Verlet sim, smaller),
//     ring trays / navy stone tray / bangle cluster below (procedural
//     placeholders sized for later photo cutouts)
//   · night atmosphere — dark surround, warm light spilling from the window,
//     a translucent gradient sweep as the street's reflection on the glass
//   · a glass door on the right whose edge can be dragged (or the wheel
//     scrolled) to swing it open — past the tipping point it commits and
//     fires onEnter (→ ENTERING → INTERIOR)
//
// draw() takes a `reveal` factor (0..1): while the security gate is still
// rising the window's glow, displays, and sidewalk spill scale with it.

import { DESIGN, PALETTE } from './config.js';
import { Layer } from './layer.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const DOOR_W = 250;
const DOOR_TIP = 0.45;   // release past this and the door commits to opening

export class Storefront {
  /**
   * @param {{x,y,w,h}} rect     the window opening (the gate's rect)
   * @param {ChainRail} chains   small chain rail living in the window
   * @param {Jewelry} jewelry    procedural jewelry renderer (trays/bangles)
   * @param {() => void} onEnter fired once when the door swings fully open
   */
  constructor(rect, chains, jewelry, onEnter) {
    this.rect = rect;
    this.chains = chains;
    this.jewelry = jewelry;
    this.onEnter = onEnter || (() => {});

    this.door = { x: rect.x + rect.w - DOOR_W, y: rect.y, w: DOOR_W, h: rect.h };
    this.doorPos = 0;       // 0 closed → 1 open
    this.doorVel = 0;
    this.draggingDoor = false;
    this._sx = 0; this._sp = 0; this._target = 0;
    this.entered = false;

    // Static content (sign, window interior, trays, frame) baked once at full
    // brightness; the gate's `reveal` is applied as a dynamic dim on top.
    this.bg = new Layer();

    this._layout();
  }

  reset() {
    this.doorPos = 0;
    this.doorVel = 0;
    this.draggingDoor = false;
    this.entered = false;
  }

  // ── door input ──────────────────────────────────────────────────────────
  hitDoor(x, y) {
    const d = this.door;
    return x >= d.x - 16 && x <= d.x + d.w + 16 && y >= d.y && y <= d.y + d.h;
  }

  doorDown(x) {
    if (this.entered) return;
    this.draggingDoor = true;
    this._sx = x;
    this._sp = this.doorPos;
    this._target = this.doorPos;
  }

  doorMove(x) {
    if (!this.draggingDoor) return;
    // pull the edge left (into the shop) to swing it open
    this._target = clamp(this._sp + (this._sx - x) / (this.door.w * 0.9), 0, 1.05);
  }

  doorUp() { this.draggingDoor = false; }

  wheel(deltaY) {
    if (this.entered) return;
    this.doorVel = clamp(this.doorVel + Math.abs(deltaY) * 0.0075, -4, 4);
  }

  // ── simulation ──────────────────────────────────────────────────────────
  update(dt) {
    dt = Math.min(dt, 1 / 30);
    this.chains.update(dt);
    if (this.entered) return;

    let F = 9 * (this.doorPos - DOOR_TIP);            // closed attractor ⇄ open assist
    if (this.draggingDoor) F += 26 * (this._target - this.doorPos);
    F -= 4 * this.doorVel;
    this.doorVel += F * dt;
    this.doorPos += this.doorVel * dt;

    if (this.doorPos <= 0) {
      this.doorPos = 0;
      this.doorVel = this.doorVel < 0 ? -this.doorVel * 0.3 : this.doorVel;
    }
    if (this.doorPos >= 1) {
      this.doorPos = 1;
      this.doorVel = 0;
      this.entered = true;
      this.onEnter();
    }
  }

  // ── rendering ───────────────────────────────────────────────────────────
  draw(ctx, now, reveal = 1, dpr = 1) {
    // bake the static scene once
    if (this.bg.ensure(dpr)) {
      const c = this.bg.begin();
      this._sign(c);
      this._windowInterior(c, 1);
      this._displays(c);
      this._frame(c);
      this.bg.done();
    }
    this.bg.blit(ctx);

    // the gate is still down → dim the window rather than re-baking it
    if (reveal < 0.995) {
      const { x, y, w, h } = this.rect;
      ctx.fillStyle = `rgba(0,0,0,${(1 - reveal) * 0.62})`;
      ctx.fillRect(x, y, w, h);
    }

    if (reveal > 0.01) {
      this.chains.draw(ctx, now);
      this._door(ctx, now);
      this._glass(ctx, now, reveal);
    }
    this._spill(ctx, reveal);
  }

  // fascia sign: gold name + white phone + rayed diamond mark
  _sign(ctx) {
    const { x, w } = this.rect;
    const y0 = 26, h = 114, cy = y0 + h / 2;

    ctx.fillStyle = PALETTE.black;
    ctx.fillRect(x - 14, y0, w + 28, h);
    ctx.strokeStyle = 'rgba(212,175,55,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 13, y0 + 1, w + 26, h - 2);

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const name = 'ORO LATINO INC.';
    ctx.font = '800 58px "Avenir Next Condensed", Futura, "Trebuchet MS", sans-serif';
    try { ctx.letterSpacing = '7px'; } catch { /* older engines */ }
    const nw = ctx.measureText(name).width;
    const markR = 34, gap = 30;
    const sx = x + w / 2 - (markR * 2 + gap + nw) / 2;

    this._mark(ctx, sx + markR, cy);

    const tx = sx + markR * 2 + gap;
    ctx.fillStyle = PALETTE.gold;
    ctx.fillText(name, tx, cy - 14);
    ctx.font = '500 27px ui-monospace, "SF Mono", Menlo, monospace';
    try { ctx.letterSpacing = '5px'; } catch { /* older engines */ }
    ctx.fillStyle = '#EDEDED';
    ctx.fillText('212-925-1538', tx + 4, cy + 32);
    try { ctx.letterSpacing = '0px'; } catch { /* older engines */ }
    ctx.restore();
  }

  // the logo's rayed diamond
  _mark(ctx, cx, cy) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = 22, r1 = i % 3 === 0 ? 36 : 30;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = PALETTE.vermilion;
    ctx.fillRect(-13, -13, 26, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(-13, -13, 13, 13);
    ctx.restore();
  }

  _windowInterior(ctx, reveal) {
    const { x, y, w, h } = this.rect;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#241b10');
    g.addColorStop(1, '#120d07');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    // warm downlight glow from inside the case
    const a = (0.15 + 0.85 * reveal) * 0.22;
    const glow = ctx.createRadialGradient(x + w * 0.45, y + h * 0.16, 60, x + w * 0.45, y + h * 0.16, w * 0.55);
    glow.addColorStop(0, `rgba(255,196,120,${a})`);
    glow.addColorStop(1, 'rgba(255,196,120,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, w, h);
  }

  // static layout for the lower-region displays
  _layout() {
    const { x, y, h } = this.rect;
    const top = y + h - 320;             // lower display region
    this.trays = [];
    const tw = 176, th = 128, gx = 22, gy = 30;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        this.trays.push({
          x: x + 46 + c * (tw + gx),
          y: top + r * (th + gy),
          w: tw, h: th,
          shade: (r + c) % 2 === 0 ? 'black' : 'cream',
        });
      }
    }
    this.navyTray = { x: x + 46 + 4 * (tw + gx) + 14, y: top, w: 270, h: th * 2 + gy };
    // front-center, overlapping the tray rows' lower edge but inside the glass
    this.banglesAt = { x: x + 46 + tw + gx + 30, y: top + 2 * th + gy + 8 };
  }

  _displays(ctx) {
    const J = this.jewelry;

    for (const t of this.trays) {
      this._trayBase(ctx, t.x, t.y, t.w, t.h, t.shade);
      const dark = t.shade === 'black';
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 3; c++) {
          J.ring(ctx, t.x + 34 + c * 54, t.y + 36 + r * 56, 15,
            { gauge: 0.85, gem: dark, gemColor: '#E23A2E', ao: true });
        }
      }
    }

    // navy tray with green / red stone pieces
    const n = this.navyTray;
    this._trayBase(ctx, n.x, n.y, n.w, n.h, 'navy');
    let k = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        J.ring(ctx, n.x + 46 + c * 88, n.y + 48 + r * 94, 19,
          { gauge: 1, gem: true, gemColor: k++ % 2 === 0 ? '#1FA55A' : PALETTE.vermilion, ao: true });
      }
    }

    // bangle cluster front-center
    const b = this.banglesAt;
    for (let i = 0; i < 6; i++) {
      J.bangle(ctx, b.x + i * 52 - 30, b.y + (i % 2) * 10, 52, 20, { gauge: 0.9, ao: true });
    }
  }

  _trayBase(ctx, x, y, w, h, shade) {
    const fills = {
      black: ['#15161a', 'rgba(255,255,255,0.07)'],
      cream: ['#E7DCC2', 'rgba(90,70,30,0.35)'],
      navy: [PALETTE.felt, 'rgba(255,255,255,0.10)'],
    };
    const [base, edge] = fills[shade];
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 4, y + 6, w, h);            // drop shadow
    ctx.fillStyle = base;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.strokeStyle = shade === 'cream' ? 'rgba(90,70,30,0.2)' : 'rgba(255,255,255,0.05)';
    ctx.strokeRect(x + 9, y + 9, w - 18, h - 18); // inner slot line
  }

  // the glass entry door (hinged at its right frame; drag the edge left)
  _door(ctx, now) {
    const d = this.door;

    // dark warm opening behind the door
    const g = ctx.createLinearGradient(0, d.y, 0, d.y + d.h);
    g.addColorStop(0, '#1a1209');
    g.addColorStop(1, '#0a0704');
    ctx.fillStyle = g;
    ctx.fillRect(d.x, d.y, d.w, d.h);
    const glow = ctx.createRadialGradient(d.x + d.w / 2, d.y + d.h * 0.5, 20, d.x + d.w / 2, d.y + d.h * 0.5, d.w);
    glow.addColorStop(0, 'rgba(255,180,95,0.10)');
    glow.addColorStop(1, 'rgba(255,180,95,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(d.x, d.y, d.w, d.h);

    // swinging panel: width shrinks toward the right-hand hinge
    const pw = d.w * (1 - this.doorPos * 0.86);
    const px = d.x + d.w - pw;
    ctx.fillStyle = 'rgba(170,195,220,0.10)';                  // glass
    ctx.fillRect(px, d.y, pw, d.h);
    ctx.strokeStyle = '#0e0f12';
    ctx.lineWidth = 8;
    ctx.strokeRect(px + 4, d.y + 4, pw - 8, d.h - 8);          // door frame
    ctx.strokeStyle = 'rgba(212,175,55,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 9, d.y + 9, pw - 18, d.h - 18);

    // push-bar handle near the leading edge
    if (pw > 46) {
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(px + 18, d.y + d.h * 0.42, 10, d.h * 0.16);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(px + 18, d.y + d.h * 0.42, 3, d.h * 0.16);
    }

    // pulsing edge affordance while the door is shut
    if (this.doorPos < 0.05 && !this.entered) {
      ctx.fillStyle = `rgba(212,175,55,${0.22 + 0.14 * Math.sin(now * 0.004)})`;
      ctx.fillRect(px - 2, d.y + 8, 5, d.h - 16);
    }
  }

  // street reflected on the glass — translucent gradient sweep, slowly drifting
  _glass(ctx, now, reveal) {
    if (reveal < 0.05) return;
    const { x, y, w, h } = this.rect;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    const c = 0.28 + 0.08 * Math.sin(now * 0.00022);
    const g = ctx.createLinearGradient(x, y, x + w, y + h * 0.7);
    const a1 = 0.055 * reveal, a2 = 0.03 * reveal;
    g.addColorStop(clamp(c - 0.13, 0, 1), 'rgba(255,255,255,0)');
    g.addColorStop(clamp(c, 0, 1), `rgba(255,255,255,${a1})`);
    g.addColorStop(clamp(c + 0.13, 0, 1), 'rgba(255,255,255,0)');
    g.addColorStop(clamp(c + 0.30, 0, 1), 'rgba(255,255,255,0)');
    g.addColorStop(clamp(c + 0.38, 0, 1), `rgba(255,255,255,${a2})`);
    g.addColorStop(clamp(c + 0.46, 0, 1), 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  _frame(ctx) {
    const { x, y, w, h } = this.rect;
    ctx.strokeStyle = '#0e0f12';
    ctx.lineWidth = 14;
    ctx.strokeRect(x - 7, y - 7, w + 14, h + 14);
    ctx.strokeStyle = 'rgba(212,175,55,0.28)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  }

  // warm pool on the sidewalk below the window
  _spill(ctx, reveal) {
    const { x, y, w, h } = this.rect;
    const by = y + h + 7;
    const a = (0.1 + 0.9 * reveal) * 0.16;
    const g = ctx.createRadialGradient(x + w / 2, by, 30, x + w / 2, by, w * 0.62);
    g.addColorStop(0, `rgba(255,196,120,${a})`);
    g.addColorStop(1, 'rgba(255,196,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 120, by, w + 240, DESIGN.H - by);
  }
}
