# Oro Latino — La Ruta

Skeleton of a single-page, editorial walkthrough of a NYC Latino jewelry store,
structured as a numbered route index:

- **00 · La Vitrina** — the storefront
- **01 · Adentro** — the interior
- **02 · Cadenas** — the chain case

Everything is placeholder gray boxes for now — no assets yet.

## Run

ES modules need HTTP (not `file://`). From this directory:

```bash
python3 -m http.server 8777
```

Then open http://localhost:8777/index.html

## Architecture

Fixed **1848×1080 design coordinate system**. All layout math — canvas *and*
DOM — is in design pixels; the whole `#stage` is scaled to the viewport with a
single CSS transform and letterboxed (`js/stage.js`).

- **`<canvas>`** (`js/render.js`) — all visual / physical content: backdrops
  and labeled placeholder boxes.
- **DOM overlay** (`js/overlay.js`) — crisp chrome: route-index numerals,
  bilingual (ES/EN) labels, action buttons, logo mark.
- **State machine** (`js/state.js`) —
  `GATE_CLOSED → GATE_OPENING → STOREFRONT → ENTERING → INTERIOR → CASE_FOCUS → PIECE_DETAIL`.
  `ENTERING` is transient and auto-advances.
- **The gate** (`js/gate.js`) — the signature opening interaction. A fully
  procedural roll-down security gate (corrugated slats, growing cylinder, brass
  handle rail, light bleed, side tracks). **Drag or scroll up** to roll it open.
  Physics: an inverted spring `S·(pos − 0.5)` makes it feel heavy below halfway
  and spring-assist above (0.5 is a tipping point). Release early and it rattles
  back down and bounces on the sill; cross the tip and it snaps home, latches,
  screen-shakes, and advances to `STOREFRONT`. No images. See the header comment
  in `gate.js` for the model.
- **Debug panel** (`js/debug.js`) — jump directly to any state.
- **`js/config.js`** — the single source of truth: palette, design constants,
  route index, and per-state scene data (the placeholder boxes).

Interactive boxes carry a `to:` state in `config.js`, get a vermilion dot +
gold hover border on the canvas, and are click/hover hit-tested in `js/main.js`.

## Palette

| Token | Hex | Use |
|-------|-----|-----|
| gold | `#D4AF37` | primary festive gold |
| gold-hi / gold-lo | `#E8C86A` / `#B8860B` | catchlight / shadow |
| black | `#0B0B0C` | storefront fascia |
| cream | `#F4EBD9` | paper price tags |
| felt | `#1B2A4A` | display-case navy |
| vermilion | `#E23A2E` | logo red-diamond accent |
