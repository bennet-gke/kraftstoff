import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Calendar, Clock, TrendingDown, TrendingUp, Sparkles, Car } from 'lucide-react';
import { DAY_NAMES, DAY_SHORT, toMondayIndex, deriveTopWindows, computeCommuteShiftSavings, profileAnchorPrice } from '../engine/regionalTrends';
import { useElementWidth, useNow, bindPointerScrub } from './chartHooks';
import { euroTickFormat, ctTickFormat } from './d3Locale';
import { fmtCt, fmtPrice, fmtEuro, fmtNum } from '../utils/format';
import { activeIncreaseRules, timesLabel } from '../engine/priceRules';

const HEIGHT = 240;
const QUALITY_LABEL = { good: 'Belastbar', ok: 'Solide', thin: 'Noch dünn', none: 'Erfahrungswerte' };

/**
 * Die typische Woche der Region (168 Stunden) – gelernt aus echten Messwerten aller Tankstellen
 * im Bereich, bei dünner Datenlage geglättet mit Erfahrungswerten des deutschen Marktes.
 * Euro-Werte sind am aktuellen Regionsmedian verankert (die aktuelle Stunde entspricht dem Median jetzt).
 */
export default function WeeklyProfileChart({ profile, regionMedian = null, windows = null, settings = null, activeVehicle = null, rules = null }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const width = useElementWidth(containerRef);
  const now = useNow(60000);
  const [hovered, setHovered] = useState(null);

  const anchor = useMemo(() => profileAnchorPrice(profile, regionMedian, now), [profile, regionMedian, now]);
  // Erlaubte Erhöhungszeitpunkte laut aktiver Gesetze (z.B. 12-Uhr-Regel)
  const ruleMinutes = activeIncreaseRules(rules, now)[0]?.minutes || [];
  const ruleKey = ruleMinutes.join(',');
  const useEuro = Number.isFinite(anchor);

  const hourly = useMemo(() => {
    if (!profile) return [];
    const out = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const c = profile.cells[d][h];
        const hourDays = profile.hourOfDay?.[h]?.days || 0;
        out.push({
          index: d * 24 + h,
          day: d,
          hour: h,
          est: c.est,
          conf: c.conf,
          n: c.n,
          days: c.days || 0,
          sd: c.sd,
          observed: !!c.observed,
          learned: (c.observed || hourDays >= 2) && c.conf >= 0.3,
          value: useEuro ? anchor + c.est / 100 : c.est,
        });
      }
    }
    return out;
  }, [profile, anchor, useEuro]);

  const topWindows = useMemo(() => deriveTopWindows(profile, 2), [profile]);
  const commute = useMemo(() => computeCommuteShiftSavings(profile, settings), [profile, settings]);
  const tankLiters = Number(activeVehicle?.tankCapacityL) || 45;

  const nowDate = new Date(now);
  const currentIndex = toMondayIndex(nowDate.getDay()) * 24 + nowDate.getHours();
  const currentDay = Math.floor(currentIndex / 24);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    if (!width || hourly.length === 0) return;

    const margin = { top: 12, right: 8, bottom: 26, left: useEuro ? 52 : 46 };
    const innerWidth = Math.max(120, width - margin.left - margin.right);
    const innerHeight = HEIGHT - margin.top - margin.bottom;
    svg.attr('width', width).attr('height', HEIGHT).attr('viewBox', `0 0 ${width} ${HEIGHT}`).style('touch-action', 'pan-y');
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([0, 168]).range([0, innerWidth]);
    const toUnit = (ct) => (useEuro ? ct / 100 : ct);
    const vals = [];
    for (const d of hourly) {
      vals.push(d.value);
      if (d.sd !== null && d.days >= 2) vals.push(d.value - toUnit(d.sd), d.value + toUnit(d.sd));
    }
    const minV = d3.min(vals);
    const maxV = d3.max(vals);
    const pad = (maxV - minV) * 0.15 || (useEuro ? 0.01 : 1);
    const y = d3.scaleLinear().domain([minV - pad, maxV + pad]).range([innerHeight, 0]);

    // Wochentags-Bänder
    const dayW = innerWidth / 7;
    for (let d = 0; d < 7; d++) {
      const x0 = x(d * 24);
      if (d === currentDay) g.append('rect').attr('x', x0).attr('y', 0).attr('width', dayW).attr('height', innerHeight).attr('fill', '#F0FDF4');
      else if (d % 2 === 1) g.append('rect').attr('x', x0).attr('y', 0).attr('width', dayW).attr('height', innerHeight).attr('fill', '#F8FAFC');
      if (d > 0) g.append('line').attr('x1', x0).attr('x2', x0).attr('y1', 0).attr('y2', innerHeight).attr('stroke', '#E2E8F0');
      g.append('text')
        .attr('x', x0 + dayW / 2)
        .attr('y', innerHeight + 18)
        .attr('text-anchor', 'middle')
        .attr('fill', d === currentDay ? '#0F172A' : '#94A3B8')
        .attr('font-size', '11px')
        .attr('font-weight', d === currentDay ? 700 : 500)
        .text(DAY_SHORT[d]);
    }

    const span = y.domain()[1] - y.domain()[0];
    const yAxis = g.append('g').call(d3.axisLeft(y).ticks(4).tickSize(-innerWidth).tickFormat(useEuro ? euroTickFormat(span) : ctTickFormat()));
    yAxis.select('.domain').remove();
    yAxis.selectAll('.tick line').attr('stroke', '#E9EEF5').attr('stroke-dasharray', '3 3');
    yAxis.selectAll('text').attr('fill', '#64748B').attr('font-size', '10px');

    // Nächstes günstiges Fenster (auch über den Wochenwechsel hinweg)
    const nw = windows?.nextWindow;
    if (nw?.start && nw?.end) {
      const sIdx = nw.start.dayIndex * 24 + nw.start.hour;
      const eIdx = nw.end.dayIndex * 24 + nw.end.hour + 1;
      const spans = eIdx > sIdx ? [[sIdx, eIdx]] : [[sIdx, 168], [0, eIdx]];
      spans.forEach(([a, b]) => {
        g.append('rect').attr('x', x(a)).attr('y', 0).attr('width', Math.max(2, x(b) - x(a))).attr('height', innerHeight).attr('fill', '#10B981').attr('opacity', 0.14);
      });
    }

    // Gesetze: erlaubte Erhöhungszeitpunkte je Tag
    const slotHours = ruleKey ? ruleKey.split(',').map((m) => Number(m) / 60) : [];
    for (let d = 0; d < 7; d++) {
      for (const h of slotHours) {
        g.append('line').attr('x1', x(d * 24 + h)).attr('x2', x(d * 24 + h)).attr('y1', 0).attr('y2', innerHeight)
          .attr('stroke', '#F59E0B').attr('stroke-width', 1).attr('stroke-dasharray', '1 3').attr('opacity', 0.9);
      }
    }

    const cx = (d) => x(d.index + 0.5);
    // Streuung der beobachteten Tage
    const band = d3.area()
      .defined((d) => d.sd !== null && d.days >= 2)
      .x(cx)
      .y0((d) => y(d.value - toUnit(d.sd)))
      .y1((d) => y(d.value + toUnit(d.sd)))
      .curve(d3.curveMonotoneX);
    g.append('path').datum(hourly).attr('fill', '#CBD5E1').attr('opacity', 0.35).attr('d', band);

    // Gesamtverlauf (inkl. Erfahrungswerte) gestrichelt, gelernter Anteil durchgezogen
    const lineAll = d3.line().x(cx).y((d) => y(d.value)).curve(d3.curveMonotoneX);
    g.append('path').datum(hourly).attr('fill', 'none').attr('stroke', '#94A3B8').attr('stroke-width', 1.4).attr('stroke-dasharray', '3 3').attr('d', lineAll);
    const lineLearned = d3.line().defined((d) => d.learned).x(cx).y((d) => y(d.value)).curve(d3.curveMonotoneX);
    g.append('path').datum(hourly).attr('fill', 'none').attr('stroke', '#0F172A').attr('stroke-width', 2.2).attr('stroke-linejoin', 'round').attr('d', lineLearned);

    const cur = hourly[currentIndex];
    if (cur) {
      g.append('line').attr('x1', cx(cur)).attr('x2', cx(cur)).attr('y1', 0).attr('y2', innerHeight).attr('stroke', '#059669').attr('stroke-width', 1.5).attr('stroke-dasharray', '3 3');
      g.append('circle').attr('cx', cx(cur)).attr('cy', y(cur.value)).attr('r', 5).attr('fill', '#059669').attr('stroke', '#FFFFFF').attr('stroke-width', 2);
    }

    const crosshair = g.append('line').attr('stroke', '#64748B').attr('stroke-width', 1).attr('stroke-dasharray', '2 2').attr('y1', 0).attr('y2', innerHeight).style('opacity', 0);
    const dot = g.append('circle').attr('r', 4.5).attr('fill', '#0F172A').attr('stroke', '#FFFFFF').attr('stroke-width', 2).style('opacity', 0);
    const overlay = g.append('rect').attr('width', innerWidth).attr('height', innerHeight).attr('fill', 'transparent').style('cursor', 'crosshair');
    bindPointerScrub(overlay, {
      onMove: (event) => {
        const [px] = d3.pointer(event, g.node());
        const idx = Math.min(167, Math.max(0, Math.floor(x.invert(px))));
        const p = hourly[idx];
        if (!p) return;
        crosshair.attr('x1', cx(p)).attr('x2', cx(p)).style('opacity', 1);
        dot.attr('cx', cx(p)).attr('cy', y(p.value)).style('opacity', 1);
        setHovered(p);
      },
      onLeave: () => {
        crosshair.style('opacity', 0);
        dot.style('opacity', 0);
        setHovered(null);
      },
    });
  }, [hourly, width, currentIndex, currentDay, windows, useEuro, ruleKey]);

  if (!profile) return null;

  const currentPoint = hourly[currentIndex];
  const quality = profile.dataQuality || 'none';
  const thin = quality === 'none' || quality === 'thin';
  const days = profile.distinctDays || 0;
  const hourRange = (h) => `${h}:00–${(h + 1) % 24}:00 Uhr`;

  let commuteBlock = null;
  if (commute) {
    const s = commute.savingsCentPerLiter;
    const title = s >= 0.3 ? 'Abends statt morgens tanken' : s <= -0.3 ? 'Morgens statt abends tanken' : 'Morgens oder abends – kaum Unterschied';
    const euro = (Math.abs(s) * tankLiters) / 100;
    commuteBlock = (
      <div className="commute-card">
        <div className="commute-card-main">
          <div className="commute-card-icon">
            <Car size={18} />
          </div>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: '0.85rem', color: '#0F172A' }}>{activeVehicle?.name || 'Pendeln'}: {title}</strong>
            <p style={{ fontSize: '0.74rem', color: '#475569', margin: '0.15rem 0 0' }}>
              Morgens ({settings?.commuteMorningStart || '07:30'}–{settings?.commuteMorningEnd || '08:45'}): {fmtCt(commute.morningRelCt)} • abends ({settings?.commuteEveningStart || '16:30'}–{settings?.commuteEveningEnd || '18:45'}): {fmtCt(commute.eveningRelCt)}
              {quality === 'none' ? ' • laut Erfahrungswerten' : ''}
            </p>
          </div>
        </div>
        {Math.abs(s) >= 0.3 && (
          <div className="commute-card-figures">
            <div>
              <span>Pro Liter</span>
              <strong className="num-mono" style={{ color: '#059669' }}>{fmtNum(Math.abs(s), 1)} ct</strong>
            </div>
            <div>
              <span>Pro Tankfüllung ({tankLiters} L)</span>
              <strong className="num-mono" style={{ color: '#2563EB' }}>{fmtEuro(euro)}</strong>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="clean-card chart-card">
      <div className="chart-card-head">
        <div style={{ minWidth: 0 }}>
          <div className="chart-card-title">
            <Calendar size={16} color="#0F172A" />
            <h3>Die typische Woche der Region</h3>
            <span className={`chart-chip ${thin ? 'is-warn' : 'is-info'}`}>
              {profile.totalSamples > 0
                ? `${QUALITY_LABEL[quality]}: ${profile.totalSamples.toLocaleString('de-DE')} Stundenwerte • ${profile.stationsUsed} Stationen • ${days} ${days === 1 ? 'Tag' : 'Tage'}`
                : 'Erfahrungswerte – noch keine eigenen Messdaten'}
            </span>
          </div>
          <p className="chart-card-sub">
            Gelernt aus den echten Preisen aller Tankstellen im Bereich, bereinigt um das Preisniveau der einzelnen Station.
            {useEuro ? ` Euro-Werte bezogen auf den aktuellen Regionsmedian (${fmtPrice(regionMedian)}).` : ''}
            {!profile.weekdaysResolved && profile.totalSamples > 0 ? ' Wochentage werden erst unterschieden, wenn jeder mindestens zweimal gemessen wurde.' : ''}
          </p>
        </div>

        {currentPoint && windows && (
          <div className={`badge ${windows.phase === 'GÜNSTIG' ? 'badge-favorable' : windows.phase === 'TEUER' ? 'badge-unfavorable' : 'badge-neutral'}`} style={{ padding: '0.35rem 0.65rem' }}>
            {windows.phase === 'GÜNSTIG' ? <Sparkles size={13} /> : <Clock size={13} />}
            <span>
              Jetzt: <strong>{windows.phase === 'GÜNSTIG' ? 'günstige Phase' : windows.phase === 'TEUER' ? 'teure Phase' : 'Mittelfeld'}</strong> ({fmtCt(currentPoint.est)})
            </span>
          </div>
        )}
      </div>

      {commuteBlock}

      <div ref={containerRef} className="chart-canvas">
        <svg ref={svgRef} role="img" aria-label="Typischer Preisverlauf über die Woche" />
      </div>

      <div className="chart-foot">
        <div className="chart-legend">
          <span><i className="lg-line" style={{ background: '#0F172A' }} /> Gelernt (eigene Daten)</span>
          <span><i className="lg-dash" /> Erfahrungswerte</span>
          <span><i className="lg-box" style={{ background: '#D1FAE5' }} /> Nächstes günstiges Fenster</span>
          {ruleMinutes.length > 0 && (
            <span><i className="lg-dash" style={{ borderTopColor: '#F59E0B' }} /> {timesLabel(ruleMinutes)}: {ruleMinutes.length === 1 ? 'einzige erlaubte Erhöhung' : 'erlaubte Erhöhungen'}</span>
          )}
        </div>
        {hovered ? (
          <div className="chart-readout">
            {DAY_NAMES[hovered.day]}, {hourRange(hovered.hour)}:{' '}
            <span className="num-mono" style={{ color: hovered.est < 0 ? '#059669' : hovered.est > 0 ? '#DC2626' : '#0F172A' }}>
              {useEuro ? `~${fmtPrice(hovered.value)}` : fmtCt(hovered.est)}
            </span>{' '}
            <span className="chart-readout-sub">
              ({useEuro ? `${fmtCt(hovered.est)}, ` : ''}{hovered.observed ? `${hovered.days} ${hovered.days === 1 ? 'Tag' : 'Tage'} gemessen` : hovered.learned ? 'Tagesmuster gelernt' : 'Erfahrungswert'})
            </span>
          </div>
        ) : (
          <div className="chart-hint">Tippe oder wische über das Diagramm für einzelne Stunden</div>
        )}
      </div>

      {(topWindows.cheap.length > 0 || topWindows.expensive.length > 0) && (
        <div className="window-grid">
          {[...topWindows.cheap.map((w) => ({ ...w, type: 'CHEAP' })), ...topWindows.expensive.map((w) => ({ ...w, type: 'EXPENSIVE' }))].map((win) => (
            <div key={`${win.type}-${win.day}-${win.hour}`} className={`window-card ${win.type === 'CHEAP' ? 'is-cheap' : 'is-dear'}`}>
              <div className="window-card-head">
                <span>
                  {win.type === 'CHEAP' ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
                  {win.type === 'CHEAP' ? 'Günstiges Fenster' : 'Teure Spitze'}
                </span>
                <strong className="num-mono">{fmtCt(win.est)}</strong>
              </div>
              <div className="window-card-label">{win.label}</div>
              <p>
                {win.days > 0 ? `${win.days} ${win.days === 1 ? 'Tag' : 'Tage'} gemessen • Sicherheit ${Math.round(win.conf * 100)} %` : 'Erfahrungswert, noch nicht gemessen'}
                {useEuro ? ` • ~${fmtPrice(anchor + win.est / 100)}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
