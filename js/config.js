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
  { num: '00', es: 'La Vitrina', en: 'The Storefront', state: STATES.STOREFRONT },
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
    plate: { num: '00', es: 'La Vitrina', en: 'The Storefront' },
    boxes: [],
    hint: { es: 'Arrastra o desplaza hacia arriba', en: 'Drag or scroll up to open' },
    actions: [{ label_es: 'Abrir', label_en: 'Open', command: 'gate-open', primary: true }],
  },

  [STATES.GATE_OPENING]: {
    backdrop: 'fascia',
    plate: { num: '00', es: 'La Vitrina', en: 'The Storefront' },
    boxes: [],
    actions: [],
  },

  [STATES.STOREFRONT]: {
    backdrop: 'fascia',
    plate: { num: '00', es: 'La Vitrina', en: 'The Storefront' },
    boxes: [
      { id: 'window',  x: 224, y: 150, w: 1400, h: 820, es: 'Vitrina', en: 'Window' },
      { id: 'display', x: 314, y: 320, w: 1220, h: 520, es: 'Exhibición', en: 'Display' },
      { id: 'sign',    x: 574, y: 40,  w: 700,  h: 92,  es: 'Letrero', en: 'Sign' },
    ],
    actions: [{ label_es: 'Entrar', label_en: 'Enter', to: STATES.ENTERING, primary: true }],
  },

  [STATES.ENTERING]: {
    backdrop: 'interior',
    plate: { num: '01', es: 'Adentro', en: 'Inside' },
    boxes: [
      { id: 'doorway', x: 624, y: 120, w: 600, h: 840, es: 'Entrada', en: 'Doorway' },
    ],
    actions: [],
  },

  [STATES.INTERIOR]: {
    backdrop: 'interior',
    plate: { num: '01', es: 'Adentro', en: 'Inside' },
    boxes: [
      { id: 'wall',      x: 120, y: 80,  w: 1608, h: 380, es: 'Pared de vitrinas', en: 'Wall cases' },
      { id: 'counterL',  x: 160, y: 560, w: 620,  h: 380, es: 'Mostrador', en: 'Counter' },
      { id: 'caseChain', x: 1010, y: 540, w: 700, h: 420, es: 'Vitrina de cadenas', en: 'Chain case', to: STATES.CASE_FOCUS },
    ],
    actions: [],
  },

  [STATES.CASE_FOCUS]: {
    backdrop: 'felt',
    plate: { num: '02', es: 'Cadenas', en: 'The Chain Case' },
    boxes: [
      { id: 'chain1', x: 220,  y: 200, w: 300, h: 680, es: 'Cadena cubana', en: 'Cuban link', to: STATES.PIECE_DETAIL },
      { id: 'chain2', x: 560,  y: 200, w: 300, h: 680, es: 'Cadena figaro', en: 'Figaro chain', to: STATES.PIECE_DETAIL },
      { id: 'chain3', x: 900,  y: 200, w: 300, h: 680, es: 'Cadena rope', en: 'Rope chain', to: STATES.PIECE_DETAIL },
      { id: 'chain4', x: 1240, y: 200, w: 300, h: 680, es: 'Cadena barbada', en: 'Curb chain', to: STATES.PIECE_DETAIL },
    ],
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
