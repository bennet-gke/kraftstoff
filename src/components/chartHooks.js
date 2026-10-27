import { useEffect, useState } from 'react';

/**
 * Aktuelle Breite eines Elements. Diagramme zeichnen sich damit bei Drehung des iPhones,
 * Fenstergrößenänderung oder beim Aufklappen neu – statt mit einer festen Startbreite zu bleiben.
 */
export function useElementWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      setWidth((prev) => (Math.abs(prev - w) >= 2 ? w : prev));
    };
    if (typeof ResizeObserver === 'undefined') {
      const raf = requestAnimationFrame(measure);
      window.addEventListener('resize', measure);
      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', measure);
      };
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * Aktuelle Uhrzeit als State (tickt im Intervall und beim Zurückkehren in die App).
 * refreshKey: bei Änderung (z. B. neue Messwerte) sofort neu einlesen.
 */
export function useNow(intervalMs = 60000, refreshKey = null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const kick = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(kick);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, refreshKey]);
  return now;
}

/**
 * Zeiger-Bedienung für Diagramme (Maus, Finger, Stift) über Pointer Events.
 * Touch: Auswahl bleibt nach dem Loslassen stehen (zum Ablesen), Maus: verschwindet beim Verlassen.
 */
export function bindPointerScrub(selection, { onMove, onLeave }) {
  selection
    .style('touch-action', 'pan-y')
    .on('pointerdown', (event) => onMove(event))
    .on('pointermove', (event) => onMove(event))
    .on('pointerleave', (event) => {
      if (event.pointerType === 'mouse') onLeave();
    });
}
