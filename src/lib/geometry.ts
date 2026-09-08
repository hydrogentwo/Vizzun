import { A287324, A008412, latticeShell, shellBridge } from './seq';

export type Layout = 'rings' | 'spiral' | 'lattice';
export type RadiusLaw = 'index' | 'cbrt' | 'sqrt' | 'value';

export type Settings = {
  layout: Layout;
  nodes: boolean;
  polygon: boolean;
  terms: number;
  shell: number;
  density: number;
  radiusLaw: RadiusLaw;
  spread: number;
  twist: number;
  step: number;
  nodeSize: number;
  lineWidth: number;
  lineAlpha: number;
  hue: number;
  hueSpread: number;
  spokes: boolean;
  fill: boolean;
  glow: number;
  spin: boolean;
  speed: number;
  zoom: number;
  rotA: number;
  rotB: number;
  trail: number;
  // --- terminal / glyph rendering ---
  glyphMode: boolean;
  cell: number;
  ramp: RampName;
  scanlines: boolean;
  mono: boolean;
  /** GPU backend for the generated Rust project */
  backend: Backend;
};

export type RampName = 'blocks' | 'ascii' | 'shade' | 'dots' | 'binary';
export type Backend = 'wgpu' | 'ash';

export const DEFAULTS: Settings = {
  layout: 'rings',
  nodes: true,
  polygon: true,
  terms: 14,
  shell: 8,
  density: 12,
  radiusLaw: 'cbrt',
  spread: 1,
  twist: 9,
  step: 5,
  nodeSize: 1.8,
  lineWidth: 1,
  lineAlpha: 0.55,
  hue: 190,
  hueSpread: 11,
  spokes: false,
  fill: false,
  glow: 8,
  spin: true,
  speed: 0.18,
  zoom: 1,
  rotA: 0.62,
  rotB: 0.35,
  trail: 0,
  glyphMode: false,
  cell: 9,
  ramp: 'blocks',
  scanlines: true,
  mono: false,
  backend: 'wgpu',
};

export type Ring = {
  n: number;
  value: number;
  count: number;
  radius: number; // normalised 0..1
  phase: number; // radians
  xy: Float32Array; // unit-circle positions, already phase rotated
};

export type PlanarGeometry = {
  kind: 'planar';
  rings: Ring[];
  nodeCount: number;
  edgeCount: number;
  total: number;
};

export type LatticeGeometry = {
  kind: 'lattice';
  outer: Int16Array;
  inner: Int16Array;
  edges: Int32Array;
  scale: number;
  nodeCount: number;
  edgeCount: number;
  total: number;
  labels: [number, number];
};

export type Geometry = PlanarGeometry | LatticeGeometry;

const MAX_PER_RING = 900;

function ringCount(value: number, density: number): number {
  return Math.max(3, Math.min(MAX_PER_RING, Math.round(value / density)));
}

function rawRadius(law: RadiusLaw, n: number, value: number): number {
  switch (law) {
    case 'index':
      return n;
    case 'sqrt':
      return Math.sqrt(value);
    case 'value':
      return value;
    default:
      return Math.cbrt(value);
  }
}

export function buildPlanar(s: Settings): PlanarGeometry {
  const rings: Ring[] = [];
  const N = s.terms;
  const raws: number[] = [];
  let total = 0;
  for (let n = 1; n <= N; n++) {
    const value = A287324(n);
    total += value;
    raws.push(rawRadius(s.radiusLaw, n, value));
  }
  const maxRaw = Math.max(...raws, 1e-9);

  let nodeCount = 0;
  let edgeCount = 0;
  let spiralIndex = 0;

  for (let n = 1; n <= N; n++) {
    const value = A287324(n);
    const count = ringCount(value, s.density);
    const phase = (s.twist * Math.PI) / 180 * n;
    const xy = new Float32Array(count * 2);

    if (s.layout === 'spiral') {
      // one continuous curve: every unit is placed sequentially
      for (let i = 0; i < count; i++) {
        const k = spiralIndex + i;
        const ang = k * ((s.twist * Math.PI) / 180 + 2.399963229728653 / 8);
        const r = Math.sqrt(k + 1);
        xy[i * 2] = Math.cos(ang) * r;
        xy[i * 2 + 1] = Math.sin(ang) * r;
      }
      spiralIndex += count;
    } else {
      // unit directions – the radius is applied at draw time
      for (let i = 0; i < count; i++) {
        const ang = phase + (2 * Math.PI * i) / count;
        xy[i * 2] = Math.cos(ang);
        xy[i * 2 + 1] = Math.sin(ang);
      }
    }

    nodeCount += count;
    edgeCount += count;
    rings.push({ n, value, count, radius: raws[n - 1] / maxRaw, phase, xy });
  }

  if (s.layout === 'spiral') {
    // normalise the spiral into the unit disc
    let max = 1e-9;
    for (const ring of rings) {
      for (let i = 0; i < ring.xy.length; i += 2) {
        const d = Math.hypot(ring.xy[i], ring.xy[i + 1]);
        if (d > max) max = d;
      }
    }
    for (const ring of rings) {
      for (let i = 0; i < ring.xy.length; i++) ring.xy[i] /= max;
    }
  }

  return { kind: 'planar', rings, nodeCount, edgeCount, total };
}

export function buildLattice(s: Settings): LatticeGeometry {
  const n = s.shell;
  const m1 = Math.max(0, n - 1);
  const m2 = Math.max(0, n - 2);
  const outer = latticeShell(m1);
  const inner = latticeShell(m2);
  const edges = shellBridge(outer, inner);
  const nodeCount = (outer.length + inner.length) / 4;
  return {
    kind: 'lattice',
    outer,
    inner,
    edges,
    scale: Math.max(1, m1),
    nodeCount,
    edgeCount: edges.length / 2,
    total: A008412(m1) + A008412(m2),
    labels: [m1, m2],
  };
}

export function buildGeometry(s: Settings): Geometry {
  return s.layout === 'lattice' ? buildLattice(s) : buildPlanar(s);
}

/** 4D -> 2D : rotate in the (x,z) and (y,w) planes, then drop z and w */
export function project4(
  x: number,
  y: number,
  z: number,
  w: number,
  a: number,
  b: number,
  spin: number,
): [number, number] {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const x1 = x * ca - z * sa;
  const z1 = x * sa + z * ca;
  const y1 = y * cb - w * sb;
  const w1 = y * sb + w * cb;
  // second, gentler mix so all four axes stay visible
  const x2 = x1 + z1 * 0.5;
  const y2 = y1 + w1 * 0.5;
  const cs = Math.cos(spin);
  const ss = Math.sin(spin);
  return [x2 * cs - y2 * ss, x2 * ss + y2 * cs];
}
