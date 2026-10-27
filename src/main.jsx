import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Schriften lokal ausliefern (offline verfügbar, keine Anfrage an Google)
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/plus-jakarta-sans/800.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import UpdateBanner from './components/UpdateBanner.jsx'
import { registerServiceWorker } from './pwa.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <UpdateBanner />
    </ErrorBoundary>
  </StrictMode>,
);

registerServiceWorker();

// Signalisiere dem Fail-Safe Watchdog in index.html den erfolgreichen Start
window.__kraftstoff_mounted = true;
try { sessionStorage.removeItem('kraftstoff_watchdog_reload'); } catch {}
