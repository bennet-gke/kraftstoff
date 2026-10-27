import React, { useEffect, useState } from 'react';
import { Scale, Timer, ChevronRight } from 'lucide-react';
import { describeRuleState, upcomingSteps, describeStepEvent } from '../engine/priceRules';

const STEP_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Hinweis zu den aktiven Gesetzen (Bereich "Gesetze"): Countdown bis zur nächsten erlaubten Erhöhung
 * (z.B. 12-Uhr-Regel) bzw. Entwarnung, dazu Stichtags-Änderungen der nächsten 7 Tage.
 * compact = eine Zeile fürs Radar. Ohne aktive Regel wird nichts angezeigt.
 */
export default function RuleBanner({ rules, compact = false, onOpen = null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const rule = describeRuleState(rules, now);
  const steps = upcomingSteps(rules, now, STEP_HORIZON_MS);
  if (!rule.active && steps.length === 0) return null;

  const tone = rule.active ? (rule.urgent || rule.justAfter ? 'is-soon' : rule.nextToday ? 'is-morning' : 'is-safe') : steps[0].ct > 0 ? 'is-soon' : 'is-safe';
  const Icon = rule.urgent ? Timer : Scale;
  const stepTexts = steps.slice(0, 2).map((ev) => `${ev.law.name}: ${describeStepEvent(ev, now)}`);
  const Tag = onOpen ? 'button' : 'div';
  const tagProps = onOpen ? { type: 'button', onClick: onOpen, 'aria-label': 'Gesetze öffnen' } : { role: 'note' };

  if (compact) {
    return (
      <Tag className={`noon-rule is-compact ${tone} ${onOpen ? 'is-clickable' : ''}`} {...tagProps}>
        <Icon size={14} />
        <span style={{ flex: 1, minWidth: 0 }}>{rule.active ? rule.short : stepTexts[0]}</span>
        {onOpen && <ChevronRight size={14} className="noon-rule-chevron" />}
      </Tag>
    );
  }

  return (
    <Tag className={`noon-rule ${tone} ${onOpen ? 'is-clickable' : ''}`} {...tagProps}>
      <span className="noon-rule-icon">
        <Icon size={17} />
      </span>
      <span className="noon-rule-body">
        <span className="noon-rule-kicker">{rule.active ? `Gesetz: ${rule.name}` : 'Gesetze'}</span>
        {rule.active && <strong>{rule.headline}</strong>}
        {rule.active && <span className="noon-rule-text">{rule.text}</span>}
        {stepTexts.map((t) => (
          <span key={t} className="noon-rule-text">{t}</span>
        ))}
      </span>
      {onOpen && <ChevronRight size={16} className="noon-rule-chevron" />}
    </Tag>
  );
}
