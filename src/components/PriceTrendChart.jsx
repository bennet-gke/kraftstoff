import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { TrendingUp } from 'lucide-react';
import { calculateStandardDeviation } from '../engine/adaptiveAverage';

export default function PriceTrendChart({
  history = [],
  stationName = 'Tankstelle',
  fuelType = 'diesel',
  evaluation = null
}) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [rangeHours, setRangeHours] = useState(72); // 24h, 72h (3d), 168h (7d)
  const [hoveredPoint, setHoveredPoint] = useState(null);

  // Gefilterte Zeitreihe nach gewähltem Zeitfenster
  const filteredData = React.useMemo(() => {
    if (!history || history.length === 0) return [];
    const now = new Date().getTime();
    const minTime = now - rangeHours * 60 * 60 * 1000;

    const sliced = history
      .filter((d) => new Date(d.timestamp).getTime() >= minTime)
      .map((d) => ({
        date: new Date(d.timestamp),
        price: d.price,
      }))
      .sort((a, b) => a.date - b.date);

    // Berechne für jeden Punkt den gleitenden Durchschnitt und Sigma-Band
    return sliced.map((d, index, arr) => {
      // Lookback subset
      const sub = arr.slice(Math.max(0, index - 12), index + 1);
      const prices = sub.map((s) => s.price);
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      const sigma = sub.length > 2 ? calculateStandardDeviation(prices) : 0.02;

      return {
        ...d,
        avgPrice: avg,
        sigmaHigh: avg + sigma,
        sigmaLow: avg - sigma,
      };
    });
  }, [history, rangeHours]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || filteredData.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth || 600;
    const height = 280;
    const margin = { top: 20, right: 30, bottom: 30, left: 52 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // X-Skala (Zeit)
    const x = d3.scaleTime()
      .domain(d3.extent(filteredData, (d) => d.date))
      .range([0, innerWidth]);

    // Y-Skala (Preis) mit etwas Polsterung
    const minP = d3.min(filteredData, (d) => Math.min(d.price, d.sigmaLow)) || 1.6;
    const maxP = d3.max(filteredData, (d) => Math.max(d.price, d.sigmaHigh)) || 1.9;
    const padding = (maxP - minP) * 0.15;

    const y = d3.scaleLinear()
      .domain([minP - padding, maxP + padding])
      .range([innerHeight, 0]);

    // Horizontale Grid-Linien
    g.append('g')
      .attr('class', 'grid')
      .call(
        d3.axisLeft(y)
          .ticks(5)
          .tickSize(-innerWidth)
          .tickFormat('')
      )
      .selectAll('line')
      .attr('stroke', '#F1F5F9')
      .attr('stroke-dasharray', '3 3');

    // X-Achse
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3.axisBottom(x)
          .ticks(width < 500 ? 4 : 7)
          .tickFormat(d3.timeFormat(rangeHours <= 24 ? '%H:%M' : '%a %H:%M'))
      )
      .selectAll('text')
      .attr('fill', '#94A3B8')
      .attr('font-size', '11px');

    g.select('.domain').attr('stroke', '#E2E8F0');

    // Y-Achse (Preise in Euro)
    g.append('g')
      .call(
        d3.axisLeft(y)
          .ticks(5)
          .tickFormat((d) => `${d.toFixed(2)} €`)
      )
      .selectAll('text')
      .attr('fill', '#64748B')
      .attr('font-size', '11px');

    // Volatilitätsband (Fläche zwischen sigmaLow und sigmaHigh)
    const area = d3.area()
      .x((d) => x(d.date))
      .y0((d) => y(d.sigmaLow))
      .y1((d) => y(d.sigmaHigh))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(filteredData)
      .attr('fill', '#F1F5F9')
      .attr('opacity', 0.8)
      .attr('d', area);

    // Adaptive Moving Average Linie (gestrichelt)
    const avgLine = d3.line()
      .x((d) => x(d.date))
      .y((d) => y(d.avgPrice))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(filteredData)
      .attr('fill', 'none')
      .attr('stroke', '#94A3B8')
      .attr('stroke-width', 1.8)
      .attr('stroke-dasharray', '4 4')
      .attr('d', avgLine);

    // Tatsächliche Preis-Kurve
    const priceLine = d3.line()
      .x((d) => x(d.date))
      .y((d) => y(d.price))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(filteredData)
      .attr('fill', 'none')
      .attr('stroke', '#0F172A')
      .attr('stroke-width', 2.2)
      .attr('d', priceLine);

    // Letzter aktueller Punkt
    const latest = filteredData[filteredData.length - 1];
    if (latest) {
      g.append('circle')
        .attr('cx', x(latest.date))
        .attr('cy', y(latest.price))
        .attr('r', 5)
        .attr('fill', evaluation?.isCheap ? '#059669' : '#0F172A')
        .attr('stroke', '#FFFFFF')
        .attr('stroke-width', 2);
    }

    // Interaktiver Cursor & Tooltip Overlay
    const bisect = d3.bisector((d) => d.date).left;

    const crosshair = g.append('line')
      .attr('stroke', '#CBD5E1')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2 2')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .style('opacity', 0);

    const focusCircle = g.append('circle')
      .attr('r', 4.5)
      .attr('fill', '#059669')
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
        const x0 = x.invert(xPos);
        const i = bisect(filteredData, x0, 1);
        const d0 = filteredData[i - 1];
        const d1 = filteredData[i];
        let d = d0;
        if (d1 && x0 - d0?.date > d1?.date - x0) {
          d = d1;
        }
        if (!d) return;

        crosshair.attr('x1', x(d.date)).attr('x2', x(d.date)).style('opacity', 1);
        focusCircle.attr('cx', x(d.date)).attr('cy', y(d.price)).style('opacity', 1);

        setHoveredPoint(d);
      })
      .on('mouseleave', () => {
        crosshair.style('opacity', 0);
        focusCircle.style('opacity', 0);
        setHoveredPoint(null);
      });

  }, [filteredData, rangeHours, evaluation]);

  return (
    <div className="clean-card" style={{ padding: '1.25rem' }}>
      {/* Header & Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <TrendingUp size={16} color="#0F172A" />
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>
              D3 Preisverlauf & Dynamischer Durchschnitt (AMA)
            </h3>
          </div>
          <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '0.15rem' }}>
            {stationName} • {fuelType.toUpperCase()} mit Volatilitätsband (±σ)
          </p>
        </div>

        {/* Zeitfenster-Filter */}
        <div className="nav-pill-group">
          <button
            className={`nav-pill-btn ${rangeHours === 24 ? 'active' : ''}`}
            onClick={() => setRangeHours(24)}
          >
            24h
          </button>
          <button
            className={`nav-pill-btn ${rangeHours === 72 ? 'active' : ''}`}
            onClick={() => setRangeHours(72)}
          >
            3 Tage
          </button>
          <button
            className={`nav-pill-btn ${rangeHours === 168 ? 'active' : ''}`}
            onClick={() => setRangeHours(168)}
          >
            7 Tage
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <div ref={containerRef} style={{ width: '100%', position: 'relative' }}>
        <svg ref={svgRef} style={{ display: 'block' }} />
      </div>

      {/* Legende & Details */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid #F1F5F9', fontSize: '0.78rem', color: '#64748B', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <div style={{ width: '12px', height: '3px', background: '#0F172A' }} />
            <span>Aktueller Preis</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <div style={{ width: '12px', height: '0', borderTop: '2px dashed #94A3B8' }} />
            <span>Adaptive Moving Average</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <div style={{ width: '12px', height: '8px', background: '#E2E8F0', borderRadius: '2px' }} />
            <span>Volatilitätsband (±σ)</span>
          </div>
        </div>

        {hoveredPoint ? (
          <div style={{ fontWeight: 600, color: '#0F172A' }}>
            {hoveredPoint.date.toLocaleDateString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} Uhr:{' '}
            <span className="num-mono" style={{ color: '#059669', fontSize: '0.9rem' }}>
              {hoveredPoint.price.toFixed(3)} €
            </span>{' '}
            <span style={{ color: '#94A3B8', fontSize: '0.75rem' }}>
              (Ø {hoveredPoint.avgPrice?.toFixed(3)} €)
            </span>
          </div>
        ) : (
          <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
            Bewege die Maus über den Graphen zur Detailanalyse
          </div>
        )}
      </div>
    </div>
  );
}
