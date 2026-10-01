// PARSEC Wallet — QR codes, without a dependency.
//
// Enough of ISO/IEC 18004 for what a wallet shows: byte mode, error correction
// level M (~15% damage tolerance), versions 1–10 (up to 213 bytes — an address,
// or an ARC-26 / EIP-681 / Solana Pay request with amount and asset). The
// structure follows Project Nayuki's reference encoder: build the codewords,
// interleave them with Reed–Solomon blocks, draw the function patterns, place
// the data in the zig-zag, then pick the mask with the lowest penalty.
//
// Output is a boolean module grid; `qrSvg` draws it with DOM calls (no
// innerHTML), so nothing the text contains can become markup.

/** Per version 1..10 at level M: [ec codewords per block, group 1 blocks, data per g1 block, group 2 blocks, data per g2 block]. */
const EC_M: readonly (readonly [number, number, number, number, number])[] = [
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
];
const ALIGN: readonly (readonly number[])[] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];
const MAX_VERSION = 10;
/** Level M's two format bits. */
const EC_FORMAT_BITS = 0;

export interface QrCode {
  version: number;
  size: number;
  mask: number;
  /** modules[y][x] — true is dark. */
  modules: boolean[][];
}

// ── Reed–Solomon over GF(256), primitive polynomial 0x11D ─────────────────────

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

// ── Codewords ────────────────────────────────────────────────────────────────

function dataCapacity(version: number): number {
  const [, b1, d1, b2, d2] = EC_M[version - 1];
  return b1 * d1 + b2 * d2;
}

function encodeData(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4); // byte mode
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capBits = dataCapacity(version) * 8;
  put(0, Math.min(4, capBits - bits.length)); // terminator
  put(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < dataCapacity(version); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function interleave(data: number[], version: number): number[] {
  const [ecLen, b1, d1, b2, d2] = EC_M[version - 1];
  const divisor = rsDivisor(ecLen);
  const blocks: number[][] = [];
  const ecs: number[][] = [];
  let k = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const len = i < b1 ? d1 : d2;
    const block = data.slice(k, k + len);
    k += len;
    blocks.push(block);
    ecs.push(rsRemainder(block, divisor));
  }
  const out: number[] = [];
  const maxLen = Math.max(d1, d2);
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

// ── The grid ─────────────────────────────────────────────────────────────────

class Grid {
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
  constructor(readonly version: number, readonly size = version * 4 + 17) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  setFn(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(this.size - 4, 3);
    this.finder(3, this.size - 4);
    const pos = ALIGN[this.version - 1];
    const n = pos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.alignment(pos[i], pos[j]);
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  }

  private finder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.setFn(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }

  private alignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  drawFormatBits(mask: number): void {
    const data = (EC_FORMAT_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) this.setFn(8, i, bit(i));
    this.setFn(8, 7, bit(6));
    this.setFn(8, 8, bit(7));
    this.setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.setFn(this.size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFn(8, this.size - 15 + i, bit(i));
    this.setFn(8, this.size - 8, true); // the dark module
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFn(a, b, dark);
      this.setFn(b, a, dark);
    }
  }

  drawCodewords(data: readonly number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue;
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  /** The standard's four penalty rules; lower is easier to scan. */
  penalty(): number {
    const n = this.size;
    const m = this.modules;
    let score = 0;
    const lines = (get: (a: number, b: number) => boolean) => {
      for (let a = 0; a < n; a++) {
        let run = 1;
        const seq: boolean[] = [];
        for (let b = 0; b < n; b++) {
          seq.push(get(a, b));
          if (b > 0) {
            if (get(a, b) === get(a, b - 1)) {
              run++;
              if (run === 5) score += 3; else if (run > 5) score += 1;
            } else run = 1;
          }
        }
        // Finder-like 1:1:3:1:1 with four light modules on one side.
        const s = seq.map((v) => (v ? 1 : 0)).join('');
        for (const pat of ['10111010000', '00001011101']) {
          let at = s.indexOf(pat);
          while (at !== -1) { score += 40; at = s.indexOf(pat, at + 1); }
        }
      }
    };
    lines((a, b) => m[a][b]);
    lines((a, b) => m[b][a]);
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }
    let dark = 0;
    for (const row of m) for (const v of row) if (v) dark++;
    const total = n * n;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return score;
  }
}

/** Smallest version (1..10) that holds `byteLength` bytes at level M, or null. */
export function versionFor(byteLength: number): number | null {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const header = 4 + (v <= 9 ? 8 : 16);
    if (header + byteLength * 8 <= dataCapacity(v) * 8) return v;
  }
  return null;
}

/**
 * Encode text (UTF-8) as a QR code. `forceMask` (0..7) is for tests that compare
 * against a reference; otherwise the lowest-penalty mask is chosen.
 */
export function encodeQr(text: string, opts: { forceMask?: number; minVersion?: number } = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = versionFor(bytes.length);
  if (version === null) throw new Error(`Too long for a QR code here (${bytes.length} bytes; at most 213).`);
  if (opts.minVersion && opts.minVersion > version) version = Math.min(opts.minVersion, MAX_VERSION);
  const codewords = interleave(encodeData(bytes, version), version);

  const build = (mask: number): Grid => {
    const g = new Grid(version!);
    g.drawFunctionPatterns();
    g.drawCodewords(codewords);
    g.applyMask(mask);
    g.drawFormatBits(mask);
    return g;
  };

  let best: Grid | null = null;
  let bestMask = 0;
  if (opts.forceMask !== undefined) {
    best = build(opts.forceMask);
    bestMask = opts.forceMask;
  } else {
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const g = build(mask);
      const p = g.penalty();
      if (p < bestScore) { bestScore = p; best = g; bestMask = mask; }
    }
  }
  return { version, size: best!.size, mask: bestMask, modules: best!.modules };
}

/** Draw a QR code as an SVG element (dark modules as one path), with a quiet zone. */
export function qrSvg(code: QrCode, opts: { quiet?: number; label?: string } = {}): SVGSVGElement {
  const quiet = opts.quiet ?? 4;
  const dim = code.size + quiet * 2;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${dim} ${dim}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', opts.label ?? 'QR code');
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', String(dim));
  bg.setAttribute('height', String(dim));
  bg.setAttribute('fill', '#fff');
  svg.appendChild(bg);
  let d = '';
  code.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`; }));
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000');
  svg.appendChild(path);
  return svg;
}
