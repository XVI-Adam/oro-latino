// main.js — bootstrap. Wires the stage, state machine, procedural gate,
// renderer, DOM overlay, debug panel, and all pointer/scroll input.

import { DESIGN, GATE_RECT, SCENES, STATES, TRANSIENTS, frameFor } from './config.js';
import { Stage } from './stage.js';
import { StateMachine } from './state.js';
import { Gate } from './gate.js';
import { AssetRegistry } from './assets.js';
import { Jewelry } from './jewelry.js';
import { ChainRail } from './chains.js';
import { buildChainTuner } from './chaintuner.js';
import { Storefront } from './storefront.js';
import { Interior } from './interior.js';
import { loadInventory, renderGauge } from './inventory.js';
import { PieceCard } from './piececard.js';
import { Accessibility } from './a11y.js';
import { AttractMode } from './attract.js';
import { detectQuality, isCoarse, prefersReducedMotion, isPortrait, watchEnvironment } from './quality.js';
import { Renderer } from './render.js';
import { Overlay } from './overlay.js';
import { DebugPanel } from './debug.js';

const stageEl = document.getElementById('stage');
const canvas = document.getElementById('scene');

const stage = new Stage(stageEl, canvas);
const machine = new StateMachine();

// Device capability probes — one read, shared by every subsystem.
const QUALITY = detectQuality();
const COARSE = isCoarse();
let reducedMotion = prefersReducedMotion();
document.body.dataset.quality = QUALITY.toFixed(2);
document.body.classList.toggle('is-coarse', COARSE);
document.body.classList.toggle('is-reduced', reducedMotion);

// The signature interaction. Latching fully open advances to the storefront.
const gate = new Gate({ ...GATE_RECT }, () => machine.go(STATES.STOREFRONT));
gate.reducedMotion = reducedMotion;

// Asset pipeline (empty manifest → all procedural, zero required images) and the
// procedural jewelry renderer that draws chains, pendants, and ring/bangle art.
const assets = new AssetRegistry(); // add { manifest: ['link:cuban', ...] } to use PNGs
const jewelry = new Jewelry(assets, () => stage.dpr);

// The chain case — 00 chains until the inventory lands, then rebuilt from it.
const inventory = await loadInventory();
for (const p of inventory.pieces) p.renderGauge = renderGauge(p);

// A quick tap on a chain or its price tag opens that piece's detail card.
const chainRail = new ChainRail(stage, jewelry, (i) => openPiece(i), {
  railY: 158, x0: 190, x1: DESIGN.W - 190, seed: 1337, scale: 1.22, dropScale: 1.45,
  pieces: inventory.pieces, tags: true,
  quality: QUALITY, reducedMotion, coarsePointer: COARSE,
});

// The handwritten-tag detail card (DOM chrome over the lifted chain).
const pieceCard = new PieceCard(inventory, () => machine.go(STATES.CASE_FOCUS));

function openPiece(index) {
  const piece = inventory.pieces[index];
  if (!piece) return;
  chainRail.focus(index);
  pieceCard.show(piece);
  machine.go(STATES.PIECE_DETAIL);
}

// Live sliders for the chain physics — visible while the 'D' debug view is on.
const chainTuner = buildChainTuner(chainRail.params);
chainTuner.hide();

// The storefront window: a second, smaller chain rail (same sim) plus the
// layered scene — sign, trays, bangles, glass, and the draggable entry door.
const windowChains = new ChainRail(stage, jewelry, () => {}, {
  railY: 265, x0: 320, x1: 1330, count: 13, seed: 4242, scale: 0.7,
  quality: QUALITY, reducedMotion, coarsePointer: COARSE,
});
const storefront = new Storefront({ ...GATE_RECT }, windowChains, jewelry,
  () => machine.go(STATES.ENTERING));

// The shop interior: light box, wall cases, chain rack, counter, sticker wall.
const interior = new Interior(jewelry);

// Which interactive region is under the pointer (canvas hover highlight).
let hoverId = null;

const renderer = new Renderer(stage, machine, () => hoverId, gate, chainRail, storefront, interior);
const overlay = new Overlay(machine, handleAction);
overlay.setHotspots(interior.hotspots);

// Keep the DOM chrome in step with the camera: it can't zoom with the canvas,
// so fade it out while a transition is running.
renderer.reducedMotion = reducedMotion;
renderer.onCamera = (t) => overlay.setChromeFade(t);
new DebugPanel(machine, (state) => machine.go(state));

const isGateState = () =>
  machine.state === STATES.GATE_CLOSED || machine.state === STATES.GATE_OPENING;
const isCaseState = () => machine.state === STATES.CASE_FOCUS;
const isStorefront = () => machine.state === STATES.STOREFRONT;
const isInterior = () => machine.state === STATES.INTERIOR;

// ── per-scene mobile framing ────────────────────────────────────────────────
// Portrait crops the design space to the scene's own 9:16 rect; landscape
// frames the whole stage. In CASE_FOCUS the crop pans to the selected piece so
// every chain is reachable on a phone.
function applyFrame() {
  const portrait = isPortrait();
  document.body.classList.toggle('is-portrait', portrait);
  const base = frameFor(machine.state, portrait);
  if (!portrait) { stage.setFrame(base); return; }
  if (machine.state === STATES.CASE_FOCUS) {
    const i = chainRail.keyFocus >= 0 ? chainRail.keyFocus : 0;
    const cx = chainRail.chains[i].discX;
    const x = Math.max(0, Math.min(DESIGN.W - base.w, cx - base.w / 2));
    stage.setFrame({ ...base, x });
    return;
  }
  stage.setFrame(base);
}

machine.onChange((state) => {
  overlay.update(state);
  applyFrame();
  hoverId = null;
  overlay.setHotspotHover(null);
  canvas.style.cursor = 'default';
  if (state !== STATES.CASE_FOCUS) chainRail.clearCursor();
  if (state !== STATES.PIECE_DETAIL) { pieceCard.hide(); chainRail.unfocus(); }
  if (state !== STATES.STOREFRONT) windowChains.clearCursor();
  if (state === STATES.STOREFRONT) storefront.reset();
  // Step through the door: run the push-in for the whole ENTERING transient.
  if (state === STATES.ENTERING) renderer.beginDolly(TRANSIENTS[STATES.ENTERING].duration);
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

// Pointer capture throws NotFoundError for a pointerId that isn't an active
// pointer — which is exactly what synthesized (attract-mode) events are. The
// capture is an optimisation, never a requirement, so failing it is harmless.
function capturePointer(e) {
  try { canvas.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
}

// ── input ───────────────────────────────────────────────────────────────────
canvas.addEventListener('pointerdown', (e) => {
  const { x, y } = stage.toDesign(e.clientX, e.clientY);
  if (isGateState()) {
    e.preventDefault();
    gate.pointerDown(y);
    canvas.style.cursor = 'grabbing';
    capturePointer(e);
    return;
  }
  if (isCaseState()) {
    e.preventDefault();
    if (chainRail.pointerDown(x, y)) canvas.style.cursor = 'grabbing';
    capturePointer(e);
    return;
  }
  if (isStorefront()) {
    e.preventDefault();
    if (storefront.hitDoor(x, y)) {
      storefront.doorDown(x);
      canvas.style.cursor = 'grabbing';
    } else if (windowChains.pointerDown(x, y)) {
      canvas.style.cursor = 'grabbing';
    }
    capturePointer(e);
    return;
  }
  if (isInterior()) {
    const spot = interior.hitTest(x, y);
    // zoom toward the case first; the state change lands when the move ends
    if (spot && spot.to && renderer.camera.kind !== 'zoom') {
      overlay.setHotspotHover(null);
      renderer.beginCaseZoom(spot, () => machine.go(spot.to));
    }
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
    if (!chainRail.dragging) {
      chainRail.hoverTag = chainRail.tagAt(x, y);
      canvas.style.cursor = chainRail.hoverTag >= 0 ? 'pointer' : 'grab';
    }
    return;
  }
  if (isStorefront()) {
    if (storefront.draggingDoor) { storefront.doorMove(x); return; }
    windowChains.pointerMove(x, y, e.buttons > 0);
    if (!windowChains.dragging) {
      canvas.style.cursor = storefront.hitDoor(x, y) ? 'grab' : 'default';
    }
    return;
  }
  if (isInterior()) {
    if (renderer.camera.kind === 'zoom') return; // don't fight the transition
    const spot = interior.hitTest(x, y);
    hoverId = spot ? spot.id : null;
    overlay.setHotspotHover(hoverId);
    canvas.style.cursor = spot && spot.to ? 'pointer' : 'default';
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
  } else if (isStorefront()) {
    storefront.doorUp();
    windowChains.pointerUp();
    canvas.style.cursor = 'default';
  }
});

canvas.addEventListener('pointerleave', () => {
  if (isCaseState()) chainRail.clearCursor();
  if (isStorefront()) windowChains.clearCursor();
  if (!isGateState()) {
    hoverId = null;
    overlay.setHotspotHover(null);
    canvas.style.cursor = 'default';
  }
});

// Scroll: rolls the gate open, or swings the storefront door open.
canvas.addEventListener('wheel', (e) => {
  if (isGateState()) { e.preventDefault(); gate.wheel(e.deltaY); }
  else if (isStorefront()) { e.preventDefault(); storefront.wheel(e.deltaY); }
}, { passive: false });

window.addEventListener('keydown', (e) => {
  // 'D' toggles the chain physics debug view (particles + constraints) + sliders.
  if (e.key === 'd' || e.key === 'D') {
    chainRail.toggleDebug();
    windowChains.toggleDebug();
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
// ── attract mode ──────────────────────────────────────────────────────────
// Drives the app purely by synthesizing pointer events into the same listeners
// a person hits, so the demo can never desync from real behaviour.
const attract = new AttractMode({
  stage, machine, canvas, chainRail, storefront, interior, gate,
  states: STATES,
  reducedMotion: () => reducedMotion,
});
document.getElementById('tour-btn').addEventListener('click', () => attract.start());

// ── accessibility: keyboard path + parallel screen-reader lists ────────────
const a11y = new Accessibility({
  machine, chainRail, interior, inventory,
  actions: {
    openGate: () => { if (isGateState()) gate.autoOpen(); },
    enterShop: () => { if (isStorefront()) machine.go(STATES.ENTERING); },
    openCase: (i) => {
      const spot = interior.hotspots[i];
      if (!spot) return;
      if (spot.to) {
        if (renderer.camera.kind === 'zoom') return;
        renderer.beginCaseZoom(spot, () => machine.go(spot.to));
      } else {
        a11y.say(`${spot.es}. ${spot.en}. Próximamente. Coming soon.`);
      }
    },
    openPiece: (i) => openPiece(i),
    back: () => {
      const s = machine.state;
      if (s === STATES.PIECE_DETAIL) { machine.go(STATES.CASE_FOCUS); return true; }
      if (s === STATES.CASE_FOCUS) { machine.go(STATES.INTERIOR); return true; }
      if (s === STATES.INTERIOR) { machine.go(STATES.STOREFRONT); return true; }
      return false;
    },
  },
});
machine.onChange((state) => a11y.syncTo(state));
chainRail.onKeyFocus = () => applyFrame();   // portrait crop follows the selection
a11y.syncTo(machine.state);

applyFrame();
watchEnvironment(() => {
  reducedMotion = prefersReducedMotion();
  document.body.classList.toggle('is-reduced', reducedMotion);
  gate.reducedMotion = reducedMotion;
  renderer.reducedMotion = reducedMotion;
  chainRail.reducedMotion = reducedMotion;
  windowChains.reducedMotion = reducedMotion;
  applyFrame();
});

window.OroLatino = {
  stage, machine, gate, chainRail, windowChains, storefront, interior,
  inventory, pieceCard, jewelry, assets, renderer, attract, a11y,
};
