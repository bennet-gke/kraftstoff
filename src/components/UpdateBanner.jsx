import React, { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { onUpdateReady, applyUpdate } from '../pwa';

/** Hinweis "Neue Version verfügbar" (Service Worker hat ein Update geladen). */
export default function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => onUpdateReady(() => setReady(true)), []);

  if (!ready || dismissed) return null;

  return (
    <div className="update-banner" role="status">
      <RefreshCw size={14} />
      <span>Neue Version verfügbar</span>
      <button type="button" className="update-banner-btn" onClick={applyUpdate}>Aktualisieren</button>
      <button type="button" className="update-banner-close" onClick={() => setDismissed(true)} aria-label="Später">
        <X size={14} />
      </button>
    </div>
  );
}
