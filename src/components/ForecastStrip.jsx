import React from 'react';
import { fmtNum, fmtPrice, fmtCt } from '../utils/format';

/** Preis im Zapfsäulen-Stil: "1,74" + hochgestellte letzte Ziffer. */
function PumpPrice({ value }) {
  const s = fmtNum(value, 3);
  return (
    <>
      {s.slice(0, -1)}
      <sup style={{ fontSize: '0.75em' }}>{s.slice(-1)}</sup>
    </>
  );
}

/**
 * Horizontaler, wischbarer 24h-Prognosestreifen (Preis je Stunde).
 * Stunde 0 ist der echte aktuelle Preis, danach Prognose aus Regionsprofil bzw. KI.
 */
export default function ForecastStrip({ forecast, compact = false }) {
  if (!forecast || !forecast.curve || forecast.curve.length === 0) return null;
  const prices = forecast.curve.map((p) => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const span = Math.max(0.005, maxP - minP);
  const barMax = compact ? 64 : 92;

  return (
    <div>
      <div className="forecast-strip-head">
        <span>{forecast.sourceLabel}</span>
        <span aria-hidden="true">← wischen →</span>
      </div>
      <div className="forecast-strip" role="list" aria-label="Preisprognose für die nächsten 24 Stunden">
        {forecast.curve.map((pt) => {
          const h = Math.round(16 + ((pt.price - minP) / span) * (barMax - 16));
          const isNow = pt.hoursAhead === 0;
          const color = pt.isLowest ? '#059669' : pt.isHighest ? '#DC2626' : isNow ? '#0F172A' : '#94A3B8';
          const strong = isNow || pt.isLowest || pt.isHighest;
          const dayStart = !isNow && pt.hour === 0;
          return (
            <div
              key={pt.hoursAhead}
              role="listitem"
              className={`forecast-col${dayStart ? ' is-day-start' : ''}`}
              title={`${pt.dayShort} ${pt.hourFormatted} Uhr: ~${fmtPrice(pt.price)} (${fmtCt(pt.relCt)} zum Tagesmittel der Station, Sicherheit ${Math.round(pt.conf * 100)} %)`}
            >
              <span className="num-mono forecast-price" style={{ color: pt.isLowest ? '#059669' : pt.isHighest ? '#DC2626' : '#475569', fontWeight: strong ? 800 : 500 }}>
                <PumpPrice value={pt.price} />
              </span>
              <div
                className="forecast-bar"
                style={{ height: `${h}px`, background: color, opacity: strong ? 1 : 0.45 + 0.45 * Math.min(1, pt.conf), boxShadow: pt.isLowest ? '0 2px 8px rgba(16,185,129,0.3)' : 'none' }}
              />
              <span className="forecast-hour" style={{ color: isNow ? '#0F172A' : pt.isLowest ? '#059669' : '#64748B', fontWeight: isNow || pt.isLowest || dayStart ? 700 : 500 }}>
                {isNow ? 'jetzt' : dayStart ? `${pt.dayShort} 0h` : `${pt.hour}h`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
