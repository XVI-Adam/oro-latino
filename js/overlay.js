// overlay.js — crisp DOM chrome that reacts to state: route index highlight,
// bilingual scene plate, and the primary action buttons.

import { ROUTE, SCENES } from './config.js';

export class Overlay {
  /**
   * @param {StateMachine} machine
   * @param {(state:string)=>void} onAction  called when an action button fires
   */
  constructor(machine, onAction) {
    this.machine = machine;
    this.onAction = onAction;

    this.routeList = document.getElementById('route-list');
    this.numeral = document.getElementById('scene-numeral');
    this.labelEs = document.getElementById('scene-label-es');
    this.labelEn = document.getElementById('scene-label-en');
    this.actionBar = document.getElementById('action-bar');
    this.caseLabels = document.getElementById('case-labels');
    this._caseEls = new Map();

    this._buildRoute();
    this.update(machine.state);
  }

  /**
   * Build a bilingual label under each interior hit region. Positions are in
   * design pixels — the overlay shares the canvas coordinate space.
   * @param {Array<{id,x,y,w,h,es,en,to}>} hotspots
   */
  setHotspots(hotspots) {
    this.caseLabels.innerHTML = '';
    this._caseEls.clear();
    for (const h of hotspots) {
      const el = document.createElement('div');
      el.className = 'case-label' + (h.to ? ' is-clickable' : '');
      if (h.to) {
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.onAction({ to: h.to }); }
        });
      }
      el.style.left = `${h.x + h.w / 2}px`;
      el.style.top = `${h.y + h.h + 14}px`;
      el.innerHTML = `<span class="es" lang="es">${h.es}</span>
        <span class="dot">·</span>
        <span class="en" lang="en">${h.en}</span>`;
      if (h.to) el.addEventListener('click', () => this.onAction({ to: h.to }));
      this.caseLabels.appendChild(el);
      this._caseEls.set(h.id, el);
    }
  }

  /** Mirror the canvas hover state onto the DOM labels. */
  setHotspotHover(id) {
    for (const [key, el] of this._caseEls) el.classList.toggle('is-hover', key === id);
  }

  /**
   * Fade the in-scene chrome (case labels, hint) while the camera moves — DOM
   * can't be zoomed with the canvas, so crisp labels over a pushing scene read
   * as stuck. 0 = fully visible, 1 = gone.
   */
  setChromeFade(t) {
    const a = String(Math.max(0, 1 - t));
    this.caseLabels.style.opacity = a;
    const hint = this.actionBar.querySelector('.hint');
    if (hint) hint.style.opacity = a;
  }

  _buildRoute() {
    this.routeList.innerHTML = '';
    for (const stop of ROUTE) {
      const li = document.createElement('li');
      li.className = 'route-stop';
      li.dataset.state = stop.state;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', `${stop.num}. ${stop.es}. ${stop.en}.`);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onAction({ to: stop.state }); }
      });
      li.innerHTML = `
        <span class="route-num">${stop.num}</span>
        <span class="route-name">
          <span class="es" lang="es">${stop.es}</span>
          <span class="en" lang="en">${stop.en}</span>
        </span>`;
      li.addEventListener('click', () => this.onAction({ to: stop.state }));
      this.routeList.appendChild(li);
    }
  }

  update(state) {
    const scene = SCENES[state];
    if (!scene) return;
    document.body.dataset.scene = state;   // lets CSS inset chrome per scene

    // Scene plate — restart the numeral animation on every change.
    const changed = this.numeral.textContent !== scene.plate.num;
    this.numeral.textContent = scene.plate.num;
    this.numeral.classList.remove('is-turning');
    void this.numeral.offsetWidth;            // force reflow so it replays
    this.numeral.classList.add('is-turning');
    if (changed) {
      for (const li of this.routeList.children) {
        const n = li.querySelector('.route-num');
        if (n.textContent === scene.plate.num) {
          n.classList.remove('is-turning');
          void n.offsetWidth;
          n.classList.add('is-turning');
        }
      }
    }
    this.labelEs.textContent = scene.plate.es;
    this.labelEn.textContent = scene.plate.en;

    // Route index highlight — match by the plate numeral.
    for (const li of this.routeList.children) {
      li.classList.toggle('is-active', li.querySelector('.route-num').textContent === scene.plate.num);
    }

    // Case labels belong to the interior only.
    this.caseLabels.dataset.show = String(state === 'INTERIOR');
    if (state !== 'INTERIOR') this.setHotspotHover(null);

    // Optional hint (e.g. the gate drag prompt).
    this.actionBar.innerHTML = '';
    if (scene.hint) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.innerHTML = `<span class="arrow">↑</span>
        <span class="es" lang="es">${scene.hint.es}</span>
        <span class="en" lang="en">${scene.hint.en}</span>`;
      this.actionBar.appendChild(hint);
    }

    // Action buttons.
    for (const act of scene.actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action' + (act.primary ? ' action--primary' : '');
      btn.innerHTML = `<span class="es" lang="es">${act.label_es}</span><span class="en" lang="en">${act.label_en}</span>`;
      btn.addEventListener('click', () => this.onAction(act));
      this.actionBar.appendChild(btn);
    }
  }
}
