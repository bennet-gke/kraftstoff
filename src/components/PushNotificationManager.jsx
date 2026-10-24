import React, { useState, useEffect } from 'react';
import {
  Bell,
  BellRing,
  Smartphone,
  Share,
  PlusSquare,
  CheckCircle,
  AlertTriangle,
  Send,
  Volume2,
  Workflow,
  Copy,
  Check,
  Sparkles,
} from 'lucide-react';
import { notificationService } from '../services/notificationService';
import { dataService } from '../services/dataService';
import { locationService } from '../services/locationService';

export default function PushNotificationManager({ isOpen, onClose }) {
  const [permission, setPermission] = useState('default');
  const [testSent, setTestSent] = useState(false);
  const [activeTab, setActiveTab] = useState('browser'); // 'browser' | 'ios' | 'shortcuts'
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && isOpen) {
      setPermission(notificationService.getPermission());

      const userAgent = window.navigator.userAgent.toLowerCase();
      const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
      if (isIosDevice) {
        setActiveTab('ios');
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRequestPermission = async () => {
    try {
      const res = await notificationService.requestPermission();
      setPermission(res);
      if (res === 'granted') {
        notificationService.playAlertChime();
      }
    } catch (err) {
      alert(`Hinweis: ${err.message}`);
    }
  };

  const handleTriggerTest = () => {
    if (permission !== 'granted') {
      handleRequestPermission();
      return;
    }

    notificationService.sendNotification({
      title: 'KRAFTSTOFF Alarm ⚡️ JET Tankstelle',
      body: 'Diesel ist soeben auf 1,63⁹ € gefallen (4,2 ct unter Marktschnitt). Jetzt tanken!',
      tag: 'test-alarm',
      playChime: true,
    });

    setTestSent(true);
    setTimeout(() => setTestSent(false), 3500);
  };

  // Beispiel-URL für Apple Kurzbefehl / Shortcuts
  const activeLoc = locationService.getActiveLocation() || locationService.locations[0];
  const creds = dataService.getCredentials();
  const apiKey = creds.tankerkoenigApiKey || '00000000-0000-0000-0000-000000000002';
  const shortcutApiUrl = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${activeLoc?.lat || 52.52}&lng=${activeLoc?.lng || 13.41}&rad=5&sort=price&type=diesel&apikey=${apiKey}`;

  const handleCopyShortcutUrl = () => {
    navigator.clipboard.writeText(shortcutApiUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 3000);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid #F1F5F9', paddingBottom: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ background: '#0F172A', color: '#FFFFFF', padding: '0.4rem', borderRadius: '8px' }}>
              <BellRing size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A' }}>
                Preisalarme & Benachrichtigungen
              </h3>
              <p style={{ fontSize: '0.76rem', color: '#64748B' }}>
                Echtzeit-Mitteilungen bei Preistiefststand auf Mac, PC & iPhone
              </p>
            </div>
          </div>
          
          <button onClick={onClose} className="btn btn-secondary btn-sm">
            Schließen
          </button>
        </div>

        {/* Tab-Navigation für Benachrichtigungsmethoden */}
        <div className="nav-pill-group" style={{ marginBottom: '1.25rem', width: '100%' }}>
          <button
            className={`nav-pill-btn ${activeTab === 'browser' ? 'active' : ''}`}
            onClick={() => setActiveTab('browser')}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <Bell size={13} />
            <span>Browser & PWA</span>
          </button>
          <button
            className={`nav-pill-btn ${activeTab === 'ios' ? 'active' : ''}`}
            onClick={() => setActiveTab('ios')}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <Smartphone size={13} />
            <span>iPhone Safari Guide</span>
          </button>
          <button
            className={`nav-pill-btn ${activeTab === 'shortcuts' ? 'active' : ''}`}
            onClick={() => setActiveTab('shortcuts')}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <Workflow size={13} />
            <span>Apple Kurzbefehle</span>
          </button>
        </div>

        {/* TAB 1: BROWSER & DIREKT-ALARM */}
        {activeTab === 'browser' && (
          <div>
            {/* Status-Karte */}
            <div
              style={{
                border: '1px solid #E2E8F0',
                borderRadius: '10px',
                padding: '1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '1rem',
                background: '#FFFFFF',
                flexWrap: 'wrap',
                gap: '0.75rem',
              }}
            >
              <div>
                <span style={{ fontSize: '0.72rem', color: '#94A3B8', textTransform: 'uppercase', fontWeight: 600 }}>
                  System-Berechtigung
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
                  <span
                    className={`badge ${
                      permission === 'granted'
                        ? 'badge-favorable'
                        : permission === 'denied'
                        ? 'badge-unfavorable'
                        : 'badge-neutral'
                    }`}
                  >
                    {permission === 'granted' ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                    <span>
                      {permission === 'granted'
                        ? 'Mitteilungen sind aktiv'
                        : permission === 'denied'
                        ? 'Vom Browser blockiert'
                        : 'Noch nicht angefordert'}
                    </span>
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {permission !== 'granted' ? (
                  <button className="btn btn-primary btn-sm" onClick={handleRequestPermission}>
                    <Bell size={13} />
                    <span>Jetzt aktivieren</span>
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => notificationService.playAlertChime()}
                    title="Gong probehören"
                  >
                    <Volume2 size={13} />
                    <span>Signalton testen</span>
                  </button>
                )}
              </div>
            </div>

            {/* Testalarm Box */}
            <div
              style={{
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '10px',
                padding: '1rem',
                marginBottom: '1.25rem',
              }}
            >
              <h4 style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0F172A', marginBottom: '0.35rem' }}>
                Test-Preisalarm auslösen
              </h4>
              <p style={{ fontSize: '0.76rem', color: '#64748B', lineHeight: 1.5, marginBottom: '0.85rem' }}>
                Löse eine echte Banner-Mitteilung inklusive akustischem Chime-Gong aus, um das Benachrichtigungsverhalten auf deinem Mac oder iPhone zu prüfen:
              </p>

              <button
                className="btn btn-primary"
                onClick={handleTriggerTest}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <Send size={14} />
                <span>{testSent ? '✓ Banner & Ton abgespielt!' : 'Mitteilungs-Banner jetzt testen'}</span>
              </button>
            </div>

            {/* Funktionsweise */}
            <div style={{ fontSize: '0.74rem', color: '#64748B', background: '#FFFFFF', border: '1px solid #F1F5F9', borderRadius: '8px', padding: '0.85rem' }}>
              <div style={{ fontWeight: 600, color: '#0F172A', marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Sparkles size={13} color="#059669" />
                <span>Automatischer Live-Preiswächter</span>
              </div>
              Sobald KRAFTSTOFF neue Zapfsäulenpreise abruft und eine Tankstelle mindestens <strong>3,0 Cent unter dem Marktschnitt</strong> liegt oder den Tages-Tiefstwert erreicht, ertönt der Signalton und ein Mitteilungsbanner erscheint automatisch.
            </div>
          </div>
        )}

        {/* TAB 2: IPHONE SAFARI ANLEITUNG */}
        {activeTab === 'ios' && (
          <div>
            <div
              style={{
                background: '#EFF6FF',
                border: '1px solid #BFDBFE',
                borderRadius: '10px',
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.4rem' }}>
                <Smartphone size={16} color="#1D4ED8" />
                <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1E3A8A' }}>
                  Apple iOS Regel: "Zum Home-Bildschirm"
                </h4>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#1E40AF', lineHeight: 1.5 }}>
                Apple erlaubt auf dem iPhone (seit iOS 16.4) Web-Mitteilungen nur dann, wenn die App als PWA auf dem Home-Bildschirm abgelegt wurde:
              </p>
            </div>

            {/* 3 Schritte */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '0.75rem' }}>
                <div style={{ background: '#0F172A', color: '#FFFFFF', width: '22px', height: '22px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>
                  1
                </div>
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
                    Im Safari-Browser unten auf "Teilen" tippen
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem' }}>
                    <span>Das Viereck mit dem Pfeil nach oben</span>
                    <Share size={13} color="#2563EB" />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '0.75rem' }}>
                <div style={{ background: '#0F172A', color: '#FFFFFF', width: '22px', height: '22px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>
                  2
                </div>
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
                    "Zum Home-Bildschirm" auswählen
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem' }}>
                    <span>Erzeugt das KRAFTSTOFF-App Icon auf deinem iPhone</span>
                    <PlusSquare size={13} color="#059669" />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '0.75rem' }}>
                <div style={{ background: '#0F172A', color: '#FFFFFF', width: '22px', height: '22px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>
                  3
                </div>
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
                    App vom Home-Screen öffnen & "Erlauben" bestätigen
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#64748B', marginTop: '0.15rem' }}>
                    iOS behandelt KRAFTSTOFF jetzt wie eine native App aus dem App Store und liefert Sperrbildschirm-Mitteilungen zuverlässig aus!
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: APPLE KURZBEFEHLE (100% Nativ & Hintergrund) */}
        {activeTab === 'shortcuts' && (
          <div>
            <div
              style={{
                background: '#F0FDF4',
                border: '1px solid #BBF7D0',
                borderRadius: '10px',
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.35rem' }}>
                <Workflow size={16} color="#15803D" />
                <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#166534' }}>
                  Die 0€-Serverlose Geheimwaffe: Apple Kurzbefehle
                </h4>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#14532D', lineHeight: 1.5 }}>
                Wenn die Web-App komplett geschlossen ist, kann Apple iOS trotzdem vollautomatisch jeden Tag um 17:30 Uhr (statistisch günstigste Tankzeit) deine Tankstellen abfragen und dir eine Benachrichtigung aufs iPhone schicken – ganz ohne eigenen Server!
              </p>
            </div>

            <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '0.85rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0F172A', marginBottom: '0.4rem' }}>
                Deine fertige Tankerkönig API-Abfrage für iOS Kurzbefehle:
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#F8FAFC', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                <span className="num-mono" style={{ fontSize: '0.7rem', color: '#334155', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {shortcutApiUrl}
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleCopyShortcutUrl}
                  style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem', flexShrink: 0 }}
                >
                  {copiedUrl ? <Check size={12} color="#059669" /> : <Copy size={12} />}
                  <span>{copiedUrl ? 'Kopiert!' : 'Kopieren'}</span>
                </button>
              </div>
            </div>

            {/* Schritt-für-Schritt */}
            <div style={{ fontSize: '0.76rem', color: '#475569', lineHeight: 1.6 }}>
              <strong>In 2 Minuten in der Apple "Kurzbefehle"-App einrichten:</strong>
              <ol style={{ paddingLeft: '1.2rem', marginTop: '0.35rem' }}>
                <li>Öffne die vorinstallierte <strong>Kurzbefehle-App</strong> auf deinem iPhone oder Mac.</li>
                <li>Tippe unten auf <strong>"Automation"</strong> ➔ <strong>"Neue Automation"</strong>.</li>
                <li>Wähle <strong>"Tageszeit"</strong> (z.B. täglich 17:30 Uhr oder wenn du Feierabend hast).</li>
                <li>Füge die Aktion <strong>"Inhalte von URL abrufen"</strong> hinzu (mit der oben kopierten URL).</li>
                <li>Füge die Aktion <strong>"Mitteilung anzeigen"</strong> hinzu. Fertig!</li>
              </ol>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
