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
- **The chains** (`js/chains.js`) — the `CASE_FOCUS` scene is a rail of 22
  draggable gold chains simulated with **Verlet integration** (16–22 particles,
  pinned at both top ends, 6 relaxation iterations, heavy tip pendant via
  inverse-mass weighting). Grab anywhere to drag; a quick tap opens the piece
  detail. Four systems guarantee a clean return to rest after any interaction:
  1. **Baked rest pose** — at load each chain converges under gravity only; the
     result is the ground-truth "settled" pose (a clean vertical hang).
  2. **Settle assist** — off the drag, a weak spring pulls each particle toward
     its rest pose, gated by kinetic energy (≈0 while swinging hard, ramping up
     as it slows) atop linear damping + quadratic air drag.
  3. **Sleep / wake** — after ~30 calm frames a chain eases to rest over 300ms,
     sleeps, and is baked into the pre-composited background; proximity wakes it
     and its two neighbors. Only awake/settling chains simulate & draw live.
  4. **Lane + loop integrity** — a soft horizontal lane keeps each chain in its
     own slot; cross-strand band constraints keep the loop's two strands from
     crossing or scissoring, so a chain can never rest tangled with a neighbor.

  Chains are also **reactive to the mouse**: hovering pushes nearby chains away
  from the cursor and drags them along the swipe (they part as you sweep
  through), then the settle/sleep systems glide them back to rest — tunable via
  the `cursor push` / `cursor radius` sliders.

  Tuning target — grab & fling → heavy lively swing → visible decay over ~2–3s →
  glides back into its slot and hangs perfectly still. Verified by a torture
  test (5 chains flung ~875px across each other): fully settled at **3.0s**,
  **0px** deviation from first load. Press **`D`** for the debug view (particles,
  constraints, cross-strand + lane overlays, fps) with live sliders for damping,
  settle-spring strength, sleep threshold, and lane width.
- **Jewelry renderer** (`js/jewelry.js`) — procedural, image-free jewelry via a
  **sprite-atlas + rotation cache**. Each of the four link styles (rope / box /
  figaro / Cuban) is pre-rendered at 48 rotations into an offscreen atlas; a
  chain is drawn by walking its particle path and *stamping* the nearest cached
  rotation with `drawImage` (never per-link path drawing), with per-gauge
  thickness as a stamp scale. Four procedural pendants (cross, crucifix,
  medallion, tablet) and `ring`/`bangle` primitives are cached the same way.
- **Asset pipeline** (`js/assets.js`) — every element requests a photographic
  cutout PNG by key (`link:cuban`, `pendant:cross`, …). Only keys in the
  registry **manifest** are fetched, so the default (empty) manifest means zero
  network requests and everything renders procedurally; a manifested PNG that
  404s or fails to decode silently falls back. **Zero required image deps.**
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
