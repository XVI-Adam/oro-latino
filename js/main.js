// main.js — bootstrap. Wires the stage, state machine, procedural gate,
// renderer, DOM overlay, debug panel, and all pointer/scroll input.

import { GATE_RECT, SCENES, STATES } from './config.js';
import { Stage } from './stage.js';
import { StateMachine } from './state.js';
import { Gate } from './gate.js';
import { AssetRegistry } from './assets.js';
import { Jewelry } from './jewelry.js';
import { ChainRail } from './chains.js';
import { buildChainTuner } from './chaintuner.js';
import { Renderer } from './render.js';
import { Overlay } from './overlay.js';
import { DebugPanel } from './debug.js';

const stageEl = document.getElementById('stage');
const canvas = document.getElementById('scene');

const stage = new Stage(stageEl, canvas);
const machine = new StateMachine();

// The signature interaction. Latching fully open advances to the storefront.
const gate = new Gate({ ...GATE_RECT }, () => machine.go(STATES.STOREFRONT));

// Asset pipeline (empty manifest → all procedural, zero required images) and the
// procedural jewelry renderer that draws chains, pendants, and ring/bangle art.
const assets = new AssetRegistry(); // add { manifest: ['link:cuban', ...] } to use PNGs
const jewelry = new Jewelry(assets, () => stage.dpr);

// The chain case. A quick tap on a chain opens its piece detail.
const chainRail = new ChainRail(stage, jewelry, () => machine.go(STATES.PIECE_DETAIL));

// Live sliders for the chain physics — visible while the 'D' debug view is on.
const chainTuner = buildChainTuner(chainRail.params);
chainTuner.hide();

// Which interactive box is under the pointer (non-gate scenes).
let hoverId = null;

const renderer = new Renderer(stage, machine, () => hoverId, gate, chainRail);
const overlay = new Overlay(machine, handleAction);
new DebugPanel(machine, (state) => machine.go(state));

const isGateState = () =>
  machine.state === STATES.GATE_CLOSED || machine.state === STATES.GATE_OPENING;
const isCaseState = () => machine.state === STATES.CASE_FOCUS;

machine.onChange((state) => {
  overlay.update(state);
  hoverId = null;
  canvas.style.cursor = 'default';
  if (state === STATES.GATE_CLOSED) {
    gate.reset(0);
    canvas.style.cursor = 'grab';
  } else if (state === STATES.GATE_OPENING) {
    // Debug affordance: watch it roll itself open from closed.
    gate.reset(0.03);
    gate.autoOpen();
  }
});

// Overlay/route actions: gate command, or a plain state transition.
function handleAction(act) {
  if (act.command === 'gate-open') { gate.autoOpen(); return; }
  if (act.to) machine.go(act.to);
}

// ── pointer hit-testing against a scene's interactive boxes ─────────────────
function boxAt(designX, designY) {
  const scene = SCENES[machine.state];
  if (!scene) return null;
  for (let i = scene.boxes.length - 1; i >= 0; i--) {
    const b = scene.boxes[i];
    if (!b.to) continue;
    if (designX >= b.x && designX <= b.x + b.w && designY >= b.y && designY <= b.y + b.h) return b;
  }
  return null;
}

// ── input ───────────────────────────────────────────────────────────────────
canvas.addEventListener('pointerdown', (e) => {
  const { x, y } = stage.toDesign(e.clientX, e.clientY);
  if (isGateState()) {
    e.preventDefault();
    gate.pointerDown(y);
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture?.(e.pointerId);
    return;
  }
  if (isCaseState()) {
    e.preventDefault();
    if (chainRail.pointerDown(x, y)) canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture?.(e.pointerId);
    return;
  }
  const hit = boxAt(x, y);
  if (hit) machine.go(hit.to);
});

// Track moves on window so a drag continues past the canvas edge.
window.addEventListener('pointermove', (e) => {
  const { x, y } = stage.toDesign(e.clientX, e.clientY);
  if (isGateState()) {
    if (gate.dragging) gate.pointerMove(y);
    return;
  }
  if (isCaseState()) {
    chainRail.pointerMove(x, y, e.buttons > 0);
    if (!chainRail.dragging) canvas.style.cursor = 'grab';
    return;
  }
  const hit = boxAt(x, y);
  hoverId = hit ? hit.id : null;
  canvas.style.cursor = hit ? 'pointer' : 'default';
});

window.addEventListener('pointerup', () => {
  if (isGateState()) {
    gate.pointerUp();
    canvas.style.cursor = gate.opened ? 'default' : 'grab';
  } else if (isCaseState()) {
    chainRail.pointerUp();
    canvas.style.cursor = 'grab';
  }
});

canvas.addEventListener('pointerleave', () => {
  if (!isGateState()) { hoverId = null; canvas.style.cursor = 'default'; }
});

// Scroll up rolls the gate open.
canvas.addEventListener('wheel', (e) => {
  if (isGateState()) { e.preventDefault(); gate.wheel(e.deltaY); }
}, { passive: false });

window.addEventListener('keydown', (e) => {
  // 'D' toggles the chain physics debug view (particles + constraints) + sliders.
  if (e.key === 'd' || e.key === 'D') {
    chainRail.toggleDebug();
    if (chainRail.debug) chainTuner.show(); else chainTuner.hide();
    return;
  }
  // Keyboard fallback for the gate: up-arrow / space nudges it open.
  if (isGateState() && (e.key === 'ArrowUp' || e.key === ' ')) {
    e.preventDefault();
    gate.autoOpen();
  }
});

// Kick off in the closed state.
machine.go(STATES.GATE_CLOSED);
renderer.start();

// Handy for console poking during development.
window.OroLatino = { stage, machine, gate, chainRail, jewelry, assets, renderer };
