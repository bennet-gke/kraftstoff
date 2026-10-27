import React, { useState } from 'react';
import { Bell, BellRing, BellOff, Smartphone, Share, PlusSquare, CheckCircle, AlertTriangle, Send, Volume2, Workflow, Copy, Check, Sparkles, X, Info } from 'lucide-react';
import { notificationService } from '../services/notificationService';
import { dataService } from '../services/dataService';
import { locationService } from '../services/locationService';
import { fmtNum } from '../utils/format';
import { useEscapeToClose } from './modalHooks';

/**
 * Preisalarme: Mitteilungen erlauben und testen, Pause, Anleitung für das iPhone und
 * Apple-Kurzbefehl für Abfragen bei geschlossener App. Wird nur geöffnet gerendert.
 */
export default function PushNotificationManager({ isOpen = true, onClose, settings = null, onPause, onResume }) {
  const isIOS = notificationService.isIOS();
  const standalone = notificationService.isStandalone();
  const [permission, setPermission] = useState(() => notificationService.getPermission());
  const [activeTab, setActiveTab] = useState(() => (isIOS && !standalone ? 'ios' : 'browser'));
  const [testSent, setTestSent] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [message, setMessage] = useState(null);
  useEscapeToClose(isOpen, onClose);

  if (!isOpen) return null;

  const thresholdLabel = fmtNum(Number(settings?.alertThresholdCent) || 3, 1);
  const pausedUntilMs = settings?.pausedUntil ? new Date(settings.pausedUntil).getTime() : 0;
  const isPaused = dataService.isAlertsPaused();
  const pausedUntilText = isPaused && pausedUntilMs ? new Date(pausedUntilMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';

  const handleRequestPermission = async () => {
    setMessage(null);
    try {
      const res = await notificationService.requestPermission();
      setPermission(res);
      if (res === 'granted') notificationService.playAlertChime();
      if (res === 'denied') setMessage({ type: 'warning', text: 'Mitteilungen wurden blockiert. Du kannst sie in den System- bzw. Browser-Einstellungen für diese Seite wieder erlauben.' });
    } catch (err) {
      setMessage({ type: 'warning', text: err.message });
    }
  };

  const handleTriggerTest = async () => {
    if (permission !== 'granted') {
      handleRequestPermission();
      return;
    }
    await notificationService.sendNotification({
      title: 'Tankwart-Tipp (Test)',
      body: `So sieht ein Preisalarm aus. Er kommt, wenn die günstigste Station mindestens ${thresholdLabel} ct unter ihrem üblichen Preis oder dem Regionsmedian liegt.`,
      tag: 'test-alarm',
    });
    setTestSent(true);
    setTimeout(() => setTestSent(false), 3500);
  };

  // URL für Apple Kurzbefehle: günstigste Preise im aktiven Umkreis (nur mit eigenem Key)
  const fuelForShortcut = settings?.fuelPreference || 'diesel';
  const activeLoc = locationService.getActiveLocation() || locationService.locations[0];
  const ownKey = dataService.getStoredKey();
  const shortcutApiUrl = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${Number(activeLoc?.lat || 52.52).toFixed(4)}&lng=${Number(activeLoc?.lng || 13.41).toFixed(4)}&rad=${Math.min(25, Math.round(activeLoc?.radiusKm || 5))}&sort=price&type=${fuelForShortcut}&apikey=${ownKey || 'DEIN-TANKERKOENIG-KEY'}`;

  const handleCopyShortcutUrl = async () => {
    try {
      await navigator.clipboard.writeText(shortcutApiUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 3000);
    } catch {
      setMessage({ type: 'warning', text: 'Kopieren nicht möglich – bitte den Link markieren und manuell kopieren.' });
    }
  };

  const permissionBadge = permission === 'granted'
    ? { cls: 'badge-favorable', icon: CheckCircle, text: 'Mitteilungen erlaubt' }
    : permission === 'denied'
      ? { cls: 'badge-unfavorable', icon: AlertTriangle, text: 'Blockiert' }
      : permission === 'unsupported'
        ? { cls: 'badge-gray', icon: Info, text: isIOS ? 'Erst als Home-Bildschirm-App' : 'Nicht unterstützt' }
        : { cls: 'badge-neutral', icon: AlertTriangle, text: 'Noch nicht erlaubt' };
  const PermIcon = permissionBadge.icon;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }} role="dialog" aria-modal="true" aria-label="Preisalarme">
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <div className="modal-head-icon">
              <BellRing size={17} />
            </div>
            <div>
              <h3>Preisalarme</h3>
              <p>Hinweis mit Signalton, wenn es in deiner Gegend günstig wird</p>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Schließen">
            <X size={20} />
          </button>
        </div>

        <div className="nav-pill-group" style={{ marginBottom: '1rem' }} role="tablist">
          <button type="button" role="tab" aria-selected={activeTab === 'browser'} className={`nav-pill-btn ${activeTab === 'browser' ? 'active' : ''}`} onClick={() => setActiveTab('browser')} style={{ flex: 1, justifyContent: 'center' }}>
            <Bell size={13} />
            <span>Alarme</span>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'ios'} className={`nav-pill-btn ${activeTab === 'ios' ? 'active' : ''}`} onClick={() => setActiveTab('ios')} style={{ flex: 1, justifyContent: 'center' }}>
            <Smartphone size={13} />
            <span>iPhone</span>
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'shortcuts'} className={`nav-pill-btn ${activeTab === 'shortcuts' ? 'active' : ''}`} onClick={() => setActiveTab('shortcuts')} style={{ flex: 1, justifyContent: 'center' }}>
            <Workflow size={13} />
            <span>Kurzbefehl</span>
          </button>
        </div>

        {message && (
          <div className={`inline-msg is-${message.type}`} style={{ marginBottom: '0.85rem' }} role="status">
            <AlertTriangle size={14} />
            <span>{message.text}</span>
          </div>
        )}

        {activeTab === 'browser' && (
          <div className="panel-stack is-tight">
            <div className="notify-status">
              <div>
                <span className="notify-status-label">Mitteilungen</span>
                <span className={`badge ${permissionBadge.cls}`}>
                  <PermIcon size={12} />
                  <span>{permissionBadge.text}</span>
                </span>
              </div>
              <div className="drawer-actions">
                {permission === 'granted' ? (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => notificationService.playAlertChime()}>
                    <Volume2 size={13} />
                    <span>Ton testen</span>
                  </button>
                ) : permission !== 'unsupported' ? (
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleRequestPermission} disabled={permission === 'denied'}>
                    <Bell size={13} />
                    <span>Erlauben</span>
                  </button>
                ) : (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveTab('ios')}>
                    <Smartphone size={13} />
                    <span>So geht’s</span>
                  </button>
                )}
              </div>
            </div>

            <div className="notify-status">
              <div>
                <span className="notify-status-label">Pause</span>
                <span className={`badge ${isPaused ? 'badge-neutral' : 'badge-gray'}`}>
                  {isPaused ? <BellOff size={12} /> : <Bell size={12} />}
                  <span>{isPaused ? `Pausiert bis ${pausedUntilText} Uhr` : 'Alarme aktiv'}</span>
                </span>
              </div>
              <div className="drawer-actions">
                {isPaused ? (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onResume}>
                    <Bell size={13} />
                    <span>Fortsetzen</span>
                  </button>
                ) : (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onPause}>
                    <BellOff size={13} />
                    <span>30 Min. pausieren</span>
                  </button>
                )}
              </div>
            </div>

            <button type="button" className="btn btn-primary" onClick={handleTriggerTest} disabled={permission === 'unsupported' || permission === 'denied'} style={{ width: '100%' }}>
              {testSent ? <Check size={14} /> : <Send size={14} />}
              <span>{testSent ? 'Test-Mitteilung gesendet' : 'Test-Mitteilung senden'}</span>
            </button>

            <div className="notify-explainer">
              <div className="notify-explainer-title">
                <Sparkles size={13} color="#059669" />
                <span>So funktioniert der Preiswächter</span>
              </div>
              <p>
                Bei jedem Abruf prüft KRAFTSTOFF, ob die günstigste geöffnete Tankstelle mindestens <strong>{thresholdLabel} ct</strong> unter ihrem üblichen Preis für diese Uhrzeit oder unter dem Regionsmedian liegt. Dann gibt es Signalton und Mitteilung – pro Tankstelle höchstens einmal pro Stunde.
              </p>
              <p>
                <strong>Wichtig:</strong> Das klappt nur, solange die App geöffnet ist (auf dem Mac auch im Hintergrund-Tab). Für Hinweise bei geschlossener App gibt es den Kurzbefehl-Trick im dritten Reiter.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'ios' && (
          <div className="panel-stack is-tight">
            <div className="inline-msg is-info">
              <Smartphone size={15} />
              <span>
                {standalone
                  ? 'KRAFTSTOFF läuft bereits als Home-Bildschirm-App – Mitteilungen kannst du im Reiter „Alarme“ erlauben.'
                  : 'Apple erlaubt Mitteilungen von Web-Apps nur, wenn sie auf dem Home-Bildschirm liegen (ab iOS 16.4):'}
              </span>
            </div>
            {[
              { n: 1, title: 'In Safari auf „Teilen“ tippen', sub: 'Das Viereck mit dem Pfeil nach oben', icon: <Share size={13} color="#2563EB" /> },
              { n: 2, title: '„Zum Home-Bildschirm“ wählen', sub: 'Legt das KRAFTSTOFF-Symbol an', icon: <PlusSquare size={13} color="#059669" /> },
              { n: 3, title: 'App vom Home-Bildschirm öffnen', sub: 'Dann hier unter „Alarme“ auf „Erlauben“ tippen und bestätigen' },
            ].map((step) => (
              <div key={step.n} className="step-row">
                <span className="step-num">{step.n}</span>
                <div>
                  <strong>{step.title}</strong>
                  <span>{step.sub} {step.icon}</span>
                </div>
              </div>
            ))}
            <p className="settings-note">Der Signalton funktioniert auf dem iPhone, nachdem du einmal irgendwo in die App getippt hast, und nur bei ausgeschaltetem Stummschalter.</p>
          </div>
        )}

        {activeTab === 'shortcuts' && (
          <div className="panel-stack is-tight">
            <div className="inline-msg is-success">
              <Workflow size={15} />
              <span>Die Kurzbefehle-App kann auch bei geschlossener App zu einer festen Uhrzeit (z. B. abends) die günstigsten Tankstellen abfragen und dir eine Mitteilung schicken – ohne eigenen Server.</span>
            </div>

            {!ownKey && (
              <div className="inline-msg is-warning">
                <AlertTriangle size={14} />
                <span>Dafür brauchst du einen eigenen Tankerkönig-Key (Einstellungen). Im Link steht sonst ein Platzhalter.</span>
              </div>
            )}

            <div className="field">
              <span className="field-label">Abfrage-Link für {activeLoc?.name || 'deinen Standort'} ({fuelForShortcut.toUpperCase()})</span>
              <div className="input-with-btn">
                <input className="text-input is-mono" readOnly value={shortcutApiUrl} onFocus={(e) => e.target.select()} aria-label="Abfrage-Link" />
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopyShortcutUrl}>
                  {copiedUrl ? <Check size={12} color="#059669" /> : <Copy size={12} />}
                  <span>{copiedUrl ? 'Kopiert' : 'Kopieren'}</span>
                </button>
              </div>
              <span className="field-hint">Der Link enthält deinen persönlichen Key – nicht öffentlich teilen.</span>
            </div>

            <div className="settings-note" style={{ lineHeight: 1.6 }}>
              <strong style={{ color: '#0F172A' }}>Einrichten in der Kurzbefehle-App:</strong>
              <ol style={{ paddingLeft: '1.2rem', marginTop: '0.35rem' }}>
                <li>„Automation“ → „Neue Automation“ → „Tageszeit“ (z. B. täglich 19:00).</li>
                <li>Aktion „Inhalte von URL abrufen“ mit dem kopierten Link.</li>
                <li>Aktion „Wörterbuchwert abrufen“: Schlüssel <code>stations</code>.</li>
                <li>Aktion „Objekt aus Liste abrufen“: erstes Objekt.</li>
                <li>Zwei Mal „Wörterbuchwert abrufen“: <code>name</code> und <code>price</code>.</li>
                <li>Aktion „Mitteilung anzeigen“ mit Name und Preis – fertig.</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
