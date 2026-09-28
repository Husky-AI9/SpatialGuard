/**
 * Small, dependency-free SVG charts for Site Analytics.
 *
 * Emphasis over categories: this period is the purple accent, the previous
 * period is a quiet gray, and the one bar that matters (the peak) is the only
 * saturated mark. Every mark has a hover/focus tooltip, and every chart can be
 * read as a table, so no value is color- or hover-only.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export const ACCENT = "#5b4fe8";
export const ACCENT_SOFT = "#b7b0f5";
export const PREVIOUS = "#8b8ea6";
const GRID = "#e6e7f1";
// Sequential purple ramp for the busy-times grid (light = quiet, dark = busy).
const RAMP = ["#f1f0fb", "#e1ddfc", "#c9c3f8", "#9d92f2", "#6f60e9", "#4a3cc9", "#2e2596"];

export const compact = (value: number) =>
  value >= 10000 ? `${(value / 1000).toFixed(0)}K` : value >= 1000 ? `${(value / 1000).toFixed(1)}K` : `${value}`;
export const hourLabel = (hour: number) =>
  hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`;
const shortHour = (hour: number) => (hour === 0 ? "12a" : hour < 12 ? `${hour}a` : hour === 12 ? "12p" : `${hour - 12}p`);

/** A clean axis maximum and ~4 ticks. */
function niceScale(max: number) {
  if (max <= 4) return { top: Math.max(1, max), ticks: Array.from({ length: Math.max(1, max) + 1 }, (_, i) => i) };
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? rough;
  const top = Math.ceil(max / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step)) };
}

/** Column with a 4px rounded data-end and a square base. */
function column(x: number, y: number, width: number, base: number) {
  const h = base - y;
  if (h <= 0) return "";
  const r = Math.min(4, width / 2, h);
  return `M${x} ${base}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + width - r}Q${x + width} ${y} ${x + width} ${y + r}V${base}Z`;
}

/**
 * The plot's real pixel width, so charts lay out in pixels and text keeps its
 * size instead of scaling with the card.
 */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.max(260, Math.round(element.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

type Tip = { x: number; y: number; title: string; rows: { label: string; value: string; color?: string }[] } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div className="an-tooltip" role="status" style={{ left: `${Math.min(88, Math.max(12, tip.x))}%` }}>
      <span className="an-tooltip-title">{tip.title}</span>
      {tip.rows.map((row) => (
        <span className="an-tooltip-row" key={row.label}>
          {row.color && <i style={{ background: row.color }} />}
          <strong>{row.value}</strong>
          <small>{row.label}</small>
        </span>
      ))}
    </div>
  );
}

/** A chart card with a title, optional legend, and a table view toggle. */
export function ChartCard({ title, subtitle, legend, table, children, className = "" }: {
  title: string;
  subtitle?: ReactNode;
  legend?: { label: string; color: string }[];
  table: { head: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <section className={`an-card ${className}`} aria-labelledby={id}>
      <header className="an-card-head">
        <div>
          <h3 id={id}>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button type="button" className="an-table-toggle" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          {asTable ? "Chart" : "Table"}
        </button>
      </header>
      {legend && legend.length > 1 && !asTable && (
        <ul className="an-legend" aria-label="Legend">
          {legend.map((item) => (
            <li key={item.label}><i style={{ background: item.color }} />{item.label}</li>
          ))}
        </ul>
      )}
      {asTable ? (
        <div className="an-table-wrap">
          <table className="an-table">
            <thead><tr>{table.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
    </section>
  );
}

/** Visits per day: this period (accent) beside the same weekday last period (gray). */
export function DailyCompare({ days }: { days: { label: string; visits: number; previous: number; today?: boolean }[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const [holder, W] = useWidth();
  const H = 230, left = 34, bottom = 28, top = 20;
  const { top: max, ticks } = niceScale(Math.max(1, ...days.flatMap((d) => [d.visits, d.previous])));
  const band = (W - left) / days.length;
  const bar = Math.min(24, (band - 14) / 2);
  const y = (v: number) => top + (1 - v / max) * (H - top - bottom);
  const base = H - bottom;
  const best = days.reduce((a, d, i) => (d.visits > days[a].visits ? i : a), 0);
  return (
    <div className="an-plot" ref={holder} onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Visits per day, this week and last week">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
            <text x={left - 8} y={y(t) + 4} textAnchor="end" className="an-axis">{compact(t)}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const cx = left + band * i + band / 2;
          const show = () => setTip({ x: (cx / W) * 100, y: y(Math.max(d.visits, d.previous)) * 0.6, title: d.label,
            rows: [{ label: "This week", value: `${d.visits}`, color: ACCENT }, { label: "Last week", value: `${d.previous}`, color: PREVIOUS }] });
          return (
            <g key={i} tabIndex={0} role="button" aria-label={`${d.label}: ${d.visits} visits, ${d.previous} last week`}
              onPointerEnter={show} onFocus={show} onBlur={() => setTip(null)} onClick={show} className="an-hit">
              <rect x={cx - band / 2} y={top} width={band} height={base - top} fill="transparent" />
              <path d={column(cx - bar - 1, y(d.previous), bar, base)} fill={PREVIOUS} opacity={0.55} />
              <path d={column(cx + 1, y(d.visits), bar, base)} fill={ACCENT} />
              {i === best && d.visits > 0 && (
                <text x={cx + 1 + bar / 2} y={y(d.visits) - 6} textAnchor="middle" className="an-value">{d.visits}</text>
              )}
              <text x={cx} y={H - 8} textAnchor="middle" className={`an-axis${d.today ? " an-axis-strong" : ""}`}>{d.label}</text>
            </g>
          );
        })}
        <line x1={left} x2={W} y1={base} y2={base} stroke="#c9cbe0" strokeWidth="1" />
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Visits by hour of day; the peak hour is the one saturated bar. */
export function HourlyColumns({ hours, peak }: { hours: { hour: number; visits: number; previous: number }[]; peak: number | null }) {
  const [tip, setTip] = useState<Tip>(null);
  const [holder, W] = useWidth();
  const H = 210, left = 30, bottom = 26, top = 20;
  const { top: max, ticks } = niceScale(Math.max(1, ...hours.map((h) => h.visits)));
  const band = (W - left) / 24;
  const bar = Math.min(18, band - 4);
  const y = (v: number) => top + (1 - v / max) * (H - top - bottom);
  const base = H - bottom;
  const every = W < 420 ? 6 : 3;
  return (
    <div className="an-plot" ref={holder} onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Visits by hour of day this week">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
            <text x={left - 7} y={y(t) + 4} textAnchor="end" className="an-axis">{compact(t)}</text>
          </g>
        ))}
        {hours.map((h) => {
          const cx = left + band * h.hour + band / 2;
          const isPeak = h.hour === peak && h.visits > 0;
          const show = () => setTip({ x: (cx / W) * 100, y: y(h.visits) * 0.6, title: `${hourLabel(h.hour)} – ${hourLabel((h.hour + 1) % 24)}`,
            rows: [{ label: "This week", value: `${h.visits}`, color: ACCENT }, { label: "Last week", value: `${h.previous}`, color: PREVIOUS }] });
          return (
            <g key={h.hour} tabIndex={0} role="button" className="an-hit" aria-label={`${hourLabel(h.hour)}: ${h.visits} visits`}
              onPointerEnter={show} onFocus={show} onBlur={() => setTip(null)} onClick={show}>
              <rect x={cx - band / 2} y={top} width={band} height={base - top} fill="transparent" />
              <path d={column(cx - bar / 2, y(h.visits), bar, base)} fill={isPeak ? ACCENT : ACCENT_SOFT} />
              {isPeak && <text x={cx} y={y(h.visits) - 6} textAnchor="middle" className="an-value">{h.visits}</text>}
              {h.hour % every === 0 && <text x={cx} y={H - 7} textAnchor="middle" className="an-axis">{shortHour(h.hour)}</text>}
            </g>
          );
        })}
        <line x1={left} x2={W} y1={base} y2={base} stroke="#c9cbe0" strokeWidth="1" />
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Busy times: days down the side, hours across, darker = busier. */
export function BusyGrid({ rows }: { rows: { label: string; counts: number[] }[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const max = Math.max(0, ...rows.flatMap((r) => r.counts));
  const shade = (v: number) => (v <= 0 || max <= 0 ? RAMP[0] : RAMP[Math.min(RAMP.length - 1, 1 + Math.floor((v / max) * (RAMP.length - 1.01)))]);
  const [holder, W] = useWidth();
  const left = 40, top = 6, cell = (W - left) / 24, rowH = Math.max(18, Math.min(26, cell * 1.4));
  const H = top + rows.length * rowH + 22;
  return (
    <div className="an-plot" ref={holder} onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Busy times by day and hour">
        {rows.map((row, r) => (
          <g key={row.label}>
            <text x={left - 8} y={top + r * rowH + rowH / 2 + 4} textAnchor="end" className="an-axis">{row.label}</text>
            {row.counts.map((v, h) => {
              const show = () => setTip({ x: ((left + cell * h + cell / 2) / W) * 100, y: (top + r * rowH) * 0.6 - 10,
                title: `${row.label}, ${hourLabel(h)}`, rows: [{ label: v === 1 ? "visit" : "visits", value: `${v}` }] });
              return (
                <rect key={h} x={left + cell * h + 1} y={top + r * rowH + 1} width={cell - 2} height={rowH - 2} rx="3"
                  fill={shade(v)} tabIndex={0} className="an-cell" aria-label={`${row.label} ${hourLabel(h)}: ${v} visits`}
                  onPointerEnter={show} onFocus={show} onBlur={() => setTip(null)} onClick={show} />
              );
            })}
          </g>
        ))}
        {[0, 6, 12, 18].map((h) => (
          <text key={h} x={left + cell * h + cell / 2} y={H - 6} textAnchor="middle" className="an-axis">{shortHour(h)}</text>
        ))}
      </svg>
      <div className="an-ramp" aria-hidden="true"><span>Quiet</span>{RAMP.map((c) => <i key={c} style={{ background: c }} />)}<span>Busy</span></div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Ranked horizontal bars (zones, entrances), value at the tip, change beside it. */
export function RankedBars({ items, emptyLabel, quietest }: {
  items: { name: string; value: number; previous: number; note?: string }[];
  emptyLabel: string;
  quietest?: string | null;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="an-empty">{emptyLabel}</p>;
  return (
    <ol className="an-ranked">
      {items.map((item, index) => {
        const delta = item.value - item.previous;
        return (
          <li key={item.name} className={item.name === quietest ? "is-quiet" : index === 0 && item.value ? "is-top" : ""}>
            <span className="an-ranked-name" title={item.name}>{item.name}</span>
            <span className="an-ranked-track" aria-hidden="true">
              <span style={{ width: `${Math.max(item.value ? 3 : 0, (item.value / max) * 100)}%` }} />
            </span>
            <span className="an-ranked-value"><strong>{item.value}</strong>
              <small className={delta > 0 ? "up" : delta < 0 ? "down" : ""}>
                {item.previous || item.value ? `${delta > 0 ? "+" : ""}${delta} vs last wk` : "—"}
              </small>
            </span>
            {item.note && <span className="an-ranked-note">{item.note}</span>}
          </li>
        );
      })}
    </ol>
  );
}
