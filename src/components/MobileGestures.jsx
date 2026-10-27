import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, ArrowDown } from 'lucide-react';

const isPhone = () => typeof window !== 'undefined' && window.innerWidth <= 640;
const NO_GESTURE = 'input, textarea, select, [data-no-gesture], .forecast-strip, .chart-canvas, .leaflet-container, .option-list, .segmented, .filter-pill-bar, input[type="range"]';

/**
 * Bottom-Sheets auf dem iPhone nach unten wegwischen (wie in iOS-Apps).
 * Greift nur, wenn das Sheet ganz oben ist oder am Griff gezogen wird; schließt über den
 * Hintergrund-Klick des jeweiligen Dialogs. Rendert nichts.
 */
export function SheetSwipeCloser() {
  useEffect(() => {
    let drag = null;
    const onStart = (e) => {
      if (!isPhone() || e.touches.length !== 1) return;
      const sheet = e.target.closest?.('.modal-content');
      if (!sheet || e.target.closest(NO_GESTURE)) return;
      const y = e.touches[0].clientY;
      const fromHandle = y - sheet.getBoundingClientRect().top <= 56;
      if (!fromHandle && sheet.scrollTop > 0) return;
      drag = { sheet, startY: y, dy: 0, fromHandle };
    };
    const onMove = (e) => {
      if (!drag) return;
      const dy = e.touches[0].clientY - drag.startY;
      if (!drag.fromHandle && drag.sheet.scrollTop > 0) {
        drag.sheet.style.transform = '';
        drag = null;
        return;
      }
      if (dy <= 0) {
        drag.dy = 0;
        drag.sheet.style.transform = '';
        return;
      }
      drag.dy = dy;
      drag.sheet.style.transition = 'none';
      drag.sheet.style.transform = `translateY(${dy}px)`;
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = () => {
      if (!drag) return;
      const { sheet, dy } = drag;
      drag = null;
      sheet.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
      if (dy > 110) {
        sheet.style.transform = 'translateY(100%)';
        const backdrop = sheet.closest('.modal-backdrop');
        setTimeout(() => {
          backdrop?.click();
          // Falls der Dialog gerade nicht geschlossen werden darf (z. B. während einer Berechnung)
          setTimeout(() => {
            if (sheet.isConnected) sheet.style.transform = '';
          }, 250);
        }, 160);
      } else {
        sheet.style.transform = '';
      }
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);
  return null;
}

const TRIGGER_PX = 64;

/**
 * Ziehen zum Aktualisieren (oben auf der Seite nach unten ziehen). Eigener kleiner Zustand,
 * damit nicht die ganze App bei jeder Fingerbewegung neu zeichnet.
 */
export function PullToRefresh({ enabled = true, onRefresh }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const refreshRef = useRef(onRefresh);
  const busyRef = useRef(false);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    const st = { startY: null, dist: 0 };
    const onStart = (e) => {
      if (busyRef.current || e.touches.length !== 1 || window.scrollY > 2) return;
      if (document.querySelector('.modal-backdrop') || e.target.closest?.(`${NO_GESTURE}, .drawer-card`)) return;
      st.startY = e.touches[0].clientY;
      st.dist = 0;
    };
    const onMove = (e) => {
      if (st.startY === null) return;
      const dy = e.touches[0].clientY - st.startY;
      if (dy <= 0 || window.scrollY > 2) {
        if (st.dist) setPull(0);
        st.dist = 0;
        return;
      }
      st.dist = Math.min(100, dy * 0.5);
      setPull(st.dist);
    };
    const onEnd = async () => {
      if (st.startY === null) return;
      st.startY = null;
      const d = st.dist;
      st.dist = 0;
      if (d < TRIGGER_PX) {
        setPull(0);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setPull(TRIGGER_PX);
      try {
        await refreshRef.current?.();
      } finally {
        busyRef.current = false;
        setBusy(false);
        setPull(0);
      }
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled]);

  if (!enabled || (pull <= 0 && !busy)) return null;
  const ready = pull >= TRIGGER_PX;
  return (
    <div className="ptr-indicator" style={{ transform: `translate(-50%, ${Math.round(pull * 0.6)}px)`, opacity: Math.min(1, pull / 40) }} aria-live="polite">
      {busy ? <RefreshCw size={15} className="animate-spin" /> : <ArrowDown size={15} style={{ transform: ready ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />}
      <span>{busy ? 'Aktualisiere …' : ready ? 'Loslassen zum Aktualisieren' : 'Zum Aktualisieren ziehen'}</span>
    </div>
  );
}
