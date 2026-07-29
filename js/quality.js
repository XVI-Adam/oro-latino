// quality.js — device capability probes that the rest of the app reads once.
//
//  · quality  — 0.45…1 simulation budget from dpr, screen area, cores and input
//               type. Chains use it to cut particle counts and relaxation
//               iterations on phones, where fill rate is the real cost.
//  · reduced  — prefers-reduced-motion: physics is swapped for gentle crossfades.
//  · coarse   — touch input: hit slop grows so nothing needs a precise stab.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function detectQuality() {
  const dpr = window.devicePixelRatio || 1;
  const coarse = isCoarse();
  const cores = navigator.hardwareConcurrency || 4;
  // device pixels the compositor actually has to push
  const devicePx = window.innerWidth * window.innerHeight * dpr * dpr;

  let q = 1;
  if (coarse) q -= 0.3;             // phones/tablets
  if (devicePx > 4.0e6) q -= 0.12;  // dense or large panels
  if (devicePx > 8.0e6) q -= 0.1;
  if (cores <= 4) q -= 0.12;
  if (dpr >= 3) q -= 0.06;
  return clamp(Math.round(q * 100) / 100, 0.45, 1);
}

export function isCoarse() {
  return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
}

export function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isPortrait() {
  return window.innerHeight > window.innerWidth;
}

/** Watch reduced-motion + orientation; `cb` fires on either change. */
export function watchEnvironment(cb) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener?.('change', cb);
  window.addEventListener('resize', cb);
  window.addEventListener('orientationchange', cb);
}
