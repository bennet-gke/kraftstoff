/**
 * KRAFTSTOFF - Gesetze & Regeln (gespeicherte Einträge)
 *
 * Gesetzliche Rahmenbedingungen wie die 12-Uhr-Regel liegen als Einträge vor, die ein- und
 * ausgeschaltet, geändert und ergänzt werden können. Lokal in localStorage, geräteübergreifend über
 * die Datenbank-Datei abgeglichen (wie Fahrzeuge und Routen, "neuere Änderung gewinnt").
 * Ohne gespeicherte Einträge gilt die Vorlage (12-Uhr-Regel).
 */

import { DEFAULT_LAWS, KPANG_LAW, normalizeLaw } from '../engine/priceRules';

const STORAGE_KEY = 'kraftstoff_user_laws';

function copyLaw(law) {
  return { ...law, fuels: [...law.fuels], times: [...law.times] };
}

class LawService {
  constructor() {
    this.laws = this.loadLaws();
  }

  loadLaws() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) return list.map(normalizeLaw).filter(Boolean);
      }
    } catch {}
    return DEFAULT_LAWS.map(copyLaw);
  }

  saveLaws(list) {
    const seen = new Set();
    this.laws = (Array.isArray(list) ? list : [])
      .map(normalizeLaw)
      .filter((l) => l && !seen.has(l.id) && seen.add(l.id));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.laws));
    } catch (e) {
      console.warn('Konnte die Gesetze nicht speichern:', e);
    }
    return this.laws;
  }

  addLaw(data) {
    const law = normalizeLaw({ ...data, id: `law-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, builtIn: false });
    this.saveLaws([...this.laws, law]);
    return law;
  }

  updateLaw(id, patch) {
    return this.saveLaws(this.laws.map((l) => (l.id === id ? { ...l, ...patch, id: l.id, builtIn: l.builtIn } : l)));
  }

  setEnabled(id, enabled) {
    return this.updateLaw(id, { enabled: !!enabled });
  }

  deleteLaw(id) {
    return this.saveLaws(this.laws.filter((l) => l.id !== id));
  }

  /** Vorlage (12-Uhr-Regel) wieder einfügen bzw. auf den Auslieferungsstand zurücksetzen. */
  restoreTemplate() {
    const exists = this.laws.some((l) => l.id === KPANG_LAW.id);
    return this.saveLaws(exists ? this.laws.map((l) => (l.id === KPANG_LAW.id ? copyLaw(KPANG_LAW) : l)) : [copyLaw(KPANG_LAW), ...this.laws]);
  }
}

export const lawService = new LawService();
