"use client";
/**
 * Hand-rolled SVG charts for the console, following the dataviz method:
 * thin marks (bars ≤ 24 px, 4 px rounded data-ends, square at the baseline; 2 px lines; ≥ 8 px markers),
 * a 2 px surface gap between stacked segments, hairline grid, one axis per chart, a legend for ≥ 2 series,
 * labels in text ink (never the series colour), hover on every mark, and a table view for every chart.
 * Colours come from CSS tokens (validated palette, light and dark), so a series keeps its colour everywhere.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { niceTicks } from "../../lib/format";

// ---------- layout helpers ----------

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e?.contentRect.width ?? 640))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** A bar with rounded data-end and a square base. `dir` = where the data end is. */
function barPath(x: number, y: number, w: number, h: number, dir: "up" | "right" | "left", r = 4): string {
  if (w <= 0 || h <= 0) return "";
  const rr = Math.min(r, dir === "up" ? h : w, dir === "up" ? w / 2 : h / 2);
  if (dir === "up") return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
  if (dir === "right") return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
  return `M${x + w},${y}H${x + rr}Q${x},${y} ${x},${y + rr}V${y + h - rr}Q${x},${y + h} ${x + rr},${y + h}H${x + w}Z`;
}

export interface Series { key: string; label: string; color: string; values: number[] }
export interface TipState { x: number; y: number; head: string; rows: { label: string; value: string; color?: string }[] }

export function Tip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div className="tip" style={{ left: tip.x, top: tip.y, transform: "translate(-50%, calc(-100% - 10px))" }} role="status">
      <div className="t-head">{tip.head}</div>
      {tip.rows.map((r) => (
        <div className="t-row" key={r.label}>
          <b>{r.value}</b>
          <span>{r.color ? <i style={{ background: r.color }} /> : null}{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items, kind = "rect" }: { items: { label: string; color: string }[]; kind?: "rect" | "line" }) {
  if (items.length < 2) return null;
  return (
    <div className="legend" aria-hidden>
      {items.map((i) => (
        <span key={i.label}><i className={kind === "line" ? "line" : ""} style={{ background: i.color }} />{i.label}</span>
      ))}
    </div>
  );
}

/** A chart card: title, subtitle, legend, and a table view of exactly the plotted data. */
export function ChartCard({ title, sub, legend, legendKind, table, children, labels }: {
  title: string; sub?: string; legend?: { label: string; color: string }[]; legendKind?: "rect" | "line";
  table: { columns: string[]; rows: (string | number)[][]; numeric?: boolean[] };
  children: ReactNode; labels: { table: string; chart: string };
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {sub ? <p>{sub}</p> : null}
        </div>
        <button className="link-btn" type="button" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? labels.chart : labels.table}
        </button>
      </div>
      {asTable ? (
        <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
          <table className="data">
            <thead><tr>{table.columns.map((c, i) => <th key={c} className={table.numeric?.at(i) ? "num" : ""}>{c}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={table.numeric?.at(j) ? "num" : ""}>{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <>
          {legend ? <Legend items={legend} kind={legendKind} /> : null}
          {children}
        </>
      )}
    </section>
  );
}

// ---------- column chart (stacked when several series) ----------

export function Columns({ categories, series, format, height = 220, labelEvery }: {
  categories: string[]; series: Series[]; format: (v: number) => string; height?: number; labelEvery?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const [hover, setHover] = useState(-1);
  const left = 44, right = 8, top = 8, bottom = 24;
  const totals = categories.map((_, i) => series.reduce((s, se) => s + (se.values.at(i) ?? 0), 0));
  const ticks = niceTicks(Math.max(1, ...totals));
  const max = ticks.at(-1) ?? 1;
  const plotW = width - left - right, plotH = height - top - bottom;
  const band = plotW / Math.max(1, categories.length);
  const bw = Math.max(2, Math.min(24, band * 0.62));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const every = labelEvery ?? Math.max(1, Math.ceil(categories.length / Math.max(2, Math.floor(plotW / 64))));
  return (
    <div className="chart" ref={ref} onPointerLeave={() => { setTip(null); setHover(-1); }}>
      <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label={series.map((s) => s.label).join(", ")}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "baseline" : "gridline"} x1={left} x2={width - right} y1={y(t)} y2={y(t)} />
            <text className="tick" x={left - 6} y={y(t) + 4} textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {categories.map((c, i) => {
          const cx = left + band * i + band / 2;
          let acc = 0;
          return (
            <g key={c} opacity={hover >= 0 && hover !== i ? 0.55 : 1}>
              {series.map((s, k) => {
                const v = s.values.at(i) ?? 0;
                if (v <= 0) return null;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                const isTop = series.slice(k + 1).every((n) => (n.values.at(i) ?? 0) <= 0);
                const h = Math.max(0, y0 - y1 - (k > 0 ? 2 : 0)); // 2 px surface gap between segments
                return isTop
                  ? <path key={s.key} d={barPath(cx - bw / 2, y1, bw, h, "up")} fill={s.color} />
                  : <rect key={s.key} x={cx - bw / 2} y={y1} width={bw} height={h} fill={s.color} />;
              })}
              {i % every === 0 ? <text x={cx} y={height - 6} textAnchor="middle">{c}</text> : null}
              <rect x={left + band * i} y={top} width={band} height={plotH} fill="transparent"
                onPointerMove={(e) => {
                  const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setHover(i);
                  setTip({ x: (cx / width) * box.width, y: (y(totals.at(i) ?? 0) / height) * box.height, head: c, rows: series.map((s) => ({ label: s.label, value: format(s.values.at(i) ?? 0), color: s.color })) });
                }} />
            </g>
          );
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

// ---------- line (single series, area wash, crosshair) ----------

export function Line({ categories, values, label, color, format, height = 220 }: {
  categories: string[]; values: number[]; label: string; color: string; format: (v: number) => string; height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const [at, setAt] = useState(-1);
  const left = 52, right = 16, top = 12, bottom = 24;
  const ticks = niceTicks(Math.max(1, ...values));
  const max = ticks.at(-1) ?? 1;
  const plotW = width - left - right, plotH = height - top - bottom;
  const x = (i: number) => left + (values.length <= 1 ? plotW / 2 : (i / (values.length - 1)) * plotW);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const every = Math.max(1, Math.ceil(categories.length / Math.max(2, Math.floor(plotW / 72))));
  const last = values.length - 1;
  return (
    <div className="chart" ref={ref} onPointerLeave={() => { setTip(null); setAt(-1); }}>
      <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label={label}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * width;
          const i = Math.max(0, Math.min(last, Math.round(((px - left) / plotW) * last)));
          setAt(i);
          setTip({ x: (x(i) / width) * box.width, y: (y(values.at(i) ?? 0) / height) * box.height, head: categories.at(i) ?? "", rows: [{ label, value: format(values.at(i) ?? 0), color }] });
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "baseline" : "gridline"} x1={left} x2={width - right} y1={y(t)} y2={y(t)} />
            <text className="tick" x={left - 6} y={y(t) + 4} textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {categories.map((c, i) => (i % every === 0 ? <text key={c} x={x(i)} y={height - 6} textAnchor="middle">{c}</text> : null))}
        {values.length > 1 ? <polygon points={`${x(0)},${y(0)} ${pts} ${x(last)},${y(0)}`} fill={color} opacity="0.1" /> : null}
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {at >= 0 ? <line x1={x(at)} x2={x(at)} y1={top} y2={top + plotH} stroke="var(--axis)" /> : null}
        {values.length ? <circle cx={x(at >= 0 ? at : last)} cy={y(values.at(at >= 0 ? at : last) ?? 0)} r="4.5" fill={color} stroke="var(--surface)" strokeWidth="2" /> : null}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

// ---------- horizontal bars (rankings) ----------

export function HBars({ rows, format, color = "var(--s1)", sub }: {
  rows: { label: string; value: number }[]; format: (v: number) => string; color?: string; sub?: (i: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const labelW = Math.min(170, width * 0.38), valueW = 76, rowH = 30, bh = 16;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const plotW = width - labelW - valueW;
  const height = rows.length * rowH + 4;
  return (
    <div className="chart" ref={ref} onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label="ranking">
        <line className="baseline" x1={labelW} x2={labelW} y1={0} y2={height} />
        {rows.map((r, i) => {
          const yy = i * rowH + (rowH - bh) / 2;
          const w = (r.value / max) * plotW;
          const name = r.label.length > 24 ? `${r.label.slice(0, 23)}…` : r.label;
          return (
            <g key={`${r.label}-${i}`}>
              <text x={labelW - 8} y={yy + bh / 2 + 4} textAnchor="end" style={{ fill: "var(--ink-2)" }}>{name}</text>
              <path d={barPath(labelW, yy, Math.max(1, w), bh, "right")} fill={color} />
              <text className="tick" x={labelW + w + 6} y={yy + bh / 2 + 4} style={{ fill: "var(--ink)" }}>{format(r.value)}</text>
              <rect x={0} y={i * rowH} width={width} height={rowH} fill="transparent"
                onPointerMove={(e) => {
                  const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setTip({ x: ((labelW + w / 2) / width) * box.width, y: (yy / height) * box.height, head: r.label, rows: [{ label: sub ? sub(i) : "", value: format(r.value), color }] });
                }} />
            </g>
          );
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

// ---------- heatmap (sequential, one hue) ----------

const RAMP = ["var(--seq-100)", "var(--seq-200)", "var(--seq-300)", "var(--seq-400)", "var(--seq-500)", "var(--seq-600)", "var(--seq-700)"];

export function Heatmap({ rows, cols, value, rowLabels, colLabel, format, legendLow, legendHigh }: {
  rows: number; cols: number; value: (r: number, c: number) => number; rowLabels: string[]; colLabel: (c: number) => string;
  format: (v: number) => string; legendLow: string; legendHigh: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const left = 40, top = 4, gap = 2;
  const cw = (width - left) / cols, ch = 22;
  const height = top + rows * ch + 26 + 22;
  let max = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) max = Math.max(max, value(r, c));
  const step = (v: number) => (v <= 0 ? -1 : Math.min(RAMP.length - 1, Math.floor((v / Math.max(1, max)) * RAMP.length)));
  return (
    <div className="chart" ref={ref} onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label="heatmap">
        {rowLabels.map((l, r) => <text key={l} x={left - 6} y={top + r * ch + ch / 2 + 4} textAnchor="end">{l}</text>)}
        {Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => {
          const v = value(r, c), s = step(v);
          return (
            <rect key={`${r}-${c}`} x={left + c * cw + gap / 2} y={top + r * ch + gap / 2} width={Math.max(1, cw - gap)} height={ch - gap} rx="3"
              fill={s < 0 ? "var(--surface-2)" : RAMP.at(s)}
              onPointerMove={(e) => {
                const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setTip({ x: ((left + c * cw + cw / 2) / width) * box.width, y: ((top + r * ch) / height) * box.height, head: `${rowLabels.at(r)} · ${colLabel(c)}`, rows: [{ label: "", value: format(v) }] });
              }} />
          );
        }))}
        {Array.from({ length: cols }, (_, c) => (c % 3 === 0 ? <text key={c} x={left + c * cw + cw / 2} y={top + rows * ch + 16} textAnchor="middle">{colLabel(c)}</text> : null))}
        <g transform={`translate(${left}, ${top + rows * ch + 30})`}>
          <text x="0" y="10">{legendLow}</text>
          {RAMP.map((c, i) => <rect key={c} x={44 + i * 22} y="0" width="20" height="12" rx="2" fill={c} />)}
          <text x={44 + RAMP.length * 22 + 6} y="10">{legendHigh}</text>
        </g>
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

// ---------- funnel (ordinal ramp) ----------

const ORDINAL = ["var(--seq-600)", "var(--seq-500)", "var(--seq-400)", "var(--seq-300)", "var(--seq-300)"];

export function Funnel({ stages, format, keptLabel }: { stages: { label: string; value: number }[]; format: (v: number) => string; keptLabel: (ratio: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const first = Math.max(1, stages.at(0)?.value ?? 1);
  const labelW = Math.min(150, width * 0.32), rowH = 40, bh = 22;
  const plotW = width - labelW - 100;
  const height = stages.length * rowH;
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label="funnel">
        {stages.map((s, i) => {
          const w = Math.max(2, (s.value / first) * plotW);
          const yy = i * rowH + 4;
          const prev = i > 0 ? stages.at(i - 1)?.value ?? 0 : 0;
          return (
            <g key={s.label}>
              <text x={labelW - 8} y={yy + bh / 2 + 4} textAnchor="end" style={{ fill: "var(--ink-2)" }}>{s.label}</text>
              <path d={barPath(labelW, yy, w, bh, "right")} fill={ORDINAL.at(i) ?? "var(--seq-300)"} />
              <text className="tick" x={labelW + w + 6} y={yy + bh / 2 + 4} style={{ fill: "var(--ink)" }}>{format(s.value)}</text>
              {i > 0 && prev > 0 ? <text x={labelW} y={yy + bh + 13}>{keptLabel(s.value / prev)}</text> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- 100% share bars (part-to-whole, ≤ 6 parts) ----------

export function ShareBars({ bars }: { bars: { label: string; parts: { label: string; value: number; color: string }[] }[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const labelW = Math.min(130, width * 0.3), rowH = 44, bh = 22;
  const plotW = width - labelW - 8;
  const height = bars.length * rowH;
  return (
    <div className="chart" ref={ref} onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label="shares">
        {bars.map((b, i) => {
          const total = Math.max(1, b.parts.reduce((s, p) => s + p.value, 0));
          let acc = 0;
          const yy = i * rowH + 8;
          return (
            <g key={b.label}>
              <text x={labelW - 8} y={yy + bh / 2 + 4} textAnchor="end" style={{ fill: "var(--ink-2)" }}>{b.label}</text>
              {b.parts.filter((p) => p.value > 0).map((p, k, arr) => {
                const x0 = labelW + (acc / total) * plotW;
                acc += p.value;
                const w = Math.max(0, (p.value / total) * plotW - (k < arr.length - 1 ? 2 : 0));
                const share = `${Math.round((p.value / total) * 100)}%`;
                const fits = w > share.length * 7 + 12;
                return (
                  <g key={p.label}
                    onPointerMove={(e) => {
                      const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      setTip({ x: ((x0 + w / 2) / width) * box.width, y: (yy / height) * box.height, head: b.label, rows: [{ label: p.label, value: `${p.value} · ${share}`, color: p.color }] });
                    }}>
                    <rect x={x0} y={yy} width={w} height={bh} fill={p.color} rx={k === 0 || k === arr.length - 1 ? 3 : 0} />
                    {fits ? <text x={x0 + w / 2} y={yy + bh / 2 + 4} textAnchor="middle" style={{ fill: "#fff", fontWeight: 600 }}>{share}</text> : null}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

// ---------- diverging bars around zero (ledger balances) ----------

export function Diverging({ rows, format }: { rows: { label: string; value: number }[]; format: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const labelW = Math.min(190, width * 0.36), rowH = 30, bh = 16;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const plotW = width - labelW - 16;
  const mid = labelW + plotW / 2;
  const height = rows.length * rowH + 4;
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label="balances">
        <line className="baseline" x1={mid} x2={mid} y1={0} y2={height} />
        {rows.map((r, i) => {
          const yy = i * rowH + (rowH - bh) / 2;
          const w = (Math.abs(r.value) / max) * (plotW / 2 - 60);
          const pos = r.value >= 0;
          return (
            <g key={r.label}>
              <text x={labelW - 8} y={yy + bh / 2 + 4} textAnchor="end" style={{ fill: "var(--ink-2)" }}>{r.label}</text>
              <path d={pos ? barPath(mid, yy, Math.max(1, w), bh, "right") : barPath(mid - Math.max(1, w), yy, Math.max(1, w), bh, "left")} fill={pos ? "var(--div-pos)" : "var(--div-neg)"} />
              <text className="tick" x={pos ? mid + w + 6 : mid - w - 6} y={yy + bh / 2 + 4} textAnchor={pos ? "start" : "end"} style={{ fill: "var(--ink)" }}>{format(r.value)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- stat tile with sparkline ----------

export function StatTile({ label, value, delta, upIsGood = true, spark, hero }: {
  label: string; value: string; delta?: { text: string; dir: "up" | "down" | "flat"; note: string }; upIsGood?: boolean; spark?: number[]; hero?: boolean;
}) {
  const good = delta && delta.dir !== "flat" ? (delta.dir === "up") === upIsGood : null;
  const max = Math.max(1, ...(spark ?? [0]));
  const pts = (spark ?? []).map((v, i, a) => `${(i / Math.max(1, a.length - 1)) * 100},${28 - (v / max) * 26}`).join(" ");
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className={`value ${hero ? "hero" : ""}`}>{value}</div>
      {delta ? (
        <div className="delta">
          {delta.dir === "flat" && delta.text === "—" ? null : <><b className={good === null ? "" : `${delta.dir}-${good ? "good" : "bad"}`}>{delta.dir === "up" ? "▲" : delta.dir === "down" ? "▼" : "■"} {delta.text}</b>{" "}</>}{delta.note}
        </div>
      ) : null}
      {spark && spark.length > 1 ? (
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: "100%", height: 30, marginTop: 6 }} aria-hidden>
          <polyline points={pts} fill="none" stroke="var(--muted)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          <circle cx="100" cy={28 - ((spark.at(-1) ?? 0) / max) * 26} r="2.5" fill="var(--s1)" />
        </svg>
      ) : null}
    </div>
  );
}
