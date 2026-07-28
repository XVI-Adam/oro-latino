// chaintuner.js — a small DOM panel of sliders for the live chain-physics
// parameters. Shown while the chain debug view ('D') is on.

const CONTROLS = [
  { key: 'damping',        label: 'damping',       min: 0.90, max: 0.999, step: 0.001, fmt: (v) => v.toFixed(3) },
  { key: 'settleSpring',   label: 'settle spring', min: 0,    max: 120,   step: 1,     fmt: (v) => v.toFixed(0) },
  { key: 'sleepThreshold', label: 'sleep thresh',  min: 0.005, max: 0.5,  step: 0.005, fmt: (v) => v.toFixed(3) },
  { key: 'laneWidth',      label: 'lane width',    min: 20,   max: 200,   step: 1,     fmt: (v) => v.toFixed(0) },
  { key: 'cursorForce',    label: 'cursor push',   min: 0,    max: 4000,  step: 50,    fmt: (v) => v.toFixed(0) },
  { key: 'cursorRadius',   label: 'cursor radius', min: 40,   max: 320,   step: 5,     fmt: (v) => v.toFixed(0) },
];

export function buildChainTuner(params) {
  const panel = document.createElement('aside');
  panel.id = 'chain-tuner';
  panel.innerHTML = '<div class="ct-title">CHAIN PHYSICS</div>';

  for (const ctl of CONTROLS) {
    const row = document.createElement('label');
    row.className = 'ct-row';
    const name = document.createElement('span');
    name.className = 'ct-name';
    name.textContent = ctl.label;
    const val = document.createElement('span');
    val.className = 'ct-val';
    val.textContent = ctl.fmt(params[ctl.key]);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = ctl.min; input.max = ctl.max; input.step = ctl.step;
    input.value = params[ctl.key];
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      params[ctl.key] = v;
      val.textContent = ctl.fmt(v);
    });
    row.append(name, input, val);
    panel.appendChild(row);
  }

  document.body.appendChild(panel);
  return {
    show() { panel.dataset.open = 'true'; },
    hide() { panel.dataset.open = 'false'; },
  };
}
