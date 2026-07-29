// piececard.js — the PIECE_DETAIL card: bilingual micro-copy laid out like a
// handwritten shop tag, with an SMS "Inquire" action and an Instagram fallback.
//
// All copy, prices and the store's contact details come from data/pieces.json,
// so this file never needs editing to change inventory.

import { fillTemplate } from './inventory.js';

export class PieceCard {
  /**
   * @param {{store:object, copy:object}} inventory
   * @param {() => void} onClose
   */
  constructor(inventory, onClose) {
    this.store = inventory.store;
    this.copy = inventory.copy;
    this.onClose = onClose || (() => {});

    const el = document.createElement('article');
    el.id = 'piece-card';
    el.dataset.show = 'false';
    el.setAttribute('aria-live', 'polite');
    document.getElementById('overlay').appendChild(el);
    this.el = el;
  }

  hide() {
    this.el.dataset.show = 'false';
    this.piece = null;
  }

  show(piece) {
    this.piece = piece;
    const c = this.copy;
    const asking = !piece.price;
    // With a real price the second line is the currency, not a repeat of it.
    const priceEs = asking ? c.ask_es : piece.price;
    const priceEn = asking ? c.ask_en : 'USD';

    const row = (labelEs, labelEn, value) => `
      <div class="pc-row">
        <span class="pc-label"><b lang="es">${labelEs}</b><i lang="en">${labelEn}</i></span>
        <span class="pc-value">${value}</span>
      </div>`;

    this.el.innerHTML = `
      <button class="pc-close" type="button" aria-label="Cerrar / Close">×</button>
      <div class="pc-hole"></div>
      <header class="pc-head">
        <h2 lang="es">${piece.name_es}</h2>
        <p lang="en">${piece.name_en}</p>
      </header>
      <div class="pc-rows">
        ${row('Cadena', 'Chain', `${piece.chain_es} <span class="pc-sub">${piece.chain_en}</span>`)}
        ${row('Quilates', 'Karat', piece.karat)}
        ${row('Calibre', 'Gauge', `${piece.gauge_mm} mm`)}
        ${row('Largo', 'Length', `${piece.length_es} <span class="pc-sub">${piece.length_en}</span>`)}
      </div>
      <div class="pc-price${asking ? ' is-ask' : ''}">
        <b lang="es">${priceEs}</b>
        <i lang="en">${priceEn}</i>
      </div>
      <div class="pc-actions">
        <a class="pc-btn pc-btn--sms" href="${this._smsHref(piece)}">
          <b lang="es">${c.inquire_es}</b><i lang="en">${c.inquire_en}</i>
        </a>
        <a class="pc-btn pc-btn--ig" href="${this.store.instagram}" target="_blank" rel="noopener noreferrer">
          ${this.store.instagramHandle}
        </a>
      </div>
      <p class="pc-phone">${this.store.name} · ${this.store.phone}</p>`;

    this.el.querySelector('.pc-close').addEventListener('click', () => this.onClose());
    this.el.dataset.show = 'true';
  }

  /**
   * `sms:<number>?&body=<text>` is the form both iOS and Android accept.
   * The message names the piece so the shop knows what's being asked about.
   */
  _smsHref(piece) {
    const es = fillTemplate(this.copy.sms_template_es, piece);
    const en = fillTemplate(this.copy.sms_template_en, piece);
    const body = encodeURIComponent(`${es}\n${en}`);
    return `sms:${this.store.sms}?&body=${body}`;
  }
}
