// attract.js — the idle tour. A ghost cursor walks the whole journey: rolls up
// the gate, pauses on the storefront, steps inside, opens the chain case,
// swings a Cuban link, and opens a piece card.
//
// The tour drives the app *only* by dispatching real PointerEvents into the
// same listeners a person hits — canvas `pointerdown`, window `pointermove`,
// window `pointerup`. It never calls the state machine or the physics directly,
// so the demo can't drift from real behaviour: if a real drag would fail, the
// tour fails identically.
//
// Cancellation uses `event.isTrusted`: events the browser generates from real
// input are trusted, ones from dispatchEvent are not. Any trusted input aborts
// the tour mid-motion, releases a held pointer so nothing is left dragging, and
// hands control back wherever the tour happened to be.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const rand = (a, b) => a + Math.random() * (b - a);

const IDLE_MS = 20000;
const POINTER_ID = 9911;          // stable id for the ghost's synthetic pointer

export class AttractMode {
  /**
   * @param {object} deps { stage, machine, canvas, chainRail, storefront,
   *                        interior, gate, states, reducedMotion }
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.running = false;
    this.cancelled = false;
    this.down = false;
    this.pos = { x: innerWidth / 2, y: innerHeight / 2 };
    this._idleTimer = null;

    this._buildCursor();
    this._paint();            // avoid a first frame parked at 0,0
    this._watchForRealInput();
    this.arm();
  }

  // ── ghost cursor ────────────────────────────────────────────────────────
  _buildCursor() {
    const el = document.createElement('div');
    el.id = 'ghost-cursor';
    el.dataset.show = 'false';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span class="gc-ring"></span><span class="gc-dot"></span>';
    document.body.appendChild(el);
    this.cursor = el;
  }

  _paint() {
    this.cursor.style.transform = `translate(${this.pos.x}px, ${this.pos.y}px)`;
  }

  // ── idle arming ─────────────────────────────────────────────────────────
  arm() {
    clearTimeout(this._idleTimer);
    if (this.reducedMotion?.()) return;   // don't auto-play for reduced motion
    this._idleTimer = setTimeout(() => this.start(), IDLE_MS);
  }

  disarm() { clearTimeout(this._idleTimer); }

  /** Any *trusted* event cancels the tour and restarts the idle countdown. */
  _watchForRealInput() {
    const onReal = (e) => {
      if (!e.isTrusted) return;           // our own synthetic events
      if (this.running) this.cancel();
      this.arm();
    };
    for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) {
      window.addEventListener(type, onReal, { capture: true, passive: true });
    }
  }

  // ── synthetic pointer plumbing ──────────────────────────────────────────
  _event(type, target, extra = {}) {
    const ev = new PointerEvent(type, {
      pointerId: POINTER_ID,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: this.pos.x,
      clientY: this.pos.y,
      bubbles: true,
      cancelable: true,
      composed: true,
      ...extra,
    });
    target.dispatchEvent(ev);
  }

  // The same three targets main.js listens on — nothing bypasses the pipeline.
  _move() { this._event('pointermove', window, { buttons: this.down ? 1 : 0 }); }
  _press() {
    this.down = true;
    this.cursor.dataset.down = 'true';
    this._event('pointerdown', this.canvas, { button: 0, buttons: 1 });
  }
  _release() {
    if (!this.down) return;
    this.down = false;
    this.cursor.dataset.down = 'false';
    this._event('pointerup', window, { button: 0, buttons: 0 });
  }

  // ── motion ──────────────────────────────────────────────────────────────
  /**
   * Frame-driven wait. Deliberately not setTimeout: the whole tour is paced by
   * rAF, so when the tab is backgrounded the script freezes with the rendering
   * instead of racing ahead and desyncing from the physics it is driving.
   */
  _sleep(ms) {
    return new Promise((resolve) => {
      let acc = 0;
      let last = performance.now();
      const step = (now) => {
        if (this.cancelled) { resolve(); return; }
        acc += Math.min(now - last, 40);
        last = now;
        if (acc >= ms) { resolve(); return; }
        this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    });
  }

  /**
   * Glide to a design-space point. Human-imperfect: an eased ramp, a slight
   * perpendicular arc, a small overshoot that settles back, and per-frame
   * jitter — so it never looks like a linear tween.
   */
  moveTo(dx, dy, { speed = 1, overshoot = true } = {}) {
    const to = this.stage.toClient(dx, dy);
    const from = { ...this.pos };
    const vx = to.x - from.x, vy = to.y - from.y;
    const dist = Math.hypot(vx, vy);
    if (dist < 0.5) return Promise.resolve();

    const dur = clamp(260 + dist * 1.15, 300, 1400) / speed * rand(0.88, 1.14);
    // arc perpendicular to travel, so the path bows like a wrist movement
    const nx = -vy / (dist || 1), ny = vx / (dist || 1);
    const bow = rand(-0.09, 0.09) * dist;
    const over = overshoot ? rand(0.012, 0.035) : 0;
    const jit = clamp(dist * 0.012, 0.4, 2.2);
    const phase = rand(0, Math.PI * 2);

    return new Promise((resolve) => {
      // Accumulate *clamped* frame deltas rather than reading the wall clock:
      // if rAF pauses (background tab), the glide pauses with it instead of
      // teleporting to the end — which would hand the physics a single huge
      // jump and skip the intermediate pointermoves it needs.
      let acc = 0;
      let last = performance.now();
      const step = (now) => {
        if (this.cancelled) { resolve(); return; }
        acc += Math.min(now - last, 40);
        last = now;
        const u = clamp(acc / dur, 0, 1);
        const e = easeInOutCubic(u);
        // overshoot then settle over the last third of the move
        const push = 1 + over * Math.sin(Math.PI * clamp((u - 0.62) / 0.38, 0, 1));
        const arc = Math.sin(Math.PI * u) * bow;
        this.pos.x = from.x + vx * e * push + nx * arc + Math.sin(now * 0.013 + phase) * jit;
        this.pos.y = from.y + vy * e * push + ny * arc + Math.cos(now * 0.011 + phase) * jit;
        this._paint();
        this._move();
        if (u >= 1) { resolve(); return; }
        this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    });
  }

  /** Press, glide through the given design-space points, release. */
  async drag(points, opts = {}) {
    this._press();
    await this._sleep(rand(70, 140));           // the beat before pulling
    for (const p of points) {
      if (this.cancelled) break;
      await this.moveTo(p[0], p[1], { overshoot: false, ...opts });
    }
    if (!this.cancelled) await this._sleep(rand(50, 120));
    this._release();
  }

  /** Aim, hesitate a beat like a person, then click. */
  async click(dx, dy) {
    await this.moveTo(dx, dy);
    if (this.cancelled) return;
    await this._sleep(rand(140, 280));
    this._press();
    await this._sleep(rand(55, 110));
    this._release();
  }

  /** Wait until the machine reaches `state`, or give up. */
  async waitFor(state, timeout = 5000) {
    let waited = 0;
    while (!this.cancelled && this.machine.state !== state) {
      if (waited > timeout) return false;
      await this._sleep(60);
      waited += 60;              // frame-paced, so a hidden tab can't time out
    }
    return !this.cancelled;
  }

  // ── the tour ────────────────────────────────────────────────────────────
  async start() {
    if (this.running) return;
    this.disarm();
    this.running = true;
    this.cancelled = false;
    document.body.classList.add('is-attract');
    this.cursor.dataset.show = 'true';

    try {
      await this._script();
    } catch (err) {
      if (!this.cancelled) console.warn('[attract] tour aborted:', err);
    }

    this._release();
    this.running = false;
    this.cursor.dataset.show = 'false';
    document.body.classList.remove('is-attract');
    if (!this.cancelled) this.arm();
  }

  cancel() {
    if (!this.running) return;
    this.cancelled = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._release();                     // never leave the app mid-drag
    this.cursor.dataset.show = 'false';
    document.body.classList.remove('is-attract');
    this.running = false;
  }

  async _script() {
    const S = this.states;
    const G = this.gate.rect;

    // start from the top of the route
    this.machine.go(S.GATE_CLOSED);
    await this._sleep(500);
    if (this.cancelled) return;

    // park the cursor off to the side, then drift in
    this.pos = this.stage.toClient(G.x + G.w * 0.5, G.y + G.h + 90);
    this._paint();

    // 1 — roll the gate up past its tipping point
    const gx = G.x + G.w * 0.5;
    await this.moveTo(gx, G.y + G.h * 0.78);
    if (this.cancelled) return;
    await this._sleep(320);
    await this.drag([
      [gx, G.y + G.h * 0.55],
      [gx + 12, G.y + G.h * 0.30],
      [gx - 6, G.y + G.h * 0.06],
      [gx, G.y - 40],
    ], { speed: 0.72 });
    if (!(await this.waitFor(S.STOREFRONT, 6000))) return;

    // 2 — pause and take in the window
    await this._sleep(900);
    await this.moveTo(G.x + G.w * 0.34, G.y + G.h * 0.55, { speed: 0.8 });
    await this._sleep(700);
    if (this.cancelled) return;

    // 3 — pull the door open and step inside
    const d = this.storefront.door;
    await this.moveTo(d.x + 14, d.y + d.h * 0.5);
    await this._sleep(260);
    await this.drag([
      [d.x - 60, d.y + d.h * 0.5],
      [d.x - 150, d.y + d.h * 0.52],
      [d.x - 240, d.y + d.h * 0.5],
    ], { speed: 0.8 });
    if (!(await this.waitFor(S.INTERIOR, 7000))) return;

    // 4 — look around, then open the chain case
    await this._sleep(800);
    const rack = this.interior.hotspots.find((h) => h.to);
    await this.click(rack.x + rack.w * 0.5, rack.y + rack.h * 0.55);
    if (!(await this.waitFor(S.CASE_FOCUS, 6000))) return;
    await this._sleep(700);

    // 5 — swing a Cuban link
    const cuban = this.chainRail.chains.find((c) => c.style === 'cuban') || this.chainRail.chains[0];
    const grab = cuban.particles[Math.max(1, Math.floor(cuban.pendant * 0.7))];
    await this.moveTo(grab.x, grab.y);
    await this._sleep(240);
    await this.drag([
      [grab.x + 150, grab.y + 40],
      [grab.x - 130, grab.y + 90],
      [grab.x + 90, grab.y + 30],
    ], { speed: 1.15 });
    if (this.cancelled) return;
    await this._sleep(1200);

    // 6 — open a piece card by its price tag
    const withTag = this.chainRail.chains.find((c) => c.tag && c.piece) || cuban;
    const tag = withTag.tag.parts[1];
    await this.click(tag.x, tag.y);
    if (!(await this.waitFor(S.PIECE_DETAIL, 5000))) return;
    await this._sleep(3200);
  }
}
