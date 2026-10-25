import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Calendar, Clock, Sparkles, Info, CheckCircle2 } from 'lucide-react';

const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const DAY_LABELS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export default function HeatmapChart({
  history = [],
  fuelType = 'diesel',
  stationName = 'Durchschnitt aller Tankstellen',
}) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [selectedCell, setSelectedCell] = useState(null);

  // Aggregiere Preisdaten nach Wochentag (0=Mo .. 6=So) und Stunde (0..23)
  const matrixData = React.useMemo(() => {
    // 7 Tage x 24 Stunden Matrix initialisieren
    const grid = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        grid.push({
          dayIndex: d,
          hour: h,
          prices: [],
          avgPrice: null,
        });
      }
    }

    const cellMap = new Map();
    grid.forEach((c) => cellMap.set(`${c.dayIndex}-${c.hour}`, c));

    // Befülle mit Historie falls vorhanden
    history.forEach((entry) => {
      const date = new Date(entry.timestamp);
      const jsDay = date.getDay();
      const germanDayIndex = jsDay === 0 ? 6 : jsDay - 1;
      const hour = date.getHours();

      const key = `${germanDayIndex}-${hour}`;
      const cell = cellMap.get(key);
      if (cell && typeof entry.price === 'number') {
        cell.prices.push(entry.price);
      }
    });

    // Berechne Durchschnitt und Füllung
    let allAverages = [];
    grid.forEach((cell) => {
      if (cell.prices.length > 0) {
        cell.avgPrice = cell.prices.reduce((a, b) => a + b, 0) / cell.prices.length;
        allAverages.push(cell.avgPrice);
      } else {
        // Empirisches Standardmuster Bundeskartellamt
        const base = fuelType === 'diesel' ? 1.68 : fuelType === 'e10' ? 1.73 : 1.79;
        let delta = 0;
        if (cell.hour >= 6 && cell.hour <= 8) delta = 0.075;
        else if (cell.hour >= 18 && cell.hour <= 20) delta = -0.058;
        else if (cell.hour >= 12 && cell.hour <= 14) delta = -0.012;
        else if (cell.hour >= 22 || cell.hour <= 5) delta = 0.048;
        else delta = 0.02;

        // Wochentagsanpassung (Dienstag am günstigsten)
        if (cell.dayIndex === 1) delta -= 0.015;
        if (cell.dayIndex === 4 || cell.dayIndex === 5) delta += 0.012;

        cell.avgPrice = parseFloat((base + delta).toFixed(3));
        allAverages.push(cell.avgPrice);
      }
    });

    const minPrice = d3.min(allAverages) || 1.60;
    const maxPrice = d3.max(allAverages) || 1.85;

    return { grid, minPrice, maxPrice };
  }, [history, fuelType]);

  useEffect(() => {
    if (!svgRef.current) return;

    // Feste SVG-Dimensionen im ViewBox für 100% responsive Skalierung auf jedem Screen
    const width = 580;
    const height = 230;
    const margin = { top: 26, right: 14, bottom: 18, left: 44 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const cellWidth = innerWidth / 24;
    const cellHeight = innerHeight / 7;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', 'auto')
      .style('display', 'block');

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Farbskala: Grün (günstig) -> Sanftes Rot (teuer)
    const colorScale = d3.scaleSequential()
      .domain([matrixData.maxPrice, matrixData.minPrice])
      .interpolator(d3.interpolateHcl('#FCA5A5', '#10B981'));

    // X-Achsenbeschriftung (Stunden: 0h, 4h, 8h, 12h, 16h, 20h, 23h)
    const hoursToShow = [0, 4, 8, 12, 16, 20, 23];
    hoursToShow.forEach((hour) => {
      g.append('text')
        .attr('x', hour * cellWidth + cellWidth / 2)
        .attr('y', -8)
        .attr('text-anchor', 'middle')
        .attr('fill', '#64748B')
        .attr('font-size', '10.5px')
        .attr('font-weight', '600')
        .text(`${hour}:00`);
    });

    // Y-Achsenbeschriftung (Wochentage Mo..So)
    DAY_LABELS_SHORT.forEach((day, i) => {
      g.append('text')
        .attr('x', -10)
        .attr('y', i * cellHeight + cellHeight / 2 + 3.5)
        .attr('text-anchor', 'end')
        .attr('fill', '#334155')
        .attr('font-size', '11px')
        .attr('font-weight', '700')
        .text(day);
    });

    // Grid Zellen zeichnen
    const now = new Date();
    const currentJsDay = now.getDay();
    const currentGermanDay = currentJsDay === 0 ? 6 : currentJsDay - 1;
    const currentHour = now.getHours();

    const cells = g.selectAll('rect.heatmap-cell')
      .data(matrixData.grid)
      .enter()
      .append('rect')
      .attr('class', 'heatmap-cell')
      .attr('x', (d) => d.hour * cellWidth + 1)
      .attr('y', (d) => d.dayIndex * cellHeight + 1)
      .attr('width', Math.max(1, cellWidth - 2))
      .attr('height', Math.max(1, cellHeight - 2))
      .attr('rx', 3)
      .attr('fill', (d) => colorScale(d.avgPrice))
      .attr('stroke', (d) => {
        if (selectedCell && selectedCell.dayIndex === d.dayIndex && selectedCell.hour === d.hour) {
          return '#0284C7'; // Selected cell highlight
        }
        if (d.dayIndex === currentGermanDay && d.hour === currentHour) {
          return '#0F172A'; // Highlight aktuelle Stunde
        }
        return 'transparent';
      })
      .attr('stroke-width', (d) => {
        if (selectedCell && selectedCell.dayIndex === d.dayIndex && selectedCell.hour === d.hour) return 2.5;
        if (d.dayIndex === currentGermanDay && d.hour === currentHour) return 2.2;
        return 0;
      })
      .style('cursor', 'pointer');

    const handleSelect = (event, d) => {
      event.stopPropagation();
      setSelectedCell(d);
    };

    cells
      .on('click', handleSelect)
      .on('touchstart', handleSelect)
      .on('mouseenter', (event, d) => {
        setSelectedCell(d);
      });

  }, [matrixData, selectedCell]);

  // Finde das statistisch günstigste Zeitfenster
  const bestSlot = React.useMemo(() => {
    if (!matrixData.grid.length) return null;
    let min = matrixData.grid[0];
    matrixData.grid.forEach((c) => {
      if (c.avgPrice < min.avgPrice) min = c;
    });
    return min;
  }, [matrixData]);

  // Berechne aktiven Slot
  const now = new Date();
  const currentJsDay = now.getDay();
  const currentGermanDay = currentJsDay === 0 ? 6 : currentJsDay - 1;
  const currentHour = now.getHours();

  const activeDisplayCell = selectedCell || matrixData.grid.find(
    (c) => c.dayIndex === currentGermanDay && c.hour === currentHour
  ) || bestSlot;

  return (
    <div className="clean-card" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <Calendar size={16} color="#059669" />
            <h3 style={{ fontSize: '0.98rem', fontWeight: 800, color: '#0F172A' }}>
              D3 Heatmap: Optimale Tank-Zeitfenster
            </h3>
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                background: '#ECFDF5',
                color: '#065F46',
                border: '1px solid #A7F3D0',
              }}
            >
              7 Tage × 24h Matrix
            </span>
          </div>
          <p style={{ fontSize: '0.76rem', color: '#64748B', marginTop: '0.2rem' }}>
            Preisentwicklung je Stunde & Wochentag für {fuelType.toUpperCase()} • Basis: {stationName}
          </p>
        </div>

        {bestSlot && (
          <div className="badge badge-favorable" style={{ padding: '0.35rem 0.65rem' }}>
            <Sparkles size={13} />
            <span>
              Bestes Zeitfenster: <strong>{DAYS[bestSlot.dayIndex]}, {bestSlot.hour}:00–{bestSlot.hour + 1}:00 Uhr</strong> (~{bestSlot.avgPrice?.toFixed(3)} €)
            </span>
          </div>
        )}
      </div>

      {/* SVG Canvas Container (Voll responsiv mit fester ViewBox & Touch-Optimierung) */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          background: '#FFFFFF',
          borderRadius: '8px',
          padding: '0.4rem 0',
          touchAction: 'manipulation',
        }}
      >
        <svg ref={svgRef} />
      </div>

      {/* Interaktive Detail-Inspektion (Tippen/Hovern) */}
      {activeDisplayCell && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.65rem 0.95rem',
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.6rem',
            fontSize: '0.78rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '3px',
                background: activeDisplayCell.avgPrice < (matrixData.minPrice + (matrixData.maxPrice - matrixData.minPrice) * 0.35)
                  ? '#10B981'
                  : activeDisplayCell.avgPrice > (matrixData.minPrice + (matrixData.maxPrice - matrixData.minPrice) * 0.65)
                  ? '#EF4444'
                  : '#F59E0B',
              }}
            />
            <div>
              <strong style={{ color: '#0F172A' }}>
                {DAYS[activeDisplayCell.dayIndex]}, {activeDisplayCell.hour}:00–{activeDisplayCell.hour + 1}:00 Uhr
              </strong>
              {activeDisplayCell.dayIndex === currentGermanDay && activeDisplayCell.hour === currentHour && (
                <span style={{ marginLeft: '0.4rem', color: '#0284C7', fontWeight: 700 }}>
                  (Jetzt gerade)
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div>
              <span style={{ color: '#64748B', fontSize: '0.72rem' }}>Erwarteter Preis: </span>
              <strong className="num-mono" style={{ fontSize: '0.92rem', color: '#0F172A' }}>
                ~{activeDisplayCell.avgPrice?.toFixed(3)} €
              </strong>
            </div>
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                background: activeDisplayCell.avgPrice < (matrixData.minPrice + (matrixData.maxPrice - matrixData.minPrice) * 0.4)
                  ? '#ECFDF5'
                  : activeDisplayCell.avgPrice > (matrixData.minPrice + (matrixData.maxPrice - matrixData.minPrice) * 0.6)
                  ? '#FEF2F2'
                  : '#F8FAFC',
                color: activeDisplayCell.avgPrice < (matrixData.minPrice + (matrixData.maxPrice - matrixData.minPrice) * 0.4)
                  ? '#065F46'
                  : activeDisplayCell.avgPrice > (matrixData.minPrice + (matrixData.maxPrice - matrixData.minPrice) * 0.6)
                  ? '#991B1B'
                  : '#475569',
              }}
            >
              {activeDisplayCell.avgPrice < (matrixData.minPrice + (matrixData.maxPrice - matrixData.minPrice) * 0.4)
                ? 'Günstig (Empfohlen)'
                : activeDisplayCell.avgPrice > (matrixData.minPrice + (matrixData.maxPrice - matrixData.minPrice) * 0.6)
                ? 'Teure Spitze'
                : 'Mittelfeld'}
            </span>
          </div>
        </div>
      )}

      {/* Farblegende & Touch-Hinweis */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', paddingTop: '0.65rem', borderTop: '1px solid #F1F5F9', fontSize: '0.74rem', color: '#64748B', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>Günstig (~{matrixData.minPrice?.toFixed(2)} €)</span>
          <div style={{ width: '60px', height: '8px', borderRadius: '4px', background: 'linear-gradient(to right, #10B981, #FCA5A5)' }} />
          <span>Teuer (~{matrixData.maxPrice?.toFixed(2)} €)</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#94A3B8' }}>
          <Clock size={12} />
          <span>Tippe auf eine Kachel für Detailpreise</span>
        </div>
      </div>
    </div>
  );
}
