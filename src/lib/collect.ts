import type { Geometry, Settings } from './geometry';
import { project4 } from './geometry';

export type Scene = {
  /** x, y, hue triples in scene space (origin = centre) */
  pts: Float32Array;
  nPts: number;
  /** x1, y1, x2, y2, hue quintuples */
  segs: Float32Array;
  nSegs: number;
};

const MAX_PTS = 60000;
const MAX_SEGS = 40000;

/** Flatten whatever is on screen into raw points + segments (scene space). */
export function collectScene(s: Settings, g: Geometry, R: number, time: number): Scene {
  const pts = new Float32Array(MAX_PTS * 3);
  const segs = new Float32Array(MAX_SEGS * 5);
  let np = 0;
  let ns = 0;

  const addPt = (x: number, y: number, hue: number) => {
    if (np >= MAX_PTS) return;
    pts[np * 3] = x;
    pts[np * 3 + 1] = y;
    pts[np * 3 + 2] = hue;
    np++;
  };

  const addSeg = (x1: number, y1: number, x2: number, y2: number, hue: number) => {
    if (ns >= MAX_SEGS) return;
    segs[ns * 5] = x1;
    segs[ns * 5 + 1] = y1;
    segs[ns * 5 + 2] = x2;
    segs[ns * 5 + 3] = y2;
    segs[ns * 5 + 4] = hue;
    ns++;
  };

  if (g.kind === 'planar') {
    const rot = s.rotA + (s.spin ? time * s.speed : 0);
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const spiral = s.layout === 'spiral';

    for (const ring of g.rings) {
      const rr = spiral ? R : Math.pow(ring.radius, s.spread) * R;
      const c = ring.count;
      const hue = s.hue + ring.n * s.hueSpread;

      const pos = (i: number): [number, number] => {
        let x = ring.xy[i * 2];
        let y = ring.xy[i * 2 + 1];
        if (spiral) {
          const mag = Math.hypot(x, y) || 1e-6;
          const nm = Math.pow(mag, s.spread) * R;
          x = (x / mag) * nm;
          y = (y / mag) * nm;
        } else {
          x *= rr;
          y *= rr;
        }
        return [x * cr - y * sr, x * sr + y * cr];
      };

      if (s.polygon) {
        const step = Math.max(1, Math.min(s.step, Math.max(1, c - 1)));
        const last = spiral ? Math.max(0, c - step) : c;
        for (let i = 0; i < last; i++) {
          const [ax, ay] = pos(i);
          const [bx, by] = pos(spiral ? i + step : (i + step) % c);
          addSeg(ax, ay, bx, by, hue);
        }
      }

      if (s.nodes) {
        for (let i = 0; i < c; i++) {
          const [ax, ay] = pos(i);
          addPt(ax, ay, hue);
        }
      }
    }
  } else {
    const a = s.rotA + (s.spin ? time * s.speed : 0);
    const b = s.rotB + (s.spin ? time * s.speed * 0.618 : 0);
    const k = R / (g.scale * 1.6);
    const on = g.outer.length / 4;
    const P = new Float32Array(((g.outer.length + g.inner.length) / 4) * 2);
    let w = 0;
    const push = (arr: Int16Array) => {
      for (let i = 0; i < arr.length; i += 4) {
        const [x, y] = project4(arr[i], arr[i + 1], arr[i + 2], arr[i + 3], a, b, 0);
        P[w++] = x * k;
        P[w++] = y * k;
      }
    };
    push(g.outer);
    push(g.inner);

    if (s.polygon) {
      const e = g.edges;
      const stride = e.length / 2 > MAX_SEGS ? Math.ceil(e.length / 2 / MAX_SEGS) : 1;
      for (let i = 0; i < e.length; i += 2 * stride) {
        const oi = e[i];
        const ii = on + e[i + 1];
        addSeg(P[oi * 2], P[oi * 2 + 1], P[ii * 2], P[ii * 2 + 1], s.hue + 40);
      }
    }

    if (s.nodes) {
      for (let i = 0; i < on; i++) addPt(P[i * 2], P[i * 2 + 1], s.hue);
      for (let i = on; i < P.length / 2; i++)
        addPt(P[i * 2], P[i * 2 + 1], s.hue + s.hueSpread * 12);
    }
  }

  return { pts, nPts: np, segs, nSegs: ns };
}
