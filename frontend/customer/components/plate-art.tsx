/**
 * Top-down plate illustrations, drawn as SVG (server or browser).
 *
 * Stand-ins until merchants upload real photographs: wherever /public/photos/<slug>.(webp|jpg)
 * exists, the photo is shown instead (see `FoodImage`). Shapes are organic (seeded noise, so the
 * same dish always draws the same way), lit from the top left, with sauce sheen, grain and char.
 */

export type Recipe =
  | "moambe" | "pondu" | "liboke" | "makemba" | "brochettes" | "fumbwa" | "mbika" | "jus"
  | "beignets" | "pain" | "riz" | "poisson" | "saka" | "chikwangue" | "fruits" | "grocery";

// ---------- geometry helpers ----------
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const hash = (t: string) => [...t].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);
const f = (n: number) => Math.round(n * 10) / 10;

/** A closed, smooth blob around (cx, cy). */
function blob(r: () => number, cx: number, cy: number, rx: number, ry: number, wobble = 0.12, points = 9, rot = 0): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const a = rot + (i / points) * Math.PI * 2;
    const k = 1 + (r() * 2 - 1) * wobble;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  // Catmull-Rom → cubic Bézier.
  let d = `M${f(pts[0]![0])},${f(pts[0]![1])}`;
  for (let i = 0; i < points; i++) {
    const p0 = pts[(i - 1 + points) % points]!, p1 = pts[i]!, p2 = pts[(i + 1) % points]!, p3 = pts[(i + 2) % points]!;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0]!)},${f(c1[1]!)} ${f(c2[0]!)},${f(c2[1]!)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + "Z";
}

/** Scatter n points inside a circle (rejection sampling). */
function scatter(r: () => number, n: number, cx: number, cy: number, radius: number): [number, number][] {
  const out: [number, number][] = [];
  while (out.length < n) {
    const x = (r() * 2 - 1) * radius, y = (r() * 2 - 1) * radius;
    if (x * x + y * y <= radius * radius) out.push([cx + x, cy + y]);
  }
  return out;
}

// ---------- shared defs (filters and gradients) ----------
function Defs({ id }: { id: string }) {
  return (
    <defs>
      <radialGradient id={`${id}-plate`} cx="42%" cy="38%" r="70%">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.72" stopColor="#f3efe8" />
        <stop offset="1" stopColor="#d9d1c4" />
      </radialGradient>
      <radialGradient id={`${id}-well`} cx="45%" cy="40%" r="62%">
        <stop offset="0" stopColor="#fbf9f5" />
        <stop offset="1" stopColor="#e7e0d4" />
      </radialGradient>
      <radialGradient id={`${id}-sheen`} cx="35%" cy="30%" r="55%">
        <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
        <stop offset="0.45" stopColor="#fff" stopOpacity="0.12" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${id}-shade`} cx="62%" cy="66%" r="60%">
        <stop offset="0.55" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.28" />
      </radialGradient>
      <filter id={`${id}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="9" />
        <feOffset dx="6" dy="12" result="b" />
        <feComponentTransfer><feFuncA type="linear" slope="0.38" /></feComponentTransfer>
        <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id={`${id}-soft`} x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="2.2" />
        <feOffset dx="1.5" dy="3" />
        <feComponentTransfer><feFuncA type="linear" slope="0.45" /></feComponentTransfer>
        <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      {/* Food texture: fine noise multiplied in, so flat colour reads as cooked surface. */}
      <filter id={`${id}-tex`} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0" result="g" />
        <feComposite in="g" in2="SourceGraphic" operator="in" result="gi" />
        <feBlend in="SourceGraphic" in2="gi" mode="multiply" />
      </filter>
      <filter id={`${id}-rough`}>
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="t" />
        <feDisplacementMap in="SourceGraphic" in2="t" scale="10" />
      </filter>
    </defs>
  );
}

// ---------- food parts ----------
type R = () => number;

function Rice({ r, id, cx, cy, rad }: { r: R; id: string; cx: number; cy: number; rad: number }) {
  return (
    <g filter={`url(#${id}-soft)`}>
      <path d={blob(r, cx, cy, rad, rad * 0.92, 0.1, 11)} fill="#f6f1e6" />
      <g>
        {scatter(r, 170, cx, cy, rad * 0.93).map(([x, y], i) => (
          <ellipse key={i} cx={f(x)} cy={f(y)} rx="4.6" ry="1.9" transform={`rotate(${Math.round(r() * 180)} ${f(x)} ${f(y)})`}
            fill={i % 5 === 0 ? "#e4dccb" : "#fffdf7"} stroke="#d8cfbd" strokeWidth="0.4" />
        ))}
      </g>
      <path d={blob(r, cx, cy, rad, rad * 0.92, 0.1, 11)} fill={`url(#${id}-shade)`} />
    </g>
  );
}

function Sauce({ r, id, cx, cy, rx, ry, base, dark, oil }: { r: R; id: string; cx: number; cy: number; rx: number; ry: number; base: string; dark: string; oil?: string }) {
  return (
    <g>
      <path d={blob(r, cx, cy, rx * 1.04, ry * 1.04, 0.09, 12)} fill={dark} />
      <path d={blob(r, cx - 4, cy - 4, rx, ry, 0.1, 12)} fill={base} filter={`url(#${id}-tex)`} />
      {oil
        ? scatter(r, 16, cx, cy, Math.min(rx, ry) * 0.8).map(([x, y], i) => (
            <ellipse key={i} cx={f(x)} cy={f(y)} rx={f(3 + r() * 9)} ry={f(2 + r() * 5)} fill={oil} opacity={0.45 + r() * 0.3} />
          ))
        : null}
      <path d={blob(r, cx - 4, cy - 4, rx, ry, 0.1, 12)} fill={`url(#${id}-sheen)`} />
    </g>
  );
}

function Chunk({ r, id, x, y, s, fill, char, rot }: { r: R; id: string; x: number; y: number; s: number; fill: string; char: string; rot?: number }) {
  const d = blob(r, x, y, s, s * (0.7 + r() * 0.2), 0.18, 8, rot ?? r() * 6);
  return (
    <g filter={`url(#${id}-soft)`}>
      <path d={d} fill={fill} filter={`url(#${id}-tex)`} />
      <path d={blob(r, x + s * 0.18, y + s * 0.2, s * 0.6, s * 0.4, 0.3, 7)} fill={char} opacity="0.55" />
      <ellipse cx={f(x - s * 0.3)} cy={f(y - s * 0.32)} rx={f(s * 0.32)} ry={f(s * 0.16)} fill="#fff" opacity="0.28" transform={`rotate(-25 ${f(x)} ${f(y)})`} />
    </g>
  );
}

function Greens({ r, n, cx, cy, rad, colors }: { r: R; n: number; cx: number; cy: number; rad: number; colors: string[] }) {
  return (
    <g>
      {scatter(r, n, cx, cy, rad).map(([x, y], i) => (
        <path key={i} d={blob(r, x, y, 2.5 + r() * 5, 1.6 + r() * 3, 0.35, 6)} fill={colors[i % colors.length]} opacity={0.75 + r() * 0.25} />
      ))}
    </g>
  );
}

function Leaf({ r, id, cx, cy, w, h, rot, color = "#3f6b2a", vein = "#a8c27a" }: { r: R; id: string; cx: number; cy: number; w: number; h: number; rot: number; color?: string; vein?: string }) {
  const lines = [];
  for (let i = -4; i <= 4; i++) lines.push(<path key={i} d={`M${cx},${cy + i * h * 0.1} L${cx + w * 0.9},${cy + i * h * 0.1 - h * 0.18}`} stroke={vein} strokeWidth="1" opacity="0.35" />);
  return (
    <g transform={`rotate(${rot} ${cx} ${cy})`} filter={`url(#${id}-soft)`}>
      <path d={`M${cx - w},${cy} C${cx - w * 0.6},${cy - h} ${cx + w * 0.6},${cy - h} ${cx + w},${cy} C${cx + w * 0.6},${cy + h} ${cx - w * 0.6},${cy + h} ${cx - w},${cy}Z`} fill={color} filter={`url(#${id}-tex)`} />
      <path d={`M${cx - w},${cy} L${cx + w},${cy}`} stroke={vein} strokeWidth="2" opacity="0.6" />
      {Array.from({ length: 9 }, (_, i) => {
        const x = cx - w * 0.8 + (i * w * 1.6) / 8;
        return <path key={i} d={`M${f(x)},${cy} q${f(w * 0.08)},${f(-h * 0.45)} ${f(w * 0.18)},${f(-h * 0.7)} M${f(x)},${cy} q${f(w * 0.08)},${f(h * 0.45)} ${f(w * 0.18)},${f(h * 0.7)}`} stroke={vein} strokeWidth="0.9" fill="none" opacity="0.4" />;
      })}
      <ellipse cx={cx - w * 0.3} cy={cy - h * 0.35} rx={w * 0.35} ry={h * 0.18} fill="#fff" opacity="0.12" />
      {r() > 2 ? lines : null}
    </g>
  );
}

function Plantain({ r, id, x, y, s, rot }: { r: R; id: string; x: number; y: number; s: number; rot: number }) {
  return (
    <g transform={`rotate(${rot} ${x} ${y})`} filter={`url(#${id}-soft)`}>
      <ellipse cx={x} cy={y} rx={s} ry={s * 0.62} fill="#7a3d0f" />
      <ellipse cx={x - 1} cy={y - 1} rx={s * 0.9} ry={s * 0.54} fill="#d98a25" filter={`url(#${id}-tex)`} />
      <ellipse cx={x - 1} cy={y - 1} rx={s * 0.55} ry={s * 0.3} fill="#f2b84b" opacity="0.8" />
      <path d={blob(r, x + s * 0.2, y + s * 0.15, s * 0.5, s * 0.25, 0.4, 7)} fill="#8f4510" opacity="0.45" />
    </g>
  );
}

function Fish({ id, cx, cy, len, rot }: { id: string; cx: number; cy: number; len: number; rot: number }) {
  const h = len * 0.36;
  return (
    <g transform={`rotate(${rot} ${cx} ${cy})`} filter={`url(#${id}-soft)`}>
      <path d={`M${cx - len / 2},${cy} C${cx - len * 0.3},${cy - h} ${cx + len * 0.25},${cy - h} ${cx + len * 0.38},${cy} C${cx + len * 0.25},${cy + h} ${cx - len * 0.3},${cy + h} ${cx - len / 2},${cy}Z`} fill="#8a8173" filter={`url(#${id}-tex)`} />
      <path d={`M${cx + len * 0.36},${cy} L${cx + len * 0.55},${cy - h * 0.6} L${cx + len * 0.52},${cy} L${cx + len * 0.55},${cy + h * 0.6}Z`} fill="#6d6457" />
      {Array.from({ length: 5 }, (_, i) => (
        <path key={i} d={`M${cx - len * 0.28 + i * len * 0.13},${cy - h * 0.75} l${len * 0.07},${h * 1.5}`} stroke="#3b2a1a" strokeWidth={len * 0.025} strokeLinecap="round" opacity="0.7" />
      ))}
      <circle cx={cx - len * 0.36} cy={cy - h * 0.12} r={len * 0.035} fill="#f1eadb" />
      <circle cx={cx - len * 0.36} cy={cy - h * 0.12} r={len * 0.018} fill="#1d1712" />
      <ellipse cx={cx - len * 0.05} cy={cy - h * 0.45} rx={len * 0.25} ry={h * 0.14} fill="#fff" opacity="0.22" />
    </g>
  );
}

function Skewer({ r, id, x1, y1, x2, y2 }: { r: R; id: string; x1: number; y1: number; x2: number; y2: number }) {
  const n = 5;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const t = 0.14 + (i / (n - 1)) * 0.72;
    const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
    const onion = i === 2;
    parts.push(onion
      ? <path key={i} d={blob(r, x, y, 13, 11, 0.15, 8)} fill="#e9d7c0" stroke="#c8a98a" strokeWidth="1.5" filter={`url(#${id}-soft)`} />
      : <Chunk key={i} r={r} id={id} x={x} y={y} s={17} fill={i % 2 ? "#6b3216" : "#7d3b18"} char="#2a130a" />);
  }
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#b88a57" strokeWidth="4" strokeLinecap="round" />
      {parts}
    </g>
  );
}

function Glass({ r, id, cx, cy, rad, juice, light }: { r: R; id: string; cx: number; cy: number; rad: number; juice: string; light: string }) {
  return (
    <g filter={`url(#${id}-shadow)`}>
      <circle cx={cx} cy={cy} r={rad} fill="#eef3f1" opacity="0.9" />
      <circle cx={cx} cy={cy} r={rad * 0.9} fill={juice} />
      <circle cx={cx - rad * 0.08} cy={cy - rad * 0.08} r={rad * 0.7} fill={light} opacity="0.55" filter={`url(#${id}-tex)`} />
      {[0, 1, 2].map((i) => {
        const a = r() * 6.28, d = rad * 0.38;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        return <rect key={i} x={f(x - 13)} y={f(y - 13)} width="26" height="26" rx="5" fill="#fff" opacity="0.42" transform={`rotate(${Math.round(r() * 90)} ${f(x)} ${f(y)})`} />;
      })}
      <path d={`M${cx + rad * 0.55},${cy - rad * 0.95} L${cx + rad * 0.15},${cy + rad * 0.2}`} stroke="#2d6a5f" strokeWidth="7" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={rad} fill="none" stroke="#fff" strokeWidth="3" opacity="0.7" />
      <path d={`M${cx - rad * 0.7},${cy - rad * 0.45} A${rad * 0.85},${rad * 0.85} 0 0 1 ${cx - rad * 0.1},${cy - rad * 0.85}`} stroke="#fff" strokeWidth="5" fill="none" opacity="0.6" strokeLinecap="round" />
    </g>
  );
}

function Plate({ id, cx = 200, cy = 200, rad = 170, children, bowl }: { id: string; cx?: number; cy?: number; rad?: number; children: React.ReactNode; bowl?: string }) {
  return (
    <g>
      <g filter={`url(#${id}-shadow)`}>
        <circle cx={cx} cy={cy} r={rad} fill={bowl ?? `url(#${id}-plate)`} />
      </g>
      <circle cx={cx} cy={cy} r={rad * 0.78} fill={bowl ? "#2b211b" : `url(#${id}-well)`} opacity={bowl ? 0.35 : 1} />
      <circle cx={cx} cy={cy} r={rad * 0.78} fill="none" stroke="#000" strokeOpacity="0.06" strokeWidth="3" />
      <path d={`M${cx - rad * 0.86},${cy - rad * 0.3} A${rad * 0.92},${rad * 0.92} 0 0 1 ${cx - rad * 0.2},${cy - rad * 0.9}`} stroke="#fff" strokeOpacity="0.8" strokeWidth="4" fill="none" strokeLinecap="round" />
      {children}
    </g>
  );
}

// ---------- recipes ----------
function draw(recipe: Recipe, id: string, r: R): React.ReactNode {
  switch (recipe) {
    case "moambe":
      return (
        <Plate id={id}>
          <Sauce r={r} id={id} cx={222} cy={214} rx={108} ry={98} base="#b8441a" dark="#7f2a0c" oil="#e8862e" />
          <Rice r={r} id={id} cx={146} cy={150} rad={64} />
          <Chunk r={r} id={id} x={238} y={196} s={34} fill="#9a4a1d" char="#3a170a" />
          <Chunk r={r} id={id} x={196} y={262} s={30} fill="#a65424" char="#40190a" />
          <Chunk r={r} id={id} x={270} y={258} s={27} fill="#93441a" char="#381508" />
          <Greens r={r} n={26} cx={225} cy={225} rad={80} colors={["#2f5a1f", "#4f7d2a", "#1f3d14"]} />
        </Plate>
      );
    case "pondu":
      return (
        <Plate id={id}>
          <Sauce r={r} id={id} cx={212} cy={212} rx={118} ry={110} base="#2f4a1f" dark="#1a2a10" oil="#5b6e22" />
          <Greens r={r} n={150} cx={212} cy={212} rad={105} colors={["#22391a", "#3c5b22", "#4d6b2a", "#1a2c12", "#5a7a2e"]} />
          <Chunk r={r} id={id} x={190} y={188} s={24} fill="#c9a27a" char="#7a5634" />
          <Chunk r={r} id={id} x={248} y={240} s={21} fill="#cfae86" char="#80603e" />
          <ellipse cx={130} cy={276} rx={52} ry={24} fill="#efe7d6" transform="rotate(-28 130 276)" filter={`url(#${id}-soft)`} />
          <ellipse cx={130} cy={276} rx={52} ry={24} fill={`url(#${id}-shade)`} transform="rotate(-28 130 276)" />
        </Plate>
      );
    case "fumbwa":
      return (
        <Plate id={id} bowl="#5a3b28">
          <Sauce r={r} id={id} cx={200} cy={200} rx={128} ry={124} base="#4c5a24" dark="#2b3413" oil="#b98b4b" />
          <Greens r={r} n={120} cx={200} cy={200} rad={112} colors={["#2d3f15", "#506127", "#3a4c1b", "#a77d44"]} />
          <Chunk r={r} id={id} x={170} y={180} s={30} fill="#7b6a58" char="#3a2c1f" />
          <Chunk r={r} id={id} x={238} y={232} s={26} fill="#857260" char="#3d2f22" />
        </Plate>
      );
    case "liboke":
      return (
        <g>
          <Leaf r={r} id={id} cx={200} cy={205} w={190} h={150} rot={-18} color="#3d6a27" vein="#9fbd6e" />
          <Leaf r={r} id={id} cx={208} cy={200} w={150} h={112} rot={12} color="#4f7f30" vein="#b5cf86" />
          <Fish id={id} cx={204} cy={200} len={210} rot={-8} />
          <Greens r={r} n={30} cx={200} cy={200} rad={80} colors={["#c8402a", "#e0b04a", "#f0e2c8", "#2f5a1f"]} />
        </g>
      );
    case "poisson":
      return (
        <Plate id={id}>
          <Fish id={id} cx={205} cy={196} len={250} rot={-12} />
          <Greens r={r} n={36} cx={205} cy={205} rad={110} colors={["#c8402a", "#f0e2c8", "#2f5a1f", "#e0b04a"]} />
          {[0, 1, 2, 3].map((i) => <Plantain key={i} r={r} id={id} x={120 + i * 46} y={300 - i * 6} s={22} rot={i * 25} />)}
        </Plate>
      );
    case "makemba":
      return (
        <Plate id={id}>
          <Sauce r={r} id={id} cx={250} cy={228} rx={82} ry={78} base="#7a3a1e" dark="#4c200e" oil="#a8562a" />
          {scatter(r, 46, 250, 228, 66).map(([x, y], i) => (
            <ellipse key={i} cx={f(x)} cy={f(y)} rx="8" ry="5.5" fill={i % 3 ? "#5a2a14" : "#7d3c1d"} transform={`rotate(${Math.round(r() * 180)} ${f(x)} ${f(y)})`} />
          ))}
          {[[140, 140, 0], [182, 120, 30], [128, 190, 60], [170, 170, 15], [112, 240, 80], [160, 222, 40], [212, 140, 70]].map(([x, y, a], i) => (
            <Plantain key={i} r={r} id={id} x={x!} y={y!} s={30} rot={a!} />
          ))}
        </Plate>
      );
    case "brochettes":
      return (
        <Plate id={id} rad={175}>
          <Skewer r={r} id={id} x1={70} y1={150} x2={330} y2={110} />
          <Skewer r={r} id={id} x1={66} y1={205} x2={334} y2={175} />
          <Skewer r={r} id={id} x1={70} y1={262} x2={330} y2={240} />
          <g filter={`url(#${id}-soft)`}>
            <circle cx={300} cy={302} r={34} fill="#fbf6ee" />
            <Sauce r={r} id={id} cx={300} cy={302} rx={26} ry={26} base="#c3261a" dark="#7e140b" oil="#f0612a" />
          </g>
        </Plate>
      );
    case "mbika":
      return (
        <Plate id={id}>
          <Leaf r={r} id={id} cx={200} cy={200} w={140} h={110} rot={30} color="#45722a" vein="#a9c579" />
          {[[170, 175], [235, 210], [190, 245]].map(([x, y], i) => (
            <g key={i}>
              <path d={blob(r, x!, y!, 46, 34, 0.12, 9)} fill="#9c8a52" filter={`url(#${id}-soft)`} />
              <path d={blob(r, x! - 3, y! - 3, 40, 28, 0.14, 9)} fill="#b9a76a" filter={`url(#${id}-tex)`} />
              <Greens r={r} n={18} cx={x!} cy={y!} rad={26} colors={["#6b7a3a", "#d8c991"]} />
            </g>
          ))}
        </Plate>
      );
    case "jus":
      return (
        <g>
          <Glass r={r} id={id} cx={190} cy={200} rad={120} juice="#e9a823" light="#ffd85e" />
          <g filter={`url(#${id}-soft)`}>
            <path d="M300,300 l70,-30 l-12,56 z" fill="#f2c94c" />
            <path d="M300,300 l70,-30 l-12,56 z" fill={`url(#${id}-sheen)`} />
            <ellipse cx="96" cy="318" rx="24" ry="17" fill="#d9b97a" />
            <ellipse cx="96" cy="318" rx="16" ry="11" fill="#f1dca8" />
          </g>
        </g>
      );
    case "beignets":
      return (
        <Plate id={id} bowl="#b98d55">
          {scatter(r, 9, 200, 200, 95).map(([x, y], i) => (
            <g key={i} filter={`url(#${id}-soft)`}>
              <path d={blob(r, x, y, 34, 31, 0.14, 9)} fill="#b8691f" filter={`url(#${id}-tex)`} />
              <path d={blob(r, x - 5, y - 6, 22, 18, 0.2, 8)} fill="#d98f37" opacity="0.8" />
              <Greens r={r} n={10} cx={x} cy={y} rad={22} colors={["#f7efe2"]} />
            </g>
          ))}
        </Plate>
      );
    case "pain":
      return (
        <g>
          {[[200, 160, -20], [210, 250, -8]].map(([x, y, a], i) => (
            <g key={i} transform={`rotate(${a} ${x} ${y})`} filter={`url(#${id}-shadow)`}>
              <ellipse cx={x} cy={y} rx="170" ry="46" fill="#a8621f" />
              <ellipse cx={x! - 6} cy={y! - 6} rx="160" ry="38" fill="#cf8a3c" filter={`url(#${id}-tex)`} />
              {[-100, -50, 0, 50, 100].map((dx) => <path key={dx} d={`M${x! + dx - 22},${y! + 14} q22,-34 44,-28`} stroke="#f3d29b" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.85" />)}
            </g>
          ))}
        </g>
      );
    case "riz":
      return (
        <Plate id={id}>
          <Rice r={r} id={id} cx={200} cy={200} rad={118} />
          <Greens r={r} n={50} cx={200} cy={200} rad={100} colors={["#d9a03a", "#c8402a", "#3f6b2a"]} />
        </Plate>
      );
    case "saka":
      return (
        <Plate id={id} bowl="#3d2a20">
          <Sauce r={r} id={id} cx={200} cy={200} rx={124} ry={122} base="#2d4c1e" dark="#1a2c11" oil="#58772a" />
          <Greens r={r} n={170} cx={200} cy={200} rad={112} colors={["#1f3514", "#33521f", "#476b26", "#5e8432"]} />
        </Plate>
      );
    case "chikwangue":
      return (
        <g>
          {[[150, 180, -30], [250, 220, -18]].map(([x, y, a], i) => (
            <g key={i} transform={`rotate(${a} ${x} ${y})`} filter={`url(#${id}-shadow)`}>
              <ellipse cx={x} cy={y} rx="120" ry="40" fill="#5e8a35" />
              <ellipse cx={x} cy={y} rx="112" ry="33" fill="#7aa54a" filter={`url(#${id}-tex)`} />
              <ellipse cx={x! + 70} cy={y} rx="40" ry="29" fill="#efe6d2" />
              <ellipse cx={x! + 70} cy={y} rx="40" ry="29" fill={`url(#${id}-shade)`} />
              {[-60, -20, 20].map((dx) => <line key={dx} x1={x! + dx} y1={y! - 33} x2={x! + dx + 8} y2={y! + 33} stroke="#3e6324" strokeWidth="3" />)}
            </g>
          ))}
        </g>
      );
    case "fruits":
      return (
        <g>
          {[[130, 140, "#e8b62a", 56], [250, 130, "#f07f1f", 50], [190, 240, "#c92f2a", 52], [300, 250, "#86b23a", 46], [110, 280, "#f2c84c", 40]].map(([x, y, c, s], i) => (
            <g key={i} filter={`url(#${id}-shadow)`}>
              <circle cx={x as number} cy={y as number} r={s as number} fill={c as string} filter={`url(#${id}-tex)`} />
              <circle cx={x as number} cy={y as number} r={s as number} fill={`url(#${id}-shade)`} />
              <ellipse cx={(x as number) - (s as number) * 0.35} cy={(y as number) - (s as number) * 0.35} rx={(s as number) * 0.3} ry={(s as number) * 0.18} fill="#fff" opacity="0.4" transform={`rotate(-35 ${x} ${y})`} />
            </g>
          ))}
        </g>
      );
    case "grocery":
      return (
        <g>
          <g filter={`url(#${id}-shadow)`}>
            <rect x="70" y="120" width="150" height="190" rx="10" fill="#c9a874" />
            <rect x="82" y="132" width="126" height="40" rx="4" fill="#efe3c8" />
            <rect x="230" y="160" width="110" height="150" rx="10" fill="#2f6f62" />
            <rect x="244" y="190" width="82" height="50" rx="4" fill="#f4efe4" />
          </g>
          {[[150, 90, "#d93d2a", 30], [195, 80, "#f2a12a", 26], [265, 120, "#86b23a", 28]].map(([x, y, c, s], i) => (
            <g key={i} filter={`url(#${id}-soft)`}>
              <circle cx={x as number} cy={y as number} r={s as number} fill={c as string} filter={`url(#${id}-tex)`} />
              <ellipse cx={(x as number) - 8} cy={(y as number) - 9} rx="8" ry="5" fill="#fff" opacity="0.4" />
            </g>
          ))}
        </g>
      );
  }
}

/** One illustrated dish, square, transparent background. */
export function PlateArt({ recipe, seed, className, title }: { recipe: Recipe; seed?: string; className?: string; title?: string }) {
  const id = `p${hash(`${recipe}:${seed ?? ""}`).toString(36)}`;
  const r = rng(hash(`${recipe}:${seed ?? ""}`));
  return (
    <svg className={className} viewBox="0 0 400 400" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <Defs id={id} />
      {draw(recipe, id, r)}
    </svg>
  );
}

/** Picks an illustration for a dish by its name (live menus have no recipe field yet). */
export function recipeFor(name: string): Recipe {
  const n = name.toLowerCase();
  const rules: [RegExp, Recipe][] = [[/moambe/, "moambe"], [/pondu|saka|feuille/, "pondu"], [/liboke|mbisi/, "liboke"], [/mbika/, "mbika"], [/makemba|plantain|banane/, "makemba"], [/brochette|grill|nyama|chèvre|chevre/, "brochettes"], [/fumbwa/, "fumbwa"], [/jus|juice|gingembre|ginger|bissap/, "jus"], [/mikate|beignet/, "beignets"], [/pain|baguette|bread/, "pain"], [/riz|rice/, "riz"], [/poisson|fish|tilapia|thomson|makayabu/, "poisson"], [/kwanga|chikwangue/, "chikwangue"], [/fruit|tomate|légume|legume|vegetable/, "fruits"]];
  return rules.find(([re]) => re.test(n))?.[1] ?? "grocery";
}
