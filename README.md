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
- **The storefront** (`js/storefront.js`) — `00 · La Vitrina / The Window`,
  drawn in layers: black fascia sign (gold "ORO LATINO INC.", white phone,
  rayed diamond mark), the display window with a **second, smaller chain rail**
  (the same Verlet sim at 0.7 scale) up top and procedural displays below —
  black/cream ring trays, a navy tray of green/red stone pieces, a bangle
  cluster — plus night atmosphere: warm glow, sidewalk light spill, and a
  drifting translucent gradient sweep as the street's reflection on the glass.
  The gate reveals this scene as it rises (glow scales with gate height). A
  glass **door** on the right swings open by dragging its edge (spring physics
  with a tipping point, like the gate) or scrolling → `ENTERING → INTERIOR`.
- **The interior** (`js/interior.js`) — `01 · Adentro / Inside`, drawn in
  layers: a backlit acrylic **light box** hanging on chains (white face, black
  "ORO LATINO INC / 212-925-1538", red diamond mark with sparkle lines), two
  **wall cases** (white shelves on black backing in a wood surround), a **chain
  rack** on black hooks, the **sticker wall** as a dense procedural collage,
  **track spotlights** casting warm cones and pools over the cases, and an
  L-shaped **glass counter** with aluminum framing in the foreground. A
  multi-pane **window** on the right shows the storefront in reverse — our own
  fascia sign mirrored, seen from inside. The three furniture pieces are
  hover-highlightable hit regions with bilingual DOM labels
  (`Cadenas · Chains`, `Anillos · Rings`, `Dijes · Pendants`); clicking the
  chain rack goes to `CASE_FOCUS`.
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

## The chain case & piece detail

`CASE_FOCUS` fills the frame with the shop's stock: one hanging chain per
entry in **`data/pieces.json`**, each fully draggable, each with a small white
**price tag** on its own Verlet pendulum tied to one strand (so tags swing
independently and settle with the chain). Clicking a tag *or* a chain lifts
that piece forward and centered, dims the case, and opens `PIECE_DETAIL`.

The detail card (`js/piececard.js`) is DOM chrome laid out like a handwritten
shop tag — punched hole, ruled cream paper, script name — showing bilingual
name, chain type, karat, gauge, length, and either the price or
*"Pregunta por el precio / Ask for price"*. **Inquire / Preguntar** opens an
`sms:` deep link to the store prefilled with a bilingual message naming the
piece, with an Instagram link as fallback.

**Everything is a content edit.** `data/pieces.json` supplies the store's
contact details, all copy templates, and the pieces themselves — how many
chains hang, their link style, visual gauge (derived from the real `gauge_mm`),
and pendant. `js/inventory.js` loads it and falls back to a small built-in set
if the file is missing, so the page still runs.

## Two rendering tiers

The case and the piece view now want opposite things, so they get different art.

**Graphic tier — the case.** At case scale a photographic link is 6px of gold
competing with hundreds of neighbours. This tier trades micro-detail for a
bolder read: `graphicGauge(mm)` compresses the real 3–12mm range into a drawn
**16–34px** on a power curve, so a heavy Cuban still clearly outweighs a fine
rope but the ratio falls from ~4x to **2.1x** and the rail sits in one visual
family. Links are ~1.7x wider than the mm tier with **4 flat value steps** —
dark contour, mid body, lit band, one crisp specular dot — and pitch roughly
doubles. Real millimetres stay in `pieces.json` and on the tag ("Cubana 8mm").

**Detail tier — the piece view.** `PIECE_DETAIL` promotes the selected chain to
the full metallic atlas from the section below: continuous gradients, migrating
hotspots, ~7x the link count. The camera lifts it to **2.7x** over ~600ms while
a depth-of-field blur drops the case behind it. Detail sprites build lazily on
entry and are released on exit, so idle atlas memory never carries them.

The case shows **9 pieces** at the new scale with generous spacing; the rest stay
in `pieces.json` for a future horizontally-draggable rail.

## The metal

Link rendering is its own module (`js/links.js`), still sprite-atlas based:

- **Interlocked.** Every style has two variants — a face-on ring and an edge-on
  profile — and chains alternate them. Three draw passes give the weave: edge-on
  links go down first, face-on rings over them, then the edge-on links are
  re-stamped through a narrow clip so their shanks read as passing *through*
  the rings. Cuban links overlap ~30%.
- **One global light** (top-left, matching the interior spots). The body
  gradient is baked in link-local space, but the specular hotspot and the
  occlusion crescents are composited in *cell* space with `source-atop` — so as
  a link turns through the atlas's 32 rotation steps the highlight **migrates
  across it** instead of riding along. Ramp: `#5C3D0E` core → mid → bright →
  `#FFF6D8` hotspot.
- **Real-world scale.** Links are authored in millimetres and converted through
  one `PX_PER_MM` constant (rope 2.5–4, box 2–3, figaro 3–5, Cuban 6–12). A
  `visualMM` compressor keeps the heaviest chain within ~4x the lightest.
  `gauge_mm` lives in `pieces.json` and shows on the tag — "Cubana 8mm".
- **Curvature-aware.** Links foreshorten along the path tangent and pack more
  densely where the rope bends, so the bottom of a hanging loop reads as chain
  turning a corner rather than beads clumping.
- **Life.** Each chain fires a glint every 4–9s: a 4-point star plus a
  brightening sweep over 3–4 consecutive links, biased toward links facing the
  light. Grabbing a chain, or swinging it hard, throws 2–3 extra from its
  tightest bends.

Atlases render at 2x supersample minimum, 32 rotation steps.

## Polish & performance

Details that only show up when you sit with it: price tags **flutter** from the
air a chain moves through — and from a neighbour swinging past; the light box
**flickers** like a tube striking when you first walk in; **dust motes** drift
up the spotlight beams; a security camera **dome tracks the cursor**, slowly;
**glints** sweep across gold at random intervals (a second atlas pass with
`lighter` compositing, so the sprite masks the highlight onto the metal
exactly); route **numerals flip** on scene change; and optional procedural
**sound** — gate rattle, chain clink — is muted by default and creates no
`AudioContext` until you turn it on.

Loading is instant because everything is drawn, not fetched. Photo cutouts are
lazy-swapped in as they arrive (see the asset pipeline above).

### Tier + composition pass numbers

| | before | after |
|---|---|---|
| chains in frame | 14 | **9** |
| links per chain | 80–183 | **49–107** |
| stamps/frame, 3 chains awake | 936 | **215** |
| composite re-bake | 12.2ms | **4.5ms** |
| atlas at idle | 4.1MB | 13.4MB (graphic + detail tiers) |
| detail LOD | — | 3.1ms / 148 stamps, unloads to 13.4MB |

### Perf HUD

The debug panel (`D`) carries a live HUD — fps, ms per subsystem (physics /
chains / tags / composite / glints), drawImage calls this frame, awake-chain
count and atlas MB against a 64MB budget, which warns to the console if
exceeded. It is always on: every optimisation below was justified by one of
these numbers moving.

### The 5fps regression, diagnosed

Instrumenting first found three compounding causes, none of them the shading:

| | before | after |
|---|---|---|
| links in the case | **6,053** (one 3mm rope had **1,005**) | 5,133, capped at 420/chain |
| stamps per frame, all awake | 18,159 (3 interlock passes) | ~2,000 |
| per-link `save`/`clip`/`restore` | 6,053 | 0 — baked into the run sprite |
| composite re-bake | **11.2ms**, re-fired on every wake/sleep | 3.7ms |
| physics catch-up | up to 5 substeps — a slow frame bought more work | 2 |

The fixes, in order of payoff:

- **Run sprites** (`RunAtlas`). 8 already-interlocked, already-shaded links baked
  as one sprite per rotation step, in 8- and 4-link tiers. Straight stretches
  stamp one sprite; only real bends and the tail fall back to single links.
  The three-pass interlock — including the threading clip — now happens once at
  bake time instead of per link per frame.
- **Zero frame-time state churn**: sparkle, ambient-occlusion and disc-holder
  gradients are all cached sprites now; the curvature transform only engages
  below squeeze 0.86.
- **Glints never wake a chain.** A glint is a cached sparkle sprite stamped at a
  point precomputed when it spawned, drawn additively over the composited
  background. At idle: awake = 0, one background `drawImage`.
- **Cull + decouple**: viewport culling by design-space rect, 2-substep cap, and
  a degradation ladder (glint rate → constraint iterations → atlas tier → sim
  only the touched chain) that never touches interlocking or the specular.

Measured after (this machine, 14 chains, dpr capped at 2):

| condition | ms/frame | drawImage |
|---|---|---|
| idle, all asleep | 0.18 | **1** |
| idle + glints (awake = 0) | 0.14 | 10 |
| 3 chains awake | 2.73 | 441 |
| 3 chains + neighbours (5 awake) | 8.75 | 936 |
| all 14 awake | 18.8 | 1,955 |

Live HUD in the case: **60fps, atlas 4.1MB / 64MB**. Torture test unchanged —
762px chaos settles in 3.8s to 0px, 14/14 asleep.

### Per-frame canvas op audit

Measured by instrumenting the 2D context and counting calls in one steady frame:

| scene (steady state) | total ops | `drawImage` | paths |
|---|---|---|---|
| **CASE_FOCUS**, all chains asleep | **3** | **1** | 0 |
| STOREFRONT | 20 | 2 | 1 |
| INTERIOR | 84 | 48 | 6 |
| GATE_CLOSED | 97 | 33 | 4 |

A resting chain case — 14 chains, every link, tag, contact shadow and pendant —
is **one `drawImage`** plus the backdrop fill. The audit drove two real fixes:
the gate now stamps a **pre-rendered slat sprite** (802 → 97 ops, 324 → 4
paths) and the light box's static body is **baked into the wall layer** with
only its brightness envelope live. The interior's remaining cost is its ~46
dust motes, which are deliberate particles stamped from a sprite and scaled by
the device quality budget.

## Attract mode

After **20s idle** — or via the **Recorrido / Tour** button — a ghost cursor
walks the whole journey: rolls the gate up, pauses on the storefront, pulls the
door open, opens the chain case, swings a Cuban link, and opens a piece card.

The tour drives the app **only** by dispatching real `PointerEvent`s into the
same listeners a person hits (`pointerdown` on the canvas, `pointermove` /
`pointerup` on the window). It never calls the state machine or the physics
directly, so the demo can't drift from real behaviour — if a real drag would
fail, the tour fails identically.

Cursor motion is human-imperfect: eased ramps, a perpendicular arc so the path
bows like a wrist, a small overshoot that settles back, per-frame jitter,
randomized durations, and a beat of hesitation before each click.

**Cancellation** keys off `event.isTrusted` — browser-generated input is
trusted, `dispatchEvent` output is not. Any real input aborts mid-motion,
releases a held pointer so nothing is left mid-drag, and hands control back
wherever the tour reached. The whole script is **frame-paced** (rAF, not
`setTimeout`), so a backgrounded tab freezes the tour with the rendering
instead of racing ahead of the physics it's driving.

## Phones & accessibility

- **Per-scene mobile framing** — in portrait the design space is cropped to the
  scene's own **9:16 rect** (`MOBILE_FRAMES` in `config.js`) and that rect is
  fitted to the screen, so every scene keeps a meaningful composition instead of
  shrinking to a letterboxed sliver. `stage.js` fits any design-space rect and
  publishes it as `--fx/--fy/--fw/--fh`, which portrait chrome positions against.
  In the chain case the crop **pans to the selected piece**, so all 14 are
  reachable on a phone.
- **Touch** — `touch-action: none` on the canvas so drags drive the gate and
  chains, never the page; grab radius ×2.2 and tag hit slop ×1.9 on coarse
  pointers, and larger buttons via `body.is-coarse`.
- **Performance heuristic** (`js/quality.js`) — dpr, screen area, core count and
  input type produce a 0.45–1 budget. Chains cut particle counts (21 → 16) and
  relaxation iterations (6 → 4) accordingly, with segment length compensating so
  the drape is identical at every quality level. Device pixel ratio is capped at
  2.5.
- **Full keyboard path** — `Enter`/`Space` opens the gate, steps inside, and
  opens the focused case or piece; `←`/`→` move between wall cases or pieces;
  `↑`/`↓` walk the route; `Escape` backs out. Nothing essential is behind a drag.
- **Screen readers** — every piece exists as a real focusable button in a
  parallel DOM list carrying the same bilingual copy the canvas shows, plus a
  polite live region narrating each move. Focusing an item brings it on screen.
- **`prefers-reduced-motion`** — physics is swapped for gentle crossfades: chains
  hold their baked rest pose (a fling moves nothing), the gate glides open with
  no bounce or shake, and the dolly/zoom become dissolves.
- **Visible focus** — `:focus-visible` gold outlines on all chrome; the
  keyboard-selected chain gets a dashed focus ring drawn on the canvas.

## Cinematics, shadows & compositing

- **Transitions** (`js/camera.js`) — `STOREFRONT → INTERIOR` is a **push-in
  dolly**: the storefront scales up past the viewer and fades while the room
  comes forward from behind, its layers scaling at different rates (parallax).
  `INTERIOR → CASE_FOCUS` is a **smooth zoom** toward the clicked case while
  the rest of the room blurs and darkens — the target case is re-blitted sharp
  and undimmed so it reads as a focus pull. In-scene DOM chrome fades out
  during a move, since DOM can't zoom with the canvas.
- **Physical shadows** — every hanging chain casts a **soft contact shadow**:
  an offset silhouette of the actual chain (three widening strokes, no
  `ctx.filter`), tight where it meets its holder, spreading toward the tip, and
  **trailing the swing** — the further a particle is from its rest position,
  the further its shadow separates. The gate casts **slat shadows** that band
  the revealed storefront and fade as it finishes opening. Pieces resting on
  velvet get **tight ambient occlusion** at their base (`jewelry.ao`).
- **Pre-compositing** (`js/layer.js`) — each scene bakes its static content to
  an offscreen design-sized canvas, so steady-state frames are `drawImage` plus
  dynamic overlays. The interior bakes **two** layers (far wall / near counter)
  so the parallax and the transition blur each cost one extra `drawImage`
  rather than a full redraw.

## Palette

| Token | Hex | Use |
|-------|-----|-----|
| gold | `#D4AF37` | primary festive gold |
| gold-hi / gold-lo | `#E8C86A` / `#B8860B` | catchlight / shadow |
| black | `#0B0B0C` | storefront fascia |
| cream | `#F4EBD9` | paper price tags |
| felt | `#1B2A4A` | display-case navy |
| vermilion | `#E23A2E` | logo red-diamond accent |
