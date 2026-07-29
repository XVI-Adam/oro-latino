// config.js — design constants, palette, route index, and per-state scene data.
// Everything downstream measures in DESIGN PIXELS on a fixed 1848×1080 surface.

export const DESIGN = Object.freeze({
  W: 1848,
  H: 1080,
});

// Palette — warm festive gold, black fascia, cream tags, felt navy, vermilion mark.
export const PALETTE = Object.freeze({
  goldHi:    '#E8C86A', // catchlight gold
  gold:      '#D4AF37', // primary festive gold
  goldLo:    '#B8860B', // deep gold / shadow
  black:     '#0B0B0C', // storefront fascia
  cream:     '#F4EBD9', // paper price tags
  felt:      '#1B2A4A', // display-case felt navy
  feltLo:    '#111C33', // felt shadow
  vermilion: '#E23A2E', // logo red-diamond accent
  box:       '#8A8A8E', // placeholder gray box fill
  boxLine:   '#6E6E72', // placeholder gray box stroke
  boxText:   '#2B2B2E', // placeholder label text
});

// ─── State machine states ────────────────────────────────────────────────────
export const STATES = Object.freeze({
  GATE_CLOSED:  'GATE_CLOSED',
  GATE_OPENING: 'GATE_OPENING',
  STOREFRONT:   'STOREFRONT',
  ENTERING:     'ENTERING',
  INTERIOR:     'INTERIOR',
  CASE_FOCUS:   'CASE_FOCUS',
  PIECE_DETAIL: 'PIECE_DETAIL',
});

// Ordered list for the debug panel.
export const STATE_ORDER = [
  STATES.GATE_CLOSED,
  STATES.GATE_OPENING,
  STATES.STOREFRONT,
  STATES.ENTERING,
  STATES.INTERIOR,
  STATES.CASE_FOCUS,
  STATES.PIECE_DETAIL,
];

// Transient states auto-advance after `duration` ms.
// (GATE_OPENING is driven by the gate physics, not a timer — see gate.js.)
export const TRANSIENTS = Object.freeze({
  [STATES.ENTERING]: { next: STATES.INTERIOR, duration: 1100 },
});

// The gate's opening rectangle (design px) — the storefront window it covers.
export const GATE_RECT = Object.freeze({ x: 224, y: 150, w: 1400, h: 820 });

// ─── Route index (the numbered walkthrough) ──────────────────────────────────
// Each stop maps to the state it represents.
export const ROUTE = [
  { num: '00', es: 'La Vitrina', en: 'The Window', state: STATES.STOREFRONT },
  { num: '01', es: 'Adentro',    en: 'Inside',         state: STATES.INTERIOR },
  { num: '02', es: 'Cadenas',    en: 'The Chain Case', state: STATES.CASE_FOCUS },
];

// ─── Per-state scene definitions ─────────────────────────────────────────────
// A scene = a backdrop kind + placeholder gray boxes (design-pixel rects).
// `to` marks a box as interactive and names the state it advances to.
// `plate` drives the DOM title block; `actions` drive the action bar.

export const SCENES = {
  // The gate is rendered procedurally (gate.js) over the storefront reveal;
  // no placeholder boxes of its own.
  [STATES.GATE_CLOSED]: {
    backdrop: 'fascia',
    plate: { num: '00', es: 'La Vitrina', en: 'The Window' },
    boxes: [],
    hint: { es: 'Arrastra o desplaza hacia arriba', en: 'Drag or scroll up to open' },
    actions: [{ label_es: 'Abrir', label_en: 'Open', command: 'gate-open', primary: true }],
  },

  [STATES.GATE_OPENING]: {
    backdrop: 'fascia',
    plate: { num: '00', es: 'La Vitrina', en: 'The Window' },
    boxes: [],
    actions: [],
  },

  // Drawn entirely by storefront.js (sign, window, displays, door, glass).
  [STATES.STOREFRONT]: {
    backdrop: 'fascia',
    plate: { num: '00', es: 'La Vitrina', en: 'The Window' },
    boxes: [],
    hint: { es: 'Arrastra la puerta o desplázate', en: 'Drag the door or scroll' },
    actions: [{ label_es: 'Entrar', label_en: 'Enter', to: STATES.ENTERING, primary: true }],
  },

  // The push-in dolly carries this state; nothing else to draw.
  [STATES.ENTERING]: {
    backdrop: 'interior',
    plate: { num: '01', es: 'Adentro', en: 'Inside' },
    boxes: [],
    actions: [],
  },

  // Drawn entirely by interior.js; its hit regions carry DOM labels.
  [STATES.INTERIOR]: {
    backdrop: 'interior',
    plate: { num: '01', es: 'Adentro', en: 'Inside' },
    boxes: [],
    hint: { es: 'Elige una vitrina', en: 'Pick a case' },
    actions: [],
  },

  // The chains are Verlet-simulated (chains.js), not placeholder boxes.
  [STATES.CASE_FOCUS]: {
    backdrop: 'felt',
    plate: { num: '02', es: 'Cadenas', en: 'The Chain Case' },
    boxes: [],
    hint: { es: 'Arrastra las cadenas · toca para ver', en: 'Drag the chains · tap to view' },
    actions: [{ label_es: 'Volver', label_en: 'Back', to: STATES.INTERIOR }],
  },

  [STATES.PIECE_DETAIL]: {
    backdrop: 'felt',
    plate: { num: '02', es: 'La Pieza', en: 'The Piece' },
    boxes: [
      { id: 'piece', x: 700, y: 180, w: 440, h: 720, es: 'Pieza', en: 'Piece' },
      { id: 'tag',   x: 1240, y: 360, w: 380, h: 260, es: 'Etiqueta de precio', en: 'Price tag' },
    ],
    actions: [{ label_es: 'Volver', label_en: 'Back', to: STATES.CASE_FOCUS }],
  },
};
