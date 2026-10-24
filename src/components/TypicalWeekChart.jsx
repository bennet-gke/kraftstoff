import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { Calendar, Clock, TrendingDown, TrendingUp, AlertCircle, Sparkles, CheckCircle2 } from 'lucide-react';
import { generateTypicalWeeklyProfile } from '../engine/typicalWeek';

export default function TypicalWeekChart({
  baseFuelPrice = 1.72,
  fuelType = 'diesel',
  taxReliefCent = 0,
}) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [hoveredHour, setHoveredHour] = useState(null);

  const profile = useMemo(() => {
    return generateTypicalWeeklyProfile({
      baseFuelPrice,
      fuelType,
      taxReliefCent,
    });
  }, [baseFuelPrice, fuelType, taxReliefCent]);

  // Aktuelle Stunde berechnen (0..167)
  const now = new Date();
  const currentJsDay = now.getDay();
  const currentGermanDay = currentJsDay === 0 ? 6 : currentJsDay - 1;
  const currentGlobalHourIndex = currentGermanDay * 24 + now.getHours();

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 640;
    const height = 260;
    const margin = { top: 20, right: 24, bottom: 32, left: 52 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // X-Skala (0 bis 167 Stunden der Woche)
    const x = d3.scaleLinear().domain([0, 167]).range([0, innerWidth]);

    // Y-Skala (Preis)
    const padding = (profile.maxPrice - profile.minPrice) * 0.2 || 0.04;
    const y = d3.scaleLinear()
      .domain([profile.minPrice - padding, profile.maxPrice + padding])
      .range([innerHeight, 0]);

    // Horizontale Grid-Linien
    g.append('g')
      .call(
        d3.axisLeft(y)
          .ticks(5)
          .tickSize(-innerWidth)
          .tickFormat('')
      )
      .selectAll('line')
      .attr('stroke', '#F1F5F9')
      .attr('stroke-dasharray', '3 3');

    // Tages-Trennlinien & Hintergrund-Zonen (Mo, Di, Mi, ...)
    const dayWidth = innerWidth / 7;
    const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

    for (let d = 0; d < 7; d++) {
      const dayStart = d * dayWidth;

      // Tag-Spalte
      if (d % 2 === 1) {
        g.append('rect')
          .attr('x', dayStart)
          .attr('y', 0)
          .attr('width', dayWidth)
          .attr('height', innerHeight)
          .attr('fill', '#F8FAFC')
          .attr('opacity', 0.8);
      }

      // Tages-Beschriftung
      g.append('text')
        .attr('x', dayStart + dayWidth / 2)
        .attr('y', innerHeight + 20)
        .attr('text-anchor', 'middle')
        .attr('fill', d === currentGermanDay ? '#0F172A' : '#94A3B8')
        .attr('font-size', '11px')
        .attr('font-weight', d === currentGermanDay ? '700' : '500')
        .text(dayNames[d]);

      // Vertikaler Tages-Separator
      if (d > 0) {
        g.append('line')
          .attr('x1', dayStart)
          .attr('x2', dayStart)
          .attr('y1', 0)
          .attr('y2', innerHeight)
          .attr('stroke', '#E2E8F0')
          .attr('stroke-dasharray', '2 2');
      }
    }

    // Y-Achsenbeschriftung (€/L)
    g.append('g')
      .call(
        d3.axisLeft(y)
          .ticks(5)
          .tickFormat((d) => `${d.toFixed(2)} €`)
      )
      .selectAll('text')
      .attr('fill', '#64748B')
      .attr('font-size', '10px');

    // Volatilitätsband (Fläche)
    const area = d3.area()
      .x((d) => x(d.index))
      .y0((d) => y(d.sigmaLow))
      .y1((d) => y(d.sigmaHigh))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(profile.hourlyData)
      .attr('fill', '#F1F5F9')
      .attr('d', area);

    // Dynamische Wochendurchschnitts-Linie
    const line = d3.line()
      .x((d) => x(d.index))
      .y((d) => y(d.price))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(profile.hourlyData)
      .attr('fill', 'none')
      .attr('stroke', '#0F172A')
      .attr('stroke-width', 2.2)
      .attr('d', line);

    // Highlight des aktuellen Zeitpunkts
    const currentPoint = profile.hourlyData[currentGlobalHourIndex];
    if (currentPoint) {
      g.append('line')
        .attr('x1', x(currentGlobalHourIndex))
        .attr('x2', x(currentGlobalHourIndex))
        .attr('y1', 0)
        .attr('y2', innerHeight)
        .attr('stroke', '#059669')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '3 3');

      g.append('circle')
        .attr('cx', x(currentGlobalHourIndex))
        .attr('cy', y(currentPoint.price))
        .attr('r', 5)
        .attr('fill', '#059669')
        .attr('stroke', '#FFFFFF')
        .attr('stroke-width', 2);
    }

    // Interaktiver Cursor Overlay
    const crosshair = g.append('line')
      .attr('stroke', '#94A3B8')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2 2')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .style('opacity', 0);

    const hoverDot = g.append('circle')
      .attr('r', 4)
      .attr('fill', '#0F172A')
      .attr('stroke', '#FFFFFF')
      .attr('stroke-width', 2)
      .style('opacity', 0);

    g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', (event) => {
        const [xPos] = d3.pointer(event);
        const index = Math.min(167, Math.max(0, Math.round(x.invert(xPos))));
        const p = profile.hourlyData[index];
        if (!p) return;

        crosshair.attr('x1', x(p.index)).attr('x2', x(p.index)).style('opacity', 1);
        hoverDot.attr('cx', x(p.index)).attr('cy', y(p.price)).style('opacity', 1);
        setHoveredHour(p);
      })
      .on('mouseleave', () => {
        crosshair.style('opacity', 0);
        hoverDot.style('opacity', 0);
        setHoveredHour(null);
      });

  }, [profile, currentGlobalHourIndex]);

  const currentPoint = profile.hourlyData[currentGlobalHourIndex];

  return (
    <div className="clean-card" style={{ padding: '1.25rem' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Calendar size={16} color="#0F172A" />
            <h3 style={{ fontSize: '0.98rem', fontWeight: 700, color: '#0F172A' }}>
              Die „Typische Woche“: Dynamischer Preiszyklus über die Zeit
            </h3>
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                background: '#EFF6FF',
                color: '#1E40AF',
                border: '1px solid #BFDBFE',
              }}
            >
              📍 Basis: {baseFuelPrice.toFixed(3)} €/L (Bester Preis in deiner Region)
            </span>
          </div>
          <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '0.2rem' }}>
            Basiert direkt auf dem <strong>realen Preisniveau deines ausgewählten Bereichs ({baseFuelPrice.toFixed(3)} €/L)</strong>, überlagert mit dem empirischen 7-Tage-Rhythmus (Bundeskartellamt & Markttransparenzstelle).
          </p>
        </div>

        {/* Aktueller Status Badge */}
        {currentPoint && (
          <div
            className={`badge ${
              currentPoint.isLowWindow
                ? 'badge-favorable'
                : currentPoint.isPeakWindow
                ? 'badge-unfavorable'
                : 'badge-neutral'
            }`}
            style={{ padding: '0.35rem 0.65rem' }}
          >
            {currentPoint.isLowWindow ? <Sparkles size={13} /> : <Clock size={13} />}
            <span>
              Jetzt gerade ({currentPoint.dayName}, {currentPoint.timeLabel}):{' '}
              <strong>
                {currentPoint.isLowWindow
                  ? 'Günstiges Tiefzeit-Fenster!'
                  : currentPoint.isPeakWindow
                  ? 'Teure Hochzeit (Spitze)'
                  : 'Normales Mittelfeld'}
              </strong>
            </span>
          </div>
        )}
      </div>

      {/* SVG Canvas */}
      <div ref={containerRef} style={{ width: '100%', position: 'relative' }}>
        <svg ref={svgRef} style={{ display: 'block' }} />
      </div>

      {/* Hover Info & Live Delta */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #F1F5F9', fontSize: '0.78rem', color: '#64748B', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <div style={{ width: '12px', height: '3px', background: '#0F172A' }} />
            <span>Wochendurchschnitts-Kurve</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#059669' }} />
            <span>Aktueller Moment (grüner Marker)</span>
          </div>
        </div>

        {hoveredHour ? (
          <div style={{ fontWeight: 600, color: '#0F172A' }}>
            {hoveredHour.dayName}, {hoveredHour.timeLabel} Uhr:{' '}
            <span className="num-mono" style={{ color: hoveredHour.deltaToMedianCent < 0 ? '#059669' : '#DC2626' }}>
              {hoveredHour.price.toFixed(3)} €
            </span>{' '}
            <span style={{ fontSize: '0.74rem', color: '#64748B' }}>
              ({hoveredHour.deltaToMedianCent > 0 ? `+${hoveredHour.deltaToMedianCent}` : hoveredHour.deltaToMedianCent} ct vs. Wochenschnitt)
            </span>
          </div>
        ) : (
          <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
            Bewege die Maus über die Wochentage zur Stunden-Analyse
          </div>
        )}
      </div>

      {/* Übersicht: Tief- & Hochzeiten Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
        {profile.topWindows.map((win, idx) => (
          <div
            key={idx}
            style={{
              border: `1px solid ${win.type === 'CHEAP' ? '#A7F3D0' : '#FECDD3'}`,
              background: win.type === 'CHEAP' ? '#ECFDF5' : '#FFF1F2',
              borderRadius: '8px',
              padding: '0.75rem 0.9rem',
              fontSize: '0.78rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700, color: win.type === 'CHEAP' ? '#065F46' : '#9F1239' }}>
                {win.type === 'CHEAP' ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
                <span>{win.title}</span>
              </div>
              <span className="num-mono" style={{ fontWeight: 800, color: win.type === 'CHEAP' ? '#059669' : '#E11D48' }}>
                {win.avgDeltaCent > 0 ? `+${win.avgDeltaCent}` : win.avgDeltaCent} ct
              </span>
            </div>
            <div style={{ fontWeight: 600, color: '#0F172A', marginTop: '0.15rem' }}>
              {win.day} • {win.time}
            </div>
            <p style={{ color: '#64748B', fontSize: '0.72rem', marginTop: '0.15rem' }}>
              {win.recommendation}
            </p>
          </div>
        ))}
      </div>

    </div>
  );
}
