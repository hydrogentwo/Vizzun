import type { Geometry, Settings } from './geometry';
import { project4 } from './geometry';
import { hsl } from './render';

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** Vector export of the current scene – same maths as the canvas renderer. */
export function sceneToSVG(
  s: Settings,
  g: Geometry,
  size = 1600,
  background = true,
  time = 0,
): string {
  const w = size;
  const h = size;
  const R = size * 0.46 * s.zoom;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
  );
  parts.push(
    `<defs><radialGradient id="bg" cx="50%" cy="50%" r="70%">` +
      `<stop offset="0%" stop-color="#0d1633"/><stop offset="100%" stop-color="#05070f"/>` +
      `</radialGradient></defs>`,
  );

  if (background) parts.push(`<rect width="${w}" height="${h}" fill="url(#bg)"/>`);

  const rot = s.rotA + (s.spin ? time * s.speed : 0);
  parts.push(`<g transform="translate(${w / 2} ${h / 2})">`);

  if (g.kind === 'planar') {
    parts.push(`<g transform="rotate(${f((rot * 180) / Math.PI)})">`);
    const spiral = s.layout === 'spiral';
    for (const ring of g.rings) {
      const rr = spiral ? R : Math.pow(ring.radius, s.spread) * R;
      const c = ring.count;
      const hue = s.hue + ring.n * s.hueSpread;
      const stroke = hsl(hue, 85, 62, s.lineAlpha);

      const pt = (i: number): [number, number] => {
        const x = ring.xy[i * 2];
        const y = ring.xy[i * 2 + 1];
        if (!spiral) return [x * rr, y * rr];
        const mag = Math.hypot(x, y) || 1e-6;
        const nm = Math.pow(mag, s.spread) * R;
        return [(x / mag) * nm, (y / mag) * nm];
      };

      if (s.polygon) {
        const step = Math.max(1, Math.min(s.step, Math.max(1, c - 1)));
        const d: string[] = [];
        const last = spiral ? c - step : c;
        for (let i = 0; i < last; i++) {
          const [ax, ay] = pt(i);
          const [bx, by] = pt(spiral ? i + step : (i + step) % c);
          d.push(`M${f(ax)} ${f(ay)}L${f(bx)} ${f(by)}`);
        }
        parts.push(
          `<path d="${d.join('')}" fill="none" stroke="${stroke}" stroke-width="${f(
            s.lineWidth,
          )}" stroke-linecap="round"/>`,
        );
      }

      if (s.nodes) {
        const fill = hsl(hue, 90, 68, 0.95);
        const d: string[] = [];
        const r = s.nodeSize;
        for (let i = 0; i < c; i++) {
          const [ax, ay] = pt(i);
          d.push(`M${f(ax - r)} ${f(ay)}a${f(r)} ${f(r)} 0 1 0 ${f(r * 2)} 0a${f(r)} ${f(
            r,
          )} 0 1 0 ${f(-r * 2)} 0`);
        }
        parts.push(`<path d="${d.join('')}" fill="${fill}"/>`);
      }
    }
    parts.push(`</g>`);
  } else {
    const a = s.rotA + (s.spin ? time * s.speed : 0);
    const b = s.rotB + (s.spin ? time * s.speed * 0.618 : 0);
    const k = R / (g.scale * 1.6);
    const on = g.outer.length / 4;
    const P: number[] = [];
    const push = (arr: Int16Array) => {
      for (let i = 0; i < arr.length; i += 4) {
        const [x, y] = project4(arr[i], arr[i + 1], arr[i + 2], arr[i + 3], a, b, 0);
        P.push(x * k, y * k);
      }
    };
    push(g.outer);
    push(g.inner);

    if (s.polygon) {
      const d: string[] = [];
      for (let i = 0; i < g.edges.length; i += 2) {
        const oi = g.edges[i];
        const ii = on + g.edges[i + 1];
        d.push(`M${f(P[oi * 2])} ${f(P[oi * 2 + 1])}L${f(P[ii * 2])} ${f(P[ii * 2 + 1])}`);
      }
      parts.push(
        `<path d="${d.join('')}" fill="none" stroke="${hsl(
          s.hue + 40,
          80,
          60,
          s.lineAlpha * 0.5,
        )}" stroke-width="${f(s.lineWidth * 0.7)}"/>`,
      );
    }

    if (s.nodes) {
      const r = s.nodeSize;
      const seg = (from: number, to: number, hue: number) => {
        const d: string[] = [];
        for (let i = from; i < to; i++) {
          const x = P[i * 2];
          const y = P[i * 2 + 1];
          d.push(`M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(r * 2)} 0a${f(r)} ${f(
            r,
          )} 0 1 0 ${f(-r * 2)} 0`);
        }
        parts.push(`<path d="${d.join('')}" fill="${hsl(hue, 90, 66, 0.9)}"/>`);
      };
      seg(0, on, s.hue);
      seg(on, P.length / 2, s.hue + s.hueSpread * 12);
    }
  }

  parts.push(`</g></svg>`);
  return parts.join('');
}
