// a11y.js — keyboard and screen-reader access to the whole experience.
//
// Nothing essential is behind a drag gesture: every state transition has a
// keyboard path, and every piece in the case exists as a real focusable button
// in a parallel DOM list carrying the same bilingual copy the canvas shows.
//
//   Enter / Space  open the gate · step inside · open the focused case or piece
//   ← / →          move between wall cases, or between pieces on the rail
//   ↑ / ↓          walk the route (storefront → interior → case → piece)
//   Escape         back out one step
//
// A polite live region narrates each move so screen-reader users know where
// they are without seeing the canvas.

import { STATES } from './config.js';

export class Accessibility {
  /**
   * @param {object} deps { machine, chainRail, interior, inventory, actions }
   */
  constructor({ machine, chainRail, interior, inventory, actions }) {
    this.machine = machine;
    this.chainRail = chainRail;
    this.interior = interior;
    this.inventory = inventory;
    this.actions = actions;          // { openGate, enterShop, openCase, openPiece, back }

    this.caseIndex = 0;              // focused wall case in the interior
    this.pieceIndex = 0;             // focused chain on the rail

    this._buildLiveRegion();
    this._buildPieceList();
    this._buildCaseList();
    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  // ── announcements ───────────────────────────────────────────────────────
  _buildLiveRegion() {
    const el = document.createElement('p');
    el.id = 'a11y-live';
    el.className = 'sr-only';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
    this.live = el;
  }

  say(text) {
    // re-set to force repeat announcements of the same string
    this.live.textContent = '';
    window.setTimeout(() => { this.live.textContent = text; }, 30);
  }

  // ── parallel list: every piece, same bilingual copy as the canvas ───────
  _buildPieceList() {
    const wrap = document.createElement('nav');
    wrap.id = 'piece-list';
    wrap.className = 'sr-list';
    wrap.setAttribute('aria-label', 'Cadenas disponibles / Available chains');

    const ul = document.createElement('ul');
    this.pieceButtons = [];

    this.inventory.pieces.forEach((p, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const price = p.price || `${this.inventory.copy.ask_es} / ${this.inventory.copy.ask_en}`;
      b.innerHTML =
        `<span lang="es">${p.name_es}</span> · <span lang="en">${p.name_en}</span> — ` +
        `<span lang="es">${p.chain_es}</span> / <span lang="en">${p.chain_en}</span>, ` +
        `${p.karat}, ${p.gauge_mm} mm, ${p.length_es} / ${p.length_en}. ${price}.`;
      b.addEventListener('focus', () => {
        this.pieceIndex = i;
        this.chainRail.setKeyboardFocus(i);
      });
      b.addEventListener('click', () => this.actions.openPiece(i));
      li.appendChild(b);
      ul.appendChild(li);
      this.pieceButtons.push(b);
    });

    wrap.appendChild(ul);
    document.body.appendChild(wrap);
  }

  // ── parallel list: the interior's cases ─────────────────────────────────
  _buildCaseList() {
    const wrap = document.createElement('nav');
    wrap.id = 'case-list';
    wrap.className = 'sr-list';
    wrap.setAttribute('aria-label', 'Vitrinas / Display cases');
    const ul = document.createElement('ul');
    this.caseButtons = [];

    this.interior.hotspots.forEach((h, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span lang="es">${h.es}</span> · <span lang="en">${h.en}</span>`;
      b.addEventListener('focus', () => { this.caseIndex = i; this.interior.keyFocus = h.id; });
      b.addEventListener('click', () => this.actions.openCase(i));
      li.appendChild(b);
      ul.appendChild(li);
      this.caseButtons.push(b);
    });

    wrap.appendChild(ul);
    document.body.appendChild(wrap);
  }

  /** Keep the visible list in step with the current scene. */
  syncTo(state) {
    document.getElementById('piece-list').dataset.active =
      String(state === STATES.CASE_FOCUS || state === STATES.PIECE_DETAIL);
    document.getElementById('case-list').dataset.active = String(state === STATES.INTERIOR);
    if (state !== STATES.INTERIOR) this.interior.keyFocus = null;
    if (state !== STATES.CASE_FOCUS && state !== STATES.PIECE_DETAIL) {
      this.chainRail.setKeyboardFocus(-1);
    }
  }

  // ── keyboard ────────────────────────────────────────────────────────────
  _onKey(e) {
    // let the browser handle typing and modified shortcuts
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';
    if (typing) return;

    const s = this.machine.state;
    const key = e.key;

    if (key === 'Escape') {
      if (this.actions.back()) e.preventDefault();
      return;
    }

    if (key === 'Enter' || key === ' ') {
      // A focused button handles its own activation.
      if (tag === 'BUTTON' || tag === 'A') return;
      e.preventDefault();
      this._activate(s);
      return;
    }

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const dir = key === 'ArrowRight' ? 1 : -1;
      if (s === STATES.INTERIOR) { e.preventDefault(); this._moveCase(dir); }
      else if (s === STATES.CASE_FOCUS) { e.preventDefault(); this._movePiece(dir); }
      return;
    }

    if (key === 'ArrowUp' || key === 'ArrowDown') {
      // ↑ walks deeper into the shop, ↓ backs out — matches the route index.
      e.preventDefault();
      if (key === 'ArrowUp') this._activate(s);
      else this.actions.back();
    }
  }

  _activate(state) {
    switch (state) {
      case STATES.GATE_CLOSED:
      case STATES.GATE_OPENING:
        this.actions.openGate();
        this.say('Abriendo la reja. Opening the gate.');
        break;
      case STATES.STOREFRONT:
        this.actions.enterShop();
        this.say('Entrando. Stepping inside.');
        break;
      case STATES.INTERIOR:
        this.actions.openCase(this.caseIndex);
        break;
      case STATES.CASE_FOCUS:
        this.actions.openPiece(this.pieceIndex);
        break;
      default:
        break;
    }
  }

  _moveCase(dir) {
    const n = this.interior.hotspots.length;
    this.caseIndex = (this.caseIndex + dir + n) % n;
    const h = this.interior.hotspots[this.caseIndex];
    this.interior.keyFocus = h.id;
    this.caseButtons[this.caseIndex].focus();
    this.say(`${h.es}. ${h.en}.`);
  }

  _movePiece(dir) {
    const n = this.inventory.pieces.length;
    this.pieceIndex = (this.pieceIndex + dir + n) % n;
    const p = this.inventory.pieces[this.pieceIndex];
    this.chainRail.setKeyboardFocus(this.pieceIndex);
    this.pieceButtons[this.pieceIndex].focus();
    this.say(`${p.name_es}. ${p.name_en}. ${p.price || this.inventory.copy.ask_en}.`);
  }
}
