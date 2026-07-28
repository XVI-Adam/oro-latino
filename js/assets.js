// assets.js — the photographic-cutout pipeline.
//
// Every visual element may request a cutout PNG by key (e.g. 'link:cuban',
// 'pendant:cross'). The registry only fetches keys that appear in its MANIFEST,
// so an empty manifest means zero network requests and the whole experience
// runs on procedural art alone — nothing here is a required dependency. Drop a
// PNG into assets/<key with ':' → '/'>.png AND add the key to the manifest and
// it takes over automatically; a 404 or decode failure falls back silently.

export class AssetRegistry {
  /**
   * @param {{ basePath?: string, manifest?: string[] }} [opts]
   */
  constructor({ basePath = 'assets/', manifest = [] } = {}) {
    this.basePath = basePath;
    this.manifest = new Set(manifest);
    this.entries = new Map();     // key → { status, img }
    this.listeners = new Map();   // key → Set<cb>
  }

  /** True only for a manifested key whose PNG has finished loading. */
  has(key) {
    return !!this.cutout(key);
  }

  /**
   * The loaded HTMLImageElement for `key`, or null → caller draws procedurally.
   * Non-manifested keys never hit the network; they simply return null.
   */
  cutout(key) {
    if (!this.manifest.has(key)) return null;
    let e = this.entries.get(key);
    if (!e) {
      e = { status: 'loading', img: null };
      this.entries.set(key, e);
      this._load(key, e);
    }
    return e.status === 'loaded' ? e.img : null;
  }

  /** Fires when a manifested key finishes loading — used to invalidate caches. */
  onLoad(key, cb) {
    let s = this.listeners.get(key);
    if (!s) { s = new Set(); this.listeners.set(key, s); }
    s.add(cb);
    return () => s.delete(cb);
  }

  _load(key, e) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      e.status = 'loaded';
      e.img = img;
      const s = this.listeners.get(key);
      if (s) for (const cb of s) cb(key, img);
    };
    img.onerror = () => { e.status = 'missing'; }; // silent — procedural stays
    img.src = this.basePath + key.replace(/:/g, '/') + '.png';
  }
}
