"use client";
/**
 * A small slippy map with no library: Web Mercator tiles from the configured provider, pins and route lines on top.
 *
 *   NEXT_PUBLIC_MAP_TILES        tile URL template, e.g. https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=…
 *                                ({s} picks a, b or c for providers that shard). Unset: a drawn street-grid background.
 *   NEXT_PUBLIC_MAP_ATTRIBUTION  the provider's required credit, e.g. "© MapTiler © OpenStreetMap contributors".
 *
 * Pins and routes always show; if tiles cannot load (no network, no key) the drawn background stays, so the
 * map never goes blank on a weak connection.
 */
import { useEffect, useMemo, useRef, useState } from "react";

export type PinKind = "kitchen" | "drop" | "rider" | "rider-busy" | "rider-offer" | "rider-off" | "me";
export interface MapPin { readonly lat: number; readonly lng: number; readonly kind: PinKind; readonly label?: string; readonly title?: string; readonly id?: string }
export interface MapRoute { readonly from: { lat: number; lng: number }; readonly to: { lat: number; lng: number }; readonly done?: boolean }

const TILES = process.env.NEXT_PUBLIC_MAP_TILES ?? "";
const CREDIT = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? (TILES ? "© OpenStreetMap contributors" : "");
const TILE = 256;

const px = (lat: number, lng: number, z: number) => {
  const s = TILE * 2 ** z;
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * s, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s };
};

export function TileMap({ pins, routes = [], height = 280, className, onPin, selected }: {
  pins: readonly MapPin[]; routes?: readonly MapRoute[]; height?: number; className?: string; onPin?: (p: MapPin) => void; selected?: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => {
    const pts = [...pins.map((p) => ({ lat: p.lat, lng: p.lng })), ...routes.flatMap((r) => [r.from, r.to])];
    if (!width || pts.length === 0) return null;
    const pad = 48;
    let z = 16;
    if (pts.length > 1) {
      for (z = 17; z > 3; z--) {
        const xy = pts.map((p) => px(p.lat, p.lng, z));
        const w = Math.max(...xy.map((q) => q.x)) - Math.min(...xy.map((q) => q.x));
        const h = Math.max(...xy.map((q) => q.y)) - Math.min(...xy.map((q) => q.y));
        if (w <= width - pad * 2 && h <= height - pad * 2) break;
      }
    }
    const xy = pts.map((p) => px(p.lat, p.lng, z));
    const cx = (Math.max(...xy.map((q) => q.x)) + Math.min(...xy.map((q) => q.x))) / 2;
    const cy = (Math.max(...xy.map((q) => q.y)) + Math.min(...xy.map((q) => q.y))) / 2;
    return { z, ox: width / 2 - cx, oy: height / 2 - cy };
  }, [pins, routes, width, height]);

  const at = (lat: number, lng: number) => {
    const p = px(lat, lng, view!.z);
    return { left: p.x + view!.ox, top: p.y + view!.oy };
  };

  const tiles: { key: string; src: string; left: number; top: number }[] = [];
  if (view && TILES && !failed) {
    const n = 2 ** view.z;
    const x0 = Math.floor(-view.ox / TILE), x1 = Math.floor((width - view.ox) / TILE);
    const y0 = Math.floor(-view.oy / TILE), y1 = Math.floor((height - view.oy) / TILE);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= n) continue;
      const wx = ((x % n) + n) % n;
      const src = TILES.replace("{z}", String(view.z)).replace("{x}", String(wx)).replace("{y}", String(y)).replace("{s}", "abc"[(wx + y) % 3]!);
      tiles.push({ key: `${view.z}/${x}/${y}`, src, left: x * TILE + view.ox, top: y * TILE + view.oy });
    }
  }

  return (
    <div ref={box} className={`tmap ${TILES && !failed ? "has-tiles" : "drawn"} ${className ?? ""}`} style={{ height }} role="img" aria-label={pins.map((p) => p.title ?? p.label ?? p.kind).join(", ")}>
      {tiles.map((t) => (
        <img key={t.key} className="tmap-tile" src={t.src} alt="" width={TILE} height={TILE} style={{ left: t.left, top: t.top }} loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ))}
      {view ? (
        <svg className="tmap-routes" width={width} height={height} aria-hidden>
          {routes.map((r, i) => {
            const a = at(r.from.lat, r.from.lng), b = at(r.to.lat, r.to.lng);
            return <line key={i} x1={a.left} y1={a.top} x2={b.left} y2={b.top} className={r.done ? "done" : ""} />;
          })}
        </svg>
      ) : null}
      {view ? pins.map((p, i) => {
        const pos = at(p.lat, p.lng);
        return (
          <button key={p.id ?? i} type="button" className={`tmap-pin ${p.kind} ${selected && p.id === selected ? "sel" : ""}`} style={pos} title={p.title ?? p.label} onClick={onPin ? () => onPin(p) : undefined} tabIndex={onPin ? 0 : -1}>
            <span className="tmap-dot">{p.label ? <b>{p.label}</b> : null}</span>
          </button>
        );
      }) : null}
      {CREDIT && TILES && !failed ? <span className="tmap-credit">{CREDIT}</span> : null}
      {!TILES || failed ? <span className="tmap-credit">Simplified map</span> : null}
    </div>
  );
}
