import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Calendar, Clock, Sparkles } from 'lucide-react';
import { DAY_NAMES, DAY_SHORT, toMondayIndex, deriveTopWindows, profileAnchorPrice } from '../engine/regionalTrends';
import { useElementWidth, useNow } from './chartHooks';
import { fmtCt, fmtPrice, fuelLabel } from '../utils/format';

const CHEAP = '#10B981';
const MID = '#FCD34D';
const DEAR = '#F87171';

/**
 * 7 Tage × 24 Stunden Heatmap des Regionsprofils. Gezeichnet in echter Breite (lesbar auf dem iPhone).
 * Felder ohne Messung an diesem Wochentag sind blass (Tagesmuster bzw. Erfahrungswert).
 */
export default function HeatmapChart({ profile, regionMedian = null, fuelType = 'diesel', subtitle = '' }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const width = useElementWidth(containerRef);
  const now = useNow(60000);
  const [selected, setSelected] = useState(null);

  const nowDate = new Date(now);
  const currentDay = toMondayIndex(nowDate.getDay());
  const currentHour = nowDate.getHours();
  const anchor = useMemo(() => profileAnchorPrice(profile, regionMedian, now), [profile, regionMedian, now]);

  const grid = useMemo(() => {
    if (!profile) return { cells: [], minEst: 0, maxEst: 0 };
    const cells = [];
    let minEst = Infinity;
    let maxEst = -Infinity;
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const c = profile.cells[d][h];
        cells.push({ day: d, hour: h, est: c.est, n: c.n, days: c.days || 0, conf: c.conf, observed: !!c.observed });
        minEst = Math.min(minEst, c.est);
        maxEst = Math.max(maxEst, c.est);
      }
    }
    return { cells, minEst, maxEst };
  }, [profile]);

  const best = useMemo(() => deriveTopWindows(profile, 1).cheap[0] || null, [profile]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    if (!width || grid.cells.length === 0) return;

    const margin = { top: 18, right: 4, bottom: 4, left: 28 };
    const innerWidth = Math.max(160, width - margin.left - margin.right);
    const cellW = innerWidth / 24;
    const cellH = Math.max(18, Math.min(28, cellW * 1.25));
    const height = margin.top + cellH * 7 + margin.bottom;
    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const mid = (grid.minEst + grid.maxEst) / 2;
    const color = grid.maxEst - grid.minEst < 0.05
      ? () => MID
      : d3.scaleLinear().domain([grid.minEst, mid, grid.maxEst]).range([CHEAP, MID, DEAR]).interpolate(d3.interpolateHcl);

    const labelStep = innerWidth < 380 ? 6 : 3;
    for (let h = 0; h < 24; h += labelStep) {
      g.append('text')
        .attr('x', h * cellW + cellW / 2)
        .attr('y', -6)
        .attr('text-anchor', 'middle')
        .attr('fill', h === currentHour ? '#0F172A' : '#64748B')
        .attr('font-size', '10px')
        .attr('font-weight', 600)
        .text(innerWidth < 380 ? `${h}` : `${h}:00`);
    }
    DAY_SHORT.forEach((day, i) => {
      g.append('text')
        .attr('x', -6)
        .attr('y', i * cellH + cellH / 2 + 3.5)
        .attr('text-anchor', 'end')
        .attr('fill', i === currentDay ? '#0F172A' : '#475569')
        .attr('font-size', '10.5px')
        .attr('font-weight', i === currentDay ? 800 : 600)
        .text(day);
    });

    const isSel = (d) => selected && selected.day === d.day && selected.hour === d.hour;
    const isNow = (d) => d.day === currentDay && d.hour === currentHour;
    g.selectAll('rect.heatmap-cell')
      .data(grid.cells)
      .enter()
      .append('rect')
      .attr('class', 'heatmap-cell')
      .attr('x', (d) => d.hour * cellW + 0.75)
      .attr('y', (d) => d.day * cellH + 0.75)
      .attr('width', Math.max(1, cellW - 1.5))
      .attr('height', Math.max(1, cellH - 1.5))
      .attr('rx', Math.min(3, cellW / 4))
      .attr('fill', (d) => color(d.est))
      .attr('fill-opacity', (d) => (d.observed ? 0.7 + 0.3 * Math.min(1, d.conf) : 0.38))
      .attr('stroke', (d) => (isSel(d) ? '#0284C7' : isNow(d) ? '#0F172A' : 'none'))
      .attr('stroke-width', (d) => (isSel(d) ? 2.5 : isNow(d) ? 2 : 0))
      .style('cursor', 'pointer')
      .on('click', (event, d) => setSelected({ day: d.day, hour: d.hour }))
      .on('pointerenter', (event, d) => {
        if (event.pointerType === 'mouse') setSelected({ day: d.day, hour: d.hour });
      });
  }, [grid, width, selected, currentDay, currentHour]);

  if (!profile) return null;

  const findCell = (day, hour) => grid.cells.find((c) => c.day === day && c.hour === hour) || null;
  const activeCell = (selected && findCell(selected.day, selected.hour)) || findCell(currentDay, currentHour);
  const span = grid.maxEst - grid.minEst || 1;
  const classify = (est) => {
    const pos = (est - grid.minEst) / span;
    if (pos < 0.35) return { label: 'Günstig', bg: '#ECFDF5', fg: '#065F46', dot: CHEAP };
    if (pos > 0.65) return { label: 'Teuer', bg: '#FEF2F2', fg: '#991B1B', dot: DEAR };
    return { label: 'Mittelfeld', bg: '#FFFBEB', fg: '#92400E', dot: '#F59E0B' };
  };
  const absPrice = (est) => (Number.isFinite(anchor) ? fmtPrice(anchor + est / 100) : null);
  const cls = activeCell ? classify(activeCell.est) : null;
  const isNowCell = activeCell && activeCell.day === currentDay && activeCell.hour === currentHour;

  return (
    <div className="clean-card chart-card">
      <div className="chart-card-head">
        <div style={{ minWidth: 0 }}>
          <div className="chart-card-title">
            <Calendar size={16} color="#059669" />
            <h3>Wochen-Heatmap der Region</h3>
          </div>
          <p className="chart-card-sub">
            Typische Preislage je Wochentag und Stunde für {fuelLabel(fuelType)}{subtitle ? ` • ${subtitle}` : ''}. Blasse Felder: an diesem Wochentag noch nicht gemessen.
          </p>
        </div>
        {best && (
          <div className="badge badge-favorable" style={{ padding: '0.35rem 0.65rem' }}>
            <Sparkles size={13} />
            <span>
              Am günstigsten: <strong>{best.label}</strong> ({fmtCt(best.est)})
            </span>
          </div>
        )}
      </div>

      <div ref={containerRef} className="chart-canvas">
        <svg ref={svgRef} role="img" aria-label="Wochen-Heatmap der Preislage" />
      </div>

      {activeCell && cls && (
        <div className="heatmap-info">
          <div className="heatmap-info-main">
            <span className="heatmap-info-dot" style={{ background: cls.dot }} />
            <div>
              <strong>
                {DAY_NAMES[activeCell.day]}, {activeCell.hour}:00–{(activeCell.hour + 1) % 24}:00 Uhr
              </strong>
              {isNowCell && <span className="heatmap-info-now">jetzt</span>}
              <div className="heatmap-info-sub">
                {activeCell.observed
                  ? `${activeCell.days} ${activeCell.days === 1 ? 'Tag' : 'Tage'} gemessen • Sicherheit ${Math.round(activeCell.conf * 100)} %`
                  : (profile.hourOfDay?.[activeCell.hour]?.days || 0) > 0
                    ? `an diesem Wochentag noch nicht gemessen – Tagesmuster gelernt • Sicherheit ${Math.round(activeCell.conf * 100)} %`
                    : 'Erfahrungswert – zu dieser Stunde noch nicht gemessen'}
              </div>
            </div>
          </div>
          <div className="heatmap-info-values">
            <div>
              <span>Typisch </span>
              <strong className="num-mono">{fmtCt(activeCell.est)}</strong>
              {absPrice(activeCell.est) && <span className="num-mono"> (~{absPrice(activeCell.est)})</span>}
            </div>
            <span className="heatmap-info-tag" style={{ background: cls.bg, color: cls.fg }}>{cls.label}</span>
          </div>
        </div>
      )}

      <div className="chart-foot">
        <div className="heatmap-scale">
          <span>Günstig ({fmtCt(grid.minEst)})</span>
          <i style={{ background: `linear-gradient(to right, ${CHEAP}, ${MID}, ${DEAR})` }} />
          <span>Teuer ({fmtCt(grid.maxEst)})</span>
        </div>
        <div className="chart-hint" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <Clock size={12} />
          <span>Feld antippen für Details • relativ zum Niveau der jeweiligen Station</span>
        </div>
      </div>
    </div>
  );
}
