/**
 * A small, dependency-free QR Code generator (ISO/IEC 18004), just enough for a payment payload: byte mode, error
 * correction level M, a single data block, versions 1–3 (up to ~42 bytes). It returns a module matrix and an SVG
 * string. Kept minimal on purpose — a short BitriPay QR payload fits in version 2–3 — and returns null when the
 * text is too long rather than producing something a scanner can't read.
 *
 * One fixed mask (pattern 0) is applied and recorded in the format bits; any of the eight masks yields a valid,
 * scannable symbol, so a fixed one keeps this compact without affecting correctness.
 */

// ── GF(256) with primitive polynomial 0x11d ──
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j]!, EXP[i]);
      next[j + 1] ^= poly[j]!;
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const b of data) {
    const factor = b ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i]!, factor);
  }
  return res;
}

// version → [size, data codewords (ECC M), EC codewords (ECC M), alignment centre (0 = none)]
const VERSIONS: Record<number, { size: number; data: number; ec: number; align: number }> = {
  1: { size: 21, data: 16, ec: 10, align: 0 },
  2: { size: 25, data: 28, ec: 16, align: 18 },
  3: { size: 29, data: 44, ec: 26, align: 22 },
};

export type Matrix = boolean[][];

/** Build the QR module matrix for a UTF-8 string, or null if it does not fit in versions 1–3. */
export function qrMatrix(text: string): Matrix | null {
  const bytes = [...new TextEncoder().encode(text)];
  const version = [1, 2, 3].find((v) => bytes.length <= VERSIONS[v]!.data - 2);
  if (!version) return null;
  const spec = VERSIONS[version]!;

  // ── Bitstream: mode (0100) + 8-bit length + data + terminator + pad to capacity ──
  const bits: number[] = [];
  const push = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  const capacityBits = spec.data * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0); // terminator
  while (bits.length % 8 !== 0) bits.push(0);
  const dataCodewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) dataCodewords.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  const PADS = [0xec, 0x11];
  for (let i = 0; dataCodewords.length < spec.data; i++) dataCodewords.push(PADS[i % 2]!);

  const ecCodewords = rsEncode(dataCodewords, spec.ec);
  const all = [...dataCodewords, ...ecCodewords];

  // ── Lay out function patterns ──
  const n = spec.size;
  const m: (boolean | null)[][] = Array.from({ length: n }, () => new Array(n).fill(null));
  const reserved: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (r: number, c: number, v: boolean, fn = true) => { m[r]![c] = v; if (fn) reserved[r]![c] = true; };

  const finder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const r1 = r0 + r, c1 = c0 + c;
      if (r1 < 0 || r1 >= n || c1 < 0 || c1 >= n) continue;
      const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark = inRing && ((r === 0 || r === 6 || c === 0 || c === 6) || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      set(r1, c1, dark);
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  // Timing patterns
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // Dark module
  set(n - 8, 8, true);
  // Alignment pattern (single, versions 2–3)
  if (spec.align) {
    const a = spec.align;
    for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
      set(a + r, a + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
    }
  }
  // Reserve format-info areas
  for (let i = 0; i < 9; i++) { reserved[8]![i] = true; reserved[i]![8] = true; }
  for (let i = 0; i < 8; i++) { reserved[8]![n - 1 - i] = true; reserved[n - 1 - i]![8] = true; }

  // ── Place data+EC bitstream (zigzag, upward/downward columns) with mask 0 applied ──
  const dataBits: number[] = [];
  for (const cw of all) for (let i = 7; i >= 0; i--) dataBits.push((cw >> i) & 1);
  let bi = 0;
  let upward = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip the vertical timing column
    for (let i = 0; i < n; i++) {
      const row = upward ? n - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (reserved[row]![c]) continue;
        let bit = bi < dataBits.length ? dataBits[bi]! : 0;
        bi++;
        if ((row + c) % 2 === 0) bit ^= 1; // mask pattern 0
        m[row]![c] = bit === 1;
      }
    }
    upward = !upward;
  }

  // ── Format information (ECC M = 00, mask 0) with BCH(15,5) and the spec XOR mask ──
  const formatBits = bchFormat(0b00, 0);
  const fm = (r: number, c: number, bit: number) => { m[r]![c] = bit === 1; };
  for (let i = 0; i <= 5; i++) fm(8, i, formatBits[i]!);
  fm(8, 7, formatBits[6]!); fm(8, 8, formatBits[7]!); fm(7, 8, formatBits[8]!);
  for (let i = 9; i < 15; i++) fm(14 - i, 8, formatBits[i]!);
  for (let i = 0; i < 8; i++) fm(8, n - 1 - i, formatBits[i]!);
  for (let i = 8; i < 15; i++) fm(n - 15 + i, 8, formatBits[i]!);

  return m.map((row) => row.map((v) => v === true));
}

function bchFormat(ecLevel: number, mask: number): number[] {
  const data = (ecLevel << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10);
  const bits15 = ((data << 10) | rem) ^ 0b101010000010010;
  const out: number[] = [];
  for (let i = 14; i >= 0; i--) out.push((bits15 >> i) & 1);
  return out;
}

/** Render a QR matrix as a crisp, theme-aware SVG string (dark modules on a light quiet zone). */
export function qrSvg(text: string, opts: { size?: number; dark?: string; light?: string } = {}): string | null {
  const m = qrMatrix(text);
  if (!m) return null;
  const n = m.length;
  const quiet = 4;
  const dim = n + quiet * 2;
  const px = opts.size ?? 240;
  const dark = opts.dark ?? "#141b33";
  const light = opts.light ?? "#ffffff";
  let rects = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r]![c]) rects += `<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="Payment QR code"><rect width="${dim}" height="${dim}" fill="${light}"/><g fill="${dark}">${rects}</g></svg>`;
}
