import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { TrendingUp, Database } from 'lucide-react';
import { timeTickFormat, euroTickFormat } from './d3Locale';
import { useElementWidth, useNow, bindPointerScrub } from './chartHooks';
import { MAX_HOLD_MS } from '../engine/regionalTrends';
import { fmtPrice, fmtDayTime, fuelLabel } from '../utils/format';

const HOUR_MS = 60 * 60 * 1000;
const HEIGHT = 240;
const MEAN_WINDOW_MS = 24 * HOUR_MS;
const MIN_MEAN_COVERAGE_MS = 6 * HOUR_MS;
const RANGES = [[24, '24 h'], [72, '3 Tage'], [168, '7 Tage'], [336, '14 Tage']];

/**
 * Gültigkeitsabschnitte der Treppenfunktion: Ein Preis gilt bis zum nächsten Messwert,
 * höchstens aber 75 Minuten (danach ist unbekannt, was passiert ist – die App war nicht offen).
 */
function buildSegments(readings, now) {
  const segs = [];
  for (let i = 0; i < readings.length; i++) {
    const a = readings[i].t;
    if (a > now) break;
    const next = i + 1 < readings.length ? readings[i + 1].t : now;
    const b = Math.min(next, a + MAX_HOLD_MS, now);
    if (b > a) segs.push({ a, b, p: readings[i].p });
  }
  return segs;
}

/** Zeitgewichteter Mittelwert der letzten 24 h (nur bei mindestens 6 h Abdeckung). */
function trailingMeans(segs, times) {
  const out = [];
  let lo = 0;
  for (const t of times) {
    const from = t - MEAN_WINDOW_MS;
    while (lo < segs.length && segs[lo].b <= from) lo++;
    let sum = 0;
    let covered = 0;
    for (let i = lo; i < segs.length && segs[i].a < t; i++) {
      const a = Math.max(segs[i].a, from);
      const b = Math.min(segs[i].b, t);
      if (b > a) {
        sum += (b - a) * segs[i].p;
        covered += b - a;
      }
    }
    out.push({ t, mean: covered >= MIN_MEAN_COVERAGE_MS ? sum / covered : null });
  }
  return out;
}

/**
 * Echter Preisverlauf einer Tankstelle (Treppenkurve aus aufgezeichneten Messwerten) mit dem
 * zeitgewichteten 24-Stunden-Mittel. Zeiten ohne Beobachtung werden als Lücke gezeigt, nicht überbrückt.
 */
export default function PriceTrendChart({ readings = [], stationName = 'Tankstelle', fuelType = 'diesel', evaluation = null }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const width = useElementWidth(containerRef);
  const now = useNow(60000, readings);
  const [rangeHours, setRangeHours] = useState(72);
  const [hovered, setHovered] = useState(null);

  const model = useMemo(() => {
    if (!readings || readings.length === 0) return null;
    const fromMs = now - rangeHours * HOUR_MS;
    const segs = buildSegments(readings, now);
    const visible = segs.filter((s) => s.b > fromMs).map((s) => ({ ...s, a: Math.max(s.a, fromMs) }));
    if (visible.length === 0) return { visible, line: [], marks: [], means: [], coveredMs: 0, startMs: fromMs };

    const line = [];
    visible.forEach((s, i) => {
      if (i > 0 && s.a - visible[i - 1].b > 1000) line.push({ gap: true });
      line.push({ t: s.a, p: s.p });
      line.push({ t: s.b, p: s.p });
    });
    const startMs = visible[0].a;
    const marks = readings.filter((r) => r.t >= fromMs && r.t <= now);
    const step = Math.max(10 * 60 * 1000, (now - startMs) / 160);
    const times = [];
    for (let t = startMs; t < now; t += step) times.push(t);
    times.push(now);
    const means = trailingMeans(segs, times);
    const coveredMs = visible.reduce((a, s) => a + (s.b - s.a), 0);
    return { visible, line, marks, means, coveredMs, startMs };
  }, [readings, rangeHours, now]);

  const canRender = !!model && model.visible.length > 0 && (model.marks.length >= 2 || model.coveredMs >= 30 * 60 * 1000);
  const expectedNow = Number.isFinite(evaluation?.expectedNow) ? evaluation.expectedNow : null;

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    if (!canRender || !width) return;

    const margin = { top: 12, right: 12, bottom: 28, left: 54 };
    const innerWidth = Math.max(120, width - margin.left - margin.right);
    const innerHeight = HEIGHT - margin.top - margin.bottom;
    svg.attr('width', width).attr('height', HEIGHT).attr('viewBox', `0 0 ${width} ${HEIGHT}`).style('touch-action', 'pan-y');
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const { visible, line, marks, means, startMs } = model;
    const x = d3.scaleTime().domain([new Date(startMs), new Date(now)]).range([0, innerWidth]);
    const values = [...visible.map((s) => s.p), ...means.filter((m) => m.mean !== null).map((m) => m.mean)];
    if (expectedNow !== null) values.push(expectedNow);
    const minP = d3.min(values);
    const maxP = d3.max(values);
    const pad = Math.max(0.005, (maxP - minP) * 0.18);
    const y = d3.scaleLinear().domain([minP - pad, maxP + pad]).range([innerHeight, 0]);

    const yAxis = g.append('g').call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(euroTickFormat(maxP - minP + 2 * pad)));
    yAxis.select('.domain').remove();
    yAxis.selectAll('.tick line').attr('stroke', '#EEF2F7').attr('stroke-dasharray', '3 3');
    yAxis.selectAll('text').attr('fill', '#64748B').attr('font-size', '10.5px');

    const spanHours = (now - startMs) / HOUR_MS;
    const xAxis = g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(width < 520 ? 4 : 7).tickFormat(timeTickFormat(spanHours)));
    xAxis.selectAll('text').attr('fill', '#94A3B8').attr('font-size', '10.5px');
    xAxis.selectAll('.domain, .tick line').attr('stroke', '#E2E8F0');

    // 24-h-Mittel (gestrichelt)
    const meanLine = d3.line().defined((d) => d.mean !== null).x((d) => x(d.t)).y((d) => y(d.mean)).curve(d3.curveMonotoneX);
    g.append('path').datum(means).attr('fill', 'none').attr('stroke', '#94A3B8').attr('stroke-width', 1.6).attr('stroke-dasharray', '4 4').attr('d', meanLine);

    // Gemeldeter Preis als echte Treppe (Ecken explizit), Lücken bleiben offen
    const priceLine = d3.line().defined((d) => !d.gap).x((d) => x(d.t)).y((d) => y(d.p)).curve(d3.curveStepAfter);
    g.append('path').datum(line).attr('fill', 'none').attr('stroke', '#0F172A').attr('stroke-width', 2.2).attr('stroke-linejoin', 'round').attr('d', priceLine);

    if (marks.length <= 160) {
      g.selectAll('circle.reading')
        .data(marks)
        .enter()
        .append('circle')
        .attr('class', 'reading')
        .attr('cx', (d) => x(d.t))
        .attr('cy', (d) => y(d.p))
        .attr('r', 2.4)
        .attr('fill', '#0F172A')
        .attr('stroke', '#FFFFFF')
        .attr('stroke-width', 1.1);
    }

    const lastSeg = visible[visible.length - 1];
    const isCurrent = now - lastSeg.b < 60 * 1000;
    g.append('circle')
      .attr('cx', x(lastSeg.b))
      .attr('cy', y(lastSeg.p))
      .attr('r', 5)
      .attr('fill', isCurrent ? (evaluation?.isCheap ? '#059669' : evaluation?.verdict === 'EXPENSIVE' ? '#DC2626' : '#0F172A') : '#94A3B8')
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', 2);

    if (expectedNow !== null) {
      g.append('circle').attr('cx', x(now)).attr('cy', y(expectedNow)).attr('r', 5).attr('fill', '#FFFFFF').attr('stroke', '#2563EB').attr('stroke-width', 2);
    }

    const bisect = d3.bisector((s) => s.a).right;
    const crosshair = g.append('line').attr('stroke', '#64748B').attr('stroke-width', 1).attr('stroke-dasharray', '2 2').attr('y1', 0).attr('y2', innerHeight).style('opacity', 0);
    const focus = g.append('circle').attr('r', 4.5).attr('fill', '#059669').attr('stroke', '#FFFFFF').attr('stroke-width', 2).style('opacity', 0);
    const overlay = g.append('rect').attr('width', innerWidth).attr('height', innerHeight).attr('fill', 'transparent').style('cursor', 'crosshair');
    const meanAt = (t) => {
      let best = null;
      for (const m of means) {
        if (m.t > t) break;
        best = m;
      }
      return best?.mean ?? null;
    };

    bindPointerScrub(overlay, {
      onMove: (event) => {
        const [px] = d3.pointer(event, g.node());
        const t = x.invert(Math.max(0, Math.min(innerWidth, px))).getTime();
        const i = bisect(visible, t) - 1;
        const seg = i >= 0 ? visible[i] : null;
        crosshair.attr('x1', px).attr('x2', px).style('opacity', 1);
        if (!seg || t > seg.b) {
          focus.style('opacity', 0);
          setHovered({ gap: true, t });
          return;
        }
        focus.attr('cx', px).attr('cy', y(seg.p)).style('opacity', 1);
        setHovered({ t, price: seg.p, since: seg.a, mean: meanAt(t) });
      },
      onLeave: () => {
        crosshair.style('opacity', 0);
        focus.style('opacity', 0);
        setHovered(null);
      },
    });
  }, [model, canRender, width, now, evaluation, expectedNow]);

  const totalReadings = readings?.length || 0;
  const firstReadingAt = totalReadings > 0 ? readings[0].t : null;

  return (
    <div className="clean-card chart-card">
      <div className="chart-card-head">
        <div style={{ minWidth: 0 }}>
          <div className="chart-card-title">
            <TrendingUp size={16} color="#0F172A" />
            <h3>Echter Preisverlauf</h3>
          </div>
          <p className="chart-card-sub">
            {stationName} • {fuelLabel(fuelType)} • {totalReadings.toLocaleString('de-DE')} {totalReadings === 1 ? 'Messwert' : 'Messwerte'}
            {firstReadingAt ? ` seit ${new Date(firstReadingAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}` : ''}
          </p>
        </div>
        <div className="nav-pill-group" role="group" aria-label="Zeitraum">
          {RANGES.map(([h, label]) => (
            <button key={h} type="button" className={`nav-pill-btn ${rangeHours === h ? 'active' : ''}`} onClick={() => setRangeHours(h)} aria-pressed={rangeHours === h}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="chart-canvas">
        {canRender ? (
          <svg ref={svgRef} role="img" aria-label={`Preisverlauf ${stationName}`} />
        ) : (
          <div className="chart-empty">
            <Database size={22} color="#94A3B8" />
            <strong>{totalReadings === 0 ? 'Noch keine Messwerte für diese Tankstelle' : totalReadings === 1 ? 'Erst ein Messwert aufgezeichnet' : 'Kein Verlauf in diesem Zeitraum'}</strong>
            <p>
              KRAFTSTOFF speichert bei jedem Abruf den echten Zapfsäulenpreis – solange die App geöffnet ist, alle 10 Minuten. Je öfter du sie öffnest, desto vollständiger wird der Verlauf.
            </p>
          </div>
        )}
      </div>

      {canRender && (
        <div className="chart-foot">
          <div className="chart-legend">
            <span><i className="lg-line" style={{ background: '#0F172A' }} /> Gemeldeter Preis</span>
            <span><i className="lg-dash" /> Ø der letzten 24 h</span>
            {expectedNow !== null && <span><i className="lg-ring" /> Üblich um diese Uhrzeit ({fmtPrice(expectedNow)})</span>}
          </div>
          {hovered ? (
            hovered.gap ? (
              <div className="chart-readout">
                {fmtDayTime(hovered.t)} Uhr: <span className="chart-readout-sub">keine Messung (App war nicht geöffnet)</span>
              </div>
            ) : (
              <div className="chart-readout">
                {fmtDayTime(hovered.t)} Uhr:{' '}
                <span className="num-mono" style={{ color: '#059669', fontSize: '0.9rem' }}>{fmtPrice(hovered.price)}</span>{' '}
                <span className="chart-readout-sub">
                  (gemeldet seit {new Date(hovered.since).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}{hovered.mean !== null ? `, Ø 24 h ${fmtPrice(hovered.mean)}` : ''})
                </span>
              </div>
            )
          ) : (
            <div className="chart-hint">Tippe oder wische über das Diagramm für Details</div>
          )}
        </div>
      )}
    </div>
  );
}
