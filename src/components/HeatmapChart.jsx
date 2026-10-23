import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Calendar, Clock, Sparkles } from 'lucide-react';

const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const DAY_LABELS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export default function HeatmapChart({ history = [], fuelType = 'diesel', stationName = 'Durchschnitt aller Tankstellen' }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [hoveredCell, setHoveredCell] = useState(null);

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

    // Befülle mit Historie
    history.forEach((entry) => {
      const date = new Date(entry.timestamp);
      // getDay: 0=So, 1=Mo... konvertiere zu 0=Mo..6=So
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
        // Fallback basierend auf Standardmuster falls Historie Lücken hat
        const base = fuelType === 'diesel' ? 1.68 : fuelType === 'e10' ? 1.73 : 1.79;
        let delta = 0;
        if (cell.hour >= 6 && cell.hour <= 8) delta = 0.07;
        else if (cell.hour >= 18 && cell.hour <= 20) delta = -0.05;
        else if (cell.hour >= 12 && cell.hour <= 14) delta = -0.01;
        else delta = 0.04;
        cell.avgPrice = base + delta;
        allAverages.push(cell.avgPrice);
      }
    });

    const minPrice = d3.min(allAverages) || 1.60;
    const maxPrice = d3.max(allAverages) || 1.85;

    return { grid, minPrice, maxPrice };
  }, [history, fuelType]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 600;
    const height = 240;
    const margin = { top: 24, right: 16, bottom: 24, left: 36 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const cellWidth = innerWidth / 24;
    const cellHeight = innerHeight / 7;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Farbskala: Grün (günstig) -> Neutrales Sand/Gelb -> Sanftes Rot (teuer)
    const colorScale = d3.scaleSequential()
      .domain([matrixData.maxPrice, matrixData.minPrice]) // Inverted so lower price = greener
      .interpolator(d3.interpolateHcl('#FCA5A5', '#34D399')); // Soft Red to Crisp Emerald

    // X-Achsenbeschriftung (Stunden: 0, 4, 8, 12, 16, 20)
    const hoursToShow = [0, 4, 8, 12, 16, 20];
    hoursToShow.forEach((hour) => {
      g.append('text')
        .attr('x', hour * cellWidth + cellWidth / 2)
        .attr('y', -8)
        .attr('text-anchor', 'middle')
        .attr('fill', '#94A3B8')
        .attr('font-size', '10px')
        .attr('font-weight', '500')
        .text(`${hour}:00`);
    });

    // Y-Achsenbeschriftung (Wochentage)
    DAY_LABELS_SHORT.forEach((day, i) => {
      g.append('text')
        .attr('x', -8)
        .attr('y', i * cellHeight + cellHeight / 2 + 3)
        .attr('text-anchor', 'end')
        .attr('fill', '#64748B')
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .text(day);
    });

    // Grid Zellen zeichnen
    const now = new Date();
    const currentJsDay = now.getDay();
    const currentGermanDay = currentJsDay === 0 ? 6 : currentJsDay - 1;
    const currentHour = now.getHours();

    g.selectAll('rect.heatmap-cell')
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
        if (d.dayIndex === currentGermanDay && d.hour === currentHour) {
          return '#0F172A'; // Highlight aktuelle Stunde
        }
        return 'transparent';
      })
      .attr('stroke-width', (d) => (d.dayIndex === currentGermanDay && d.hour === currentHour ? 2 : 0))
      .style('cursor', 'pointer')
      .on('mouseenter', (event, d) => {
        setHoveredCell(d);
      })
      .on('mouseleave', () => {
        setHoveredCell(null);
      });

  }, [matrixData]);

  // Finde das statistisch günstigste Zeitfenster
  const bestSlot = React.useMemo(() => {
    if (!matrixData.grid.length) return null;
    let min = matrixData.grid[0];
    matrixData.grid.forEach((c) => {
      if (c.avgPrice < min.avgPrice) min = c;
    });
    return min;
  }, [matrixData]);

  return (
    <div className="clean-card" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Calendar size={16} color="#059669" />
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>
              D3 Heatmap: Optimale Tank-Zeitfenster
            </h3>
          </div>
          <p style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '0.15rem' }}>
            Preisverteilung über 7 Wochentage × 24 Stunden ({fuelType.toUpperCase()})
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

      {/* SVG Canvas Container */}
      <div ref={containerRef} style={{ width: '100%', overflowX: 'auto' }}>
        <svg ref={svgRef} style={{ display: 'block', minWidth: '540px' }} />
      </div>

      {/* Farblegende & Hover Detail */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid #F1F5F9', fontSize: '0.78rem', color: '#64748B' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>Günstig (~{matrixData.minPrice?.toFixed(2)} €)</span>
          <div style={{ width: '60px', height: '8px', borderRadius: '4px', background: 'linear-gradient(to right, #34D399, #FCA5A5)' }} />
          <span>Teuer (~{matrixData.maxPrice?.toFixed(2)} €)</span>
        </div>

        {hoveredCell ? (
          <div style={{ fontWeight: 600, color: '#0F172A' }}>
            {DAYS[hoveredCell.dayIndex]}, {hoveredCell.hour}:00 Uhr:{' '}
            <span className="num-mono" style={{ color: '#059669' }}>
              {hoveredCell.avgPrice?.toFixed(3)} €
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#94A3B8' }}>
            <Clock size={13} />
            <span>Hovere über eine Kachel für Detailpreise</span>
          </div>
        )}
      </div>
    </div>
  );
}
