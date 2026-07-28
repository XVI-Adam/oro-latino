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

    this._buildRoute();
    this.update(machine.state);
  }

  _buildRoute() {
    this.routeList.innerHTML = '';
    for (const stop of ROUTE) {
      const li = document.createElement('li');
      li.className = 'route-stop';
      li.dataset.state = stop.state;
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

    // Scene plate.
    this.numeral.textContent = scene.plate.num;
    this.labelEs.textContent = scene.plate.es;
    this.labelEn.textContent = scene.plate.en;

    // Route index highlight — match by the plate numeral.
    for (const li of this.routeList.children) {
      li.classList.toggle('is-active', li.querySelector('.route-num').textContent === scene.plate.num);
    }

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
