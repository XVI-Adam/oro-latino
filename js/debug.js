// debug.js — dev-only panel to jump directly to any state.

import { STATE_ORDER } from './config.js';

export class DebugPanel {
  /**
   * @param {StateMachine} machine
   * @param {(state:string)=>void} onJump
   */
  constructor(machine, onJump) {
    this.machine = machine;
    this.onJump = onJump;

    this.panel = document.getElementById('debug-panel');
    this.current = document.getElementById('debug-current');
    this.list = document.getElementById('debug-states');
    this.toggle = document.getElementById('debug-toggle');

    this._build();

    this.toggle.addEventListener('click', () => {
      const open = this.panel.dataset.open === 'true';
      this.panel.dataset.open = String(!open);
      this.toggle.textContent = open ? '+' : '–';
    });

    machine.onChange((state) => this.update(state));
    this.update(machine.state);
  }

  _build() {
    this.list.innerHTML = '';
    this.buttons = {};
    for (const s of STATE_ORDER) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'debug-state-btn';
      b.textContent = s;
      b.addEventListener('click', () => this.onJump(s));
      this.list.appendChild(b);
      this.buttons[s] = b;
    }
  }

  update(state) {
    this.current.textContent = state;
    for (const [s, b] of Object.entries(this.buttons)) {
      b.classList.toggle('is-current', s === state);
    }
  }
}
