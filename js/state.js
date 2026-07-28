// state.js — the central state machine.
// Holds the current state, fires change events, and auto-advances transient
// states (GATE_OPENING, ENTERING) after their configured duration.

import { STATES, STATE_ORDER, TRANSIENTS } from './config.js';

export class StateMachine {
  constructor(initial = STATES.GATE_CLOSED) {
    this.state = initial;
    this._listeners = new Set();
    this._timer = null;
    // progress 0→1 through a transient state (for animated transitions later)
    this.transition = { active: false, from: null, to: null, t: 0, start: 0, duration: 0 };
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(prev) {
    for (const fn of this._listeners) fn(this.state, prev);
  }

  /** Move to a new state. Ignores unknown states; schedules transient advance. */
  go(next) {
    if (!STATE_ORDER.includes(next)) {
      console.warn(`[state] unknown state: ${next}`);
      return;
    }
    const prev = this.state;
    this.state = next;

    if (this._timer) { clearTimeout(this._timer); this._timer = null; }

    const t = TRANSIENTS[next];
    if (t) {
      this.transition = { active: true, from: prev, to: t.next, t: 0, start: performance.now(), duration: t.duration };
      this._timer = setTimeout(() => {
        this._timer = null;
        this.transition.active = false;
        this.go(t.next);
      }, t.duration);
    } else {
      this.transition.active = false;
    }

    this._emit(prev);
  }

  /** 0→1 progress through the active transient state (else 0). */
  transitionProgress(now = performance.now()) {
    if (!this.transition.active || !this.transition.duration) return 0;
    return Math.min(1, (now - this.transition.start) / this.transition.duration);
  }
}
