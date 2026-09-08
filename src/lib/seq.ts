// ---------------------------------------------------------------------------
// A287324 : a(n) = A008412(n-1) + A008412(n-2), a(0)=0, a(1)=1
// ---------------------------------------------------------------------------

/** A008412 – coordination sequence of the 4-dimensional cubic lattice Z^4.
 *  1, 8, 32, 88, 192, 360, 608, 952, ... – a(m) = 8m(m^2+2)/3 for m >= 1 */
export function A008412(m: number): number {
  if (m < 0) return 0;
  if (m === 0) return 1;
  return (8 * m * (m * m + 2)) / 3;
}

/** A287324 */
export function A287324(n: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  return A008412(n - 1) + A008412(n - 2);
}

/** closed form valid for n >= 3 : (16n^3 - 72n^2 + 152n - 120)/3 */
export function closedForm(n: number): number {
  return (16 * n * n * n - 72 * n * n + 152 * n - 120) / 3;
}

export function firstTerms(count: number): number[] {
  return Array.from({ length: count }, (_, n) => A287324(n));
}

// --- the iterated-summation cascade ---------------------------------------
// rule:  next[0] = 1 ,  next[i] = prev[i] + prev[i-1]
export type CascadeRow = {
  k: number;
  id: string;
  name: string;
  values: number[];
};

const CASCADE_META: [string, string][] = [
  ['A000292', 'tetrahedral numbers'],
  ['A000330', 'square pyramidal'],
  ['A005900', 'octahedral numbers'],
  ['A001845', 'centred octahedral – ball'],
  ['A008412', 'Z⁴ coordination shell'],
  ['A287324', 'this sequence'],
  ['—', 'next iterate f(10,n)'],
  ['—', 'next iterate f(11,n)'],
];

export function cascade(rows = 6, cols = 9): CascadeRow[] {
  // row 0 = A000292, tetrahedral numbers 1, 4, 10, 20, 35, ...
  let cur = Array.from({ length: cols }, (_, i) => ((i + 1) * (i + 2) * (i + 3)) / 6);
  const out: CascadeRow[] = [];
  for (let r = 0; r < rows; r++) {
    const meta = CASCADE_META[Math.min(r, CASCADE_META.length - 1)];
    out.push({ k: r + 4, id: meta[0], name: meta[1], values: cur.slice() });
    const next = cur.map((v, i) => (i === 0 ? 1 : v + cur[i - 1]));
    cur = next;
  }
  return out;
}

// --- Z^4 lattice shells ----------------------------------------------------
/** every integer point of Z^4 with |x|_1 === m  (there are A008412(m) of them) */
export function latticeShell(m: number): Int16Array {
  if (m <= 0) return Int16Array.from([0, 0, 0, 0]);
  const pts: number[] = [];
  for (let x = -m; x <= m; x++) {
    const rx = m - Math.abs(x);
    for (let y = -rx; y <= rx; y++) {
      const ry = rx - Math.abs(y);
      for (let z = -ry; z <= ry; z++) {
        const w = ry - Math.abs(z);
        if (w === 0) pts.push(x, y, z, 0);
        else {
          pts.push(x, y, z, w);
          pts.push(x, y, z, -w);
        }
      }
    }
  }
  return Int16Array.from(pts);
}

/** unit-distance edges between the two shells (they are the "+" of the sum) */
export function shellBridge(outer: Int16Array, inner: Int16Array): Int32Array {
  const key = (a: number, b: number, c: number, d: number) =>
    (((a + 64) * 128 + (b + 64)) * 128 + (c + 64)) * 128 + (d + 64);
  const map = new Map<number, number>();
  for (let i = 0; i < inner.length; i += 4) {
    map.set(key(inner[i], inner[i + 1], inner[i + 2], inner[i + 3]), i >> 2);
  }
  const edges: number[] = [];
  const p = [0, 0, 0, 0];
  for (let i = 0; i < outer.length; i += 4) {
    p[0] = outer[i];
    p[1] = outer[i + 1];
    p[2] = outer[i + 2];
    p[3] = outer[i + 3];
    for (let axis = 0; axis < 4; axis++) {
      for (const d of [-1, 1]) {
        p[axis] += d;
        const j = map.get(key(p[0], p[1], p[2], p[3]));
        if (j !== undefined) edges.push(i >> 2, j);
        p[axis] -= d;
      }
    }
  }
  return Int32Array.from(edges);
}
