import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Activity, Database } from 'lucide-react';
import { timeTickFormat, euroTickFormat } from './d3Locale';
import { useElementWidth, bindPointerScrub } from './chartHooks';
import { fmtPrice, fmtDayTime, fuelLabel } from '../utils/format';

const HEIGHT = 250;
const RANGES = [[24, '24 h'], [72, '3 Tage'], [168, '7 Tage'], [336, '14 Tage']];

/**
 * Regionaler Preisindex: Median (Linie) sowie Spanne Min–Max (Fläche) aller Tankstellen
 * des Bereichs über die Zeit – aus echten Messwerten. Zeiten ohne Messung bleiben als Lücke sichtbar.
 */
export default function RegionalIndexChart({ series = [], fuelType = 'diesel', regionLabel = '', rangeHours = 72, onChangeRange, stationCount = 0 }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const width = useElementWidth(containerRef);
  const [hovered, setHovered] = useState(null);
  const canRender = series.length >= 2;

  const stepMs = useMemo(() => {
    let min = Infinity;
    for (let i = 1; i < series.length; i++) min = Math.min(min, series[i].t - series[i - 1].t);
    return Number.isFinite(min) ? min : 0;
  }, [series]);

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

    // Lückenmarker einfügen, damit Linien bei fehlenden Messungen unterbrochen werden
    const lineData = [];
    for (const d of series) {
      if (d.gapBefore) lineData.push({ gap: true });
      lineData.push(d);
    }
    const defined = (d) => !d.gap;

    const x = d3.scaleTime().domain(d3.extent(series, (d) => d.date)).range([0, innerWidth]);
    const minP = d3.min(series, (d) => d.min);
    const maxP = d3.max(series, (d) => d.max);
    const pad = Math.max(0.005, (maxP - minP) * 0.12);
    const y = d3.scaleLinear().domain([minP - pad, maxP + pad]).range([innerHeight, 0]);

    const yAxis = g.append('g').call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(euroTickFormat(maxP - minP + 2 * pad)));
    yAxis.select('.domain').remove();
    yAxis.selectAll('.tick line').attr('stroke', '#EEF2F7').attr('stroke-dasharray', '3 3');
    yAxis.selectAll('text').attr('fill', '#64748B').attr('font-size', '10.5px');

    const spanHours = (series[series.length - 1].t - series[0].t) / 3600000;
    const xAxis = g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(width < 520 ? 4 : 7).tickFormat(timeTickFormat(Math.min(rangeHours, spanHours))));
    xAxis.selectAll('text').attr('fill', '#94A3B8').attr('font-size', '10.5px');
    xAxis.selectAll('.domain, .tick line').attr('stroke', '#E2E8F0');

    // Spanne Min–Max als Fläche (Treppenverlauf)
    const area = d3.area().defined(defined).x((d) => x(d.date)).y0((d) => y(d.min)).y1((d) => y(d.max)).curve(d3.curveStepAfter);
    g.append('path').datum(lineData).attr('fill', '#DBEAFE').attr('opacity', 0.75).attr('d', area);
    const minLine = d3.line().defined(defined).x((d) => x(d.date)).y((d) => y(d.min)).curve(d3.curveStepAfter);
    g.append('path').datum(lineData).attr('fill', 'none').attr('stroke', '#059669').attr('stroke-width', 1.4).attr('d', minLine);
    const medLine = d3.line().defined(defined).x((d) => x(d.date)).y((d) => y(d.median)).curve(d3.curveStepAfter);
    g.append('path').datum(lineData).attr('fill', 'none').attr('stroke', '#0F172A').attr('stroke-width', 2.2).attr('d', medLine);

    const last = series[series.length - 1];
    g.append('circle').attr('cx', x(last.date)).attr('cy', y(last.median)).attr('r', 4.5).attr('fill', '#0F172A').attr('stroke', '#FFFFFF').attr('stroke-width', 2);

    const bisect = d3.bisector((d) => d.t).right;
    const crosshair = g.append('line').attr('stroke', '#64748B').attr('stroke-width', 1).attr('stroke-dasharray', '2 2').attr('y1', 0).attr('y2', innerHeight).style('opacity', 0);
    const focus = g.append('circle').attr('r', 4.5).attr('fill', '#2563EB').attr('stroke', '#FFFFFF').attr('stroke-width', 2).style('opacity', 0);
    const overlay = g.append('rect').attr('width', innerWidth).attr('height', innerHeight).attr('fill', 'transparent').style('cursor', 'crosshair');

    bindPointerScrub(overlay, {
      onMove: (event) => {
        const [px] = d3.pointer(event, g.node());
        const t = x.invert(Math.max(0, Math.min(innerWidth, px))).getTime();
        // Treppenfunktion: gültig ist der letzte Punkt mit Zeit ≤ t
        const i = Math.max(0, bisect(series, t) - 1);
        const d = series[i];
        if (!d) return;
        const next = series[i + 1];
        const inGap = next && next.gapBefore && t > d.t + stepMs;
        crosshair.attr('x1', px).attr('x2', px).style('opacity', 1);
        if (inGap) {
          focus.style('opacity', 0);
          setHovered({ gap: true, t });
          return;
        }
        focus.attr('cx', px).attr('cy', y(d.median)).style('opacity', 1);
        setHovered(d);
      },
      onLeave: () => {
        crosshair.style('opacity', 0);
        focus.style('opacity', 0);
        setHovered(null);
      },
    });
  }, [series, rangeHours, width, canRender, stepMs]);

  return (
    <div className="clean-card chart-card">
      <div className="chart-card-head">
        <div style={{ minWidth: 0 }}>
          <div className="chart-card-title">
            <Activity size={16} color="#0F172A" />
            <h3>Preisverlauf der Region</h3>
          </div>
          <p className="chart-card-sub">
            Median, günstigste und teuerste Station im Bereich{regionLabel ? ` (${regionLabel})` : ''} • {fuelLabel(fuelType)}
          </p>
        </div>
        <div className="nav-pill-group" role="group" aria-label="Zeitraum">
          {RANGES.map(([h, label]) => (
            <button key={h} type="button" className={`nav-pill-btn ${rangeHours === h ? 'active' : ''}`} onClick={() => onChangeRange && onChangeRange(h)} aria-pressed={rangeHours === h}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="chart-canvas">
        {canRender ? (
          <svg ref={svgRef} role="img" aria-label="Preisverlauf der Region" />
        ) : (
          <div className="chart-empty">
            <Database size={22} color="#94A3B8" />
            <strong>Noch zu wenig Verlaufsdaten für diesen Bereich</strong>
            <p>
              Die App speichert bei jedem Abruf die echten Preise aller {stationCount || ''} Tankstellen im Bereich. Nach ein paar Abrufen über einige Stunden erscheint hier der Verlauf der Region.
            </p>
          </div>
        )}
      </div>

      {canRender && (
        <div className="chart-foot">
          <div className="chart-legend">
            <span><i className="lg-line" style={{ background: '#0F172A' }} /> Median der Region</span>
            <span><i className="lg-line" style={{ background: '#059669' }} /> Günstigste Station</span>
            <span><i className="lg-box" style={{ background: '#DBEAFE' }} /> Spanne günstigste–teuerste</span>
          </div>
          {hovered ? (
            hovered.gap ? (
              <div className="chart-readout">
                {fmtDayTime(hovered.t)} Uhr: <span className="chart-readout-sub">keine Messung (App war nicht geöffnet)</span>
              </div>
            ) : (
              <div className="chart-readout">
                {fmtDayTime(hovered.t)} Uhr:{' '}
                <span className="num-mono" style={{ fontSize: '0.9rem' }}>Median {fmtPrice(hovered.median)}</span>{' '}
                <span className="chart-readout-sub">({fmtPrice(hovered.min)} – {fmtPrice(hovered.max)}, {hovered.count} Stationen)</span>
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
