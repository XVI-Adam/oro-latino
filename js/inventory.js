// inventory.js — loads the case contents from data/pieces.json.
//
// Everything the case shows (how many chains hang, their link style, gauge,
// pendant, and all card copy) comes from that file, so swapping in real stock
// is a content edit. If the fetch fails (offline, file://, missing file) we
// fall back to a tiny built-in set so the experience still runs.

const FALLBACK = {
  store: {
    name: 'Oro Latino Inc.',
    phone: '212-925-1538',
    sms: '+12129251538',
    instagram: 'https://instagram.com/orolatino.nyc',
    instagramHandle: '@orolatino.nyc',
  },
  copy: {
    ask_es: 'Pregunta por el precio',
    ask_en: 'Ask for price',
    inquire_es: 'Preguntar',
    inquire_en: 'Inquire',
    sms_template_es: 'Hola Oro Latino, me interesa la {name_es} ({karat}, {gauge}).',
    sms_template_en: "Hi Oro Latino — I'm interested in the {name_en} ({karat}, {gauge}).",
  },
  pieces: [
    { id: 'cubana', name_es: 'Cadena Cubana', name_en: 'Cuban Link Chain', chain: 'cuban',
      chain_es: 'Eslabón cubano', chain_en: 'Cuban link', karat: '10K', gauge_mm: 8,
      length_es: '60 cm', length_en: '24 in', price: null, pendant: null },
    { id: 'cristo', name_es: 'Cristo con Cadena', name_en: 'Crucifix & Chain', chain: 'rope',
      chain_es: 'Torzal', chain_en: 'Rope', karat: '14K', gauge_mm: 5,
      length_es: '66 cm', length_en: '26 in', price: null, pendant: 'crucifix' },
    { id: 'figaro', name_es: 'Cadena Fígaro', name_en: 'Figaro Chain', chain: 'figaro',
      chain_es: 'Fígaro 3+1', chain_en: 'Figaro 3+1', karat: '10K', gauge_mm: 6,
      length_es: '60 cm', length_en: '24 in', price: null, pendant: null },
    { id: 'caja', name_es: 'Cadena de Caja', name_en: 'Box Chain', chain: 'box',
      chain_es: 'Eslabón caja', chain_en: 'Box link', karat: '14K', gauge_mm: 5,
      length_es: '55 cm', length_en: '22 in', price: null, pendant: 'medallion' },
  ],
};

/** Visual link thickness derived from the piece's real gauge in millimetres. */
export function renderGauge(piece) {
  const mm = Number(piece.gauge_mm) || 5;
  return Math.max(0.6, Math.min(1.7, 0.62 + mm * 0.075));
}

/** Fill {name_es}-style placeholders in a copy template. */
export function fillTemplate(tpl, piece) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, key) => {
    if (key === 'gauge') return `${piece.gauge_mm} mm`;
    return piece[key] != null ? String(piece[key]) : '';
  });
}

export async function loadInventory(url = 'data/pieces.json') {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.pieces) || data.pieces.length === 0) throw new Error('no pieces');
    return {
      store: { ...FALLBACK.store, ...(data.store || {}) },
      copy: { ...FALLBACK.copy, ...(data.copy || {}) },
      pieces: data.pieces,
    };
  } catch (err) {
    console.warn(`[inventory] using built-in fallback (${err.message})`);
    return FALLBACK;
  }
}
