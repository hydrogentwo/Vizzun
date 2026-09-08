import type { Geometry, LatticeGeometry, PlanarGeometry, RampName, Settings } from './geometry';
import { project4 } from './geometry';
import { collectScene } from './collect';

export const BG = '#080b06';

export const RAMPS: Record<RampName, string[]> = {
  blocks: [' ', '░', '▒', '▓', '█'],
  ascii: ['.', ':', '-', '=', '+', '*', '#', '@'],
  shade: [' ', '.', '·', ':', 'o', 'O', '0', '@'],
  dots: [' ', '·', ':', '∴', '⁘'],
  binary: ['0', '1'],
};

export function hsl(h: number, s: number, l: number, a = 1) {
  return `hsla(${((h % 360) + 360) % 360}, ${s}%, ${l}%, ${a})`;
}

type Ctx = CanvasRenderingContext2D;

export type RenderOpts = {
  /** seconds, drives auto-rotation */
  time: number;
  /** skip the trail fade and always paint an opaque background */
  opaque?: boolean;
  /** true -> paint the background, false -> transparent (png with alpha) */
  background?: boolean;
  /** scratch buffer reused between frames */
  proj?: { buf: Float32Array };
};

function drawPlanar(ctx: Ctx, g: PlanarGeometry, s: Settings, R: number) {
  const spiral = s.layout === 'spiral';
  let prevPts: Float32Array | null = null;
  let prevR = 0;

  for (const ring of g.rings) {
    const rr = spiral ? R : Math.pow(ring.radius, s.spread) * R;
    const c = ring.count;
    const hue = s.hue + ring.n * s.hueSpread;
    const stroke = hsl(hue, 85, 62, s.lineAlpha);

    const px = (i: number): [number, number] => {
      const x = ring.xy[i * 2];
      const y = ring.xy[i * 2 + 1];
      if (!spiral) return [x * rr, y * rr];
      const mag = Math.hypot(x, y) || 1e-6;
      const nm = Math.pow(mag, s.spread) * R;
      return [(x / mag) * nm, (y / mag) * nm];
    };

    if (s.polygon) {
      ctx.beginPath();
      const step = Math.max(1, Math.min(s.step, Math.max(1, c - 1)));
      if (spiral) {
        for (let i = 0; i + step < c; i++) {
          const [ax, ay] = px(i);
          const [bx, by] = px(i + step);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
      } else {
        for (let i = 0; i < c; i++) {
          const [ax, ay] = px(i);
          const [bx, by] = px((i + step) % c);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = s.lineWidth;
      if (s.glow > 0) {
        ctx.shadowBlur = s.glow;
        ctx.shadowColor = hsl(hue, 90, 60, 0.9);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (s.fill && !spiral) {
        ctx.beginPath();
        for (let i = 0; i < c; i++) {
          const [ax, ay] = px(i);
          if (i === 0) ctx.moveTo(ax, ay);
          else ctx.lineTo(ax, ay);
        }
        ctx.closePath();
        ctx.fillStyle = hsl(hue, 80, 55, 0.05);
        ctx.fill();
      }
    }

    if (s.spokes && prevPts && !spiral) {
      ctx.beginPath();
      const pc = prevPts.length / 2;
      const limit = Math.min(c, 360);
      for (let i = 0; i < limit; i++) {
        const idx = Math.floor((i * c) / limit);
        const [ax, ay] = px(idx);
        const j = Math.floor((idx / c) * pc) % pc;
        ctx.moveTo(ax, ay);
        ctx.lineTo(prevPts[j * 2] * prevR, prevPts[j * 2 + 1] * prevR);
      }
      ctx.strokeStyle = hsl(hue, 60, 60, s.lineAlpha * 0.35);
      ctx.lineWidth = Math.max(0.4, s.lineWidth * 0.5);
      ctx.stroke();
    }

    if (s.nodes) {
      const size = s.nodeSize;
      ctx.fillStyle = hsl(hue, 90, 68, 0.95);
      if (s.glow > 0 && g.nodeCount < 4000) {
        ctx.shadowBlur = s.glow;
        ctx.shadowColor = hsl(hue, 95, 62, 0.9);
      }
      if (size <= 1.1) {
        for (let i = 0; i < c; i++) {
          const [ax, ay] = px(i);
          ctx.fillRect(ax - size, ay - size, size * 2, size * 2);
        }
      } else {
        ctx.beginPath();
        for (let i = 0; i < c; i++) {
          const [ax, ay] = px(i);
          ctx.moveTo(ax + size, ay);
          ctx.arc(ax, ay, size, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    if (!spiral) {
      prevPts = ring.xy;
      prevR = rr;
    }
  }
}

function drawLattice(
  ctx: Ctx,
  g: LatticeGeometry,
  s: Settings,
  R: number,
  t: number,
  scratch?: { buf: Float32Array },
) {
  const total = (g.outer.length + g.inner.length) / 2;
  let proj: Float32Array;
  if (scratch) {
    if (scratch.buf.length !== total) scratch.buf = new Float32Array(total);
    proj = scratch.buf;
  } else {
    proj = new Float32Array(total);
  }

  const a = s.rotA + (s.spin ? t * s.speed : 0);
  const b = s.rotB + (s.spin ? t * s.speed * 0.618 : 0);
  const k = R / (g.scale * 1.6);

  const on = g.outer.length / 4;
  for (let i = 0; i < on; i++) {
    const [x, y] = project4(
      g.outer[i * 4],
      g.outer[i * 4 + 1],
      g.outer[i * 4 + 2],
      g.outer[i * 4 + 3],
      a,
      b,
      0,
    );
    proj[i * 2] = x * k;
    proj[i * 2 + 1] = y * k;
  }

  const inN = g.inner.length / 4;
  for (let i = 0; i < inN; i++) {
    const [x, y] = project4(
      g.inner[i * 4],
      g.inner[i * 4 + 1],
      g.inner[i * 4 + 2],
      g.inner[i * 4 + 3],
      a,
      b,
      0,
    );
    proj[(on + i) * 2] = x * k;
    proj[(on + i) * 2 + 1] = y * k;
  }

  if (s.polygon) {
    ctx.beginPath();
    const e = g.edges;
    const stride = e.length / 2 > 30000 ? 2 : 1;
    for (let i = 0; i < e.length; i += 2 * stride) {
      const oi = e[i];
      const ii = on + e[i + 1];
      ctx.moveTo(proj[oi * 2], proj[oi * 2 + 1]);
      ctx.lineTo(proj[ii * 2], proj[ii * 2 + 1]);
    }
    ctx.strokeStyle = hsl(s.hue + 40, 80, 60, s.lineAlpha * 0.5);
    ctx.lineWidth = s.lineWidth * 0.7;
    ctx.stroke();
  }

  if (s.nodes) {
    const size = s.nodeSize;
    const paint = (from: number, to: number, hue: number) => {
      ctx.fillStyle = hsl(hue, 90, 66, 0.9);
      if (s.glow > 0 && total < 8000) {
        ctx.shadowBlur = s.glow * 0.7;
        ctx.shadowColor = hsl(hue, 95, 62, 0.8);
      }
      if (size <= 1.1) {
        for (let i = from; i < to; i++)
          ctx.fillRect(proj[i * 2] - size, proj[i * 2 + 1] - size, size * 2, size * 2);
      } else {
        ctx.beginPath();
        for (let i = from; i < to; i++) {
          ctx.moveTo(proj[i * 2] + size, proj[i * 2 + 1]);
          ctx.arc(proj[i * 2], proj[i * 2 + 1], size, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    };
    paint(0, on, s.hue);
    paint(on, on + inN, s.hue + s.hueSpread * 12);
  }
}

/** Rasterise the scene into a monospace character grid – the "TUI" renderer. */
function drawGlyphs(ctx: Ctx, w: number, h: number, s: Settings, g: Geometry, t: number) {
  const cw = Math.max(4, s.cell);
  const ch = Math.round(cw * 1.9);
  const cols = Math.max(1, Math.floor(w / cw));
  const rows = Math.max(1, Math.floor(h / ch));
  const ox = (w - cols * cw) / 2;
  const oy = (h - rows * ch) / 2;

  const dens = new Float32Array(cols * rows);
  const hueAcc = new Float32Array(cols * rows);
  const R = Math.min(w, h) * 0.46 * s.zoom;
  const scene = collectScene(s, g, R, t);

  const splat = (x: number, y: number, hue: number, amt: number) => {
    const c = Math.floor((x + w / 2 - ox) / cw);
    const r = Math.floor((y + h / 2 - oy) / ch);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    const i = r * cols + c;
    dens[i] += amt;
    hueAcc[i] += hue * amt;
  };

  for (let i = 0; i < scene.nPts; i++)
    splat(scene.pts[i * 3], scene.pts[i * 3 + 1], scene.pts[i * 3 + 2], 1);

  const segBudget = 250000;
  const perSeg = Math.max(2, Math.min(24, Math.floor(segBudget / Math.max(1, scene.nSegs))));
  for (let i = 0; i < scene.nSegs; i++) {
    const x1 = scene.segs[i * 5];
    const y1 = scene.segs[i * 5 + 1];
    const x2 = scene.segs[i * 5 + 2];
    const y2 = scene.segs[i * 5 + 3];
    const hue = scene.segs[i * 5 + 4];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(2, Math.min(perSeg, Math.ceil(len / (cw * 0.6))));
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      splat(x1 + (x2 - x1) * u, y1 + (y2 - y1) * u, hue, 0.34 * s.lineAlpha);
    }
  }

  // normalise
  let max = 0;
  for (let i = 0; i < dens.length; i++) if (dens[i] > max) max = dens[i];
  if (max <= 0) return;

  const ramp = RAMPS[s.ramp] ?? RAMPS.blocks;
  const last = ramp.length - 1;
  const gamma = 0.45;
  const norm = 1 / Math.pow(max, gamma);

  ctx.font = `${ch * 0.86}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const d = dens[i];
      if (d <= 0.02) continue;
      const v = Math.min(1, Math.pow(d, gamma) * norm);
      const gi = Math.min(last, Math.max(0, Math.round(v * last)));
      const hue = s.mono ? 96 : hueAcc[i] / d;
      const light = s.mono ? 40 + v * 45 : 45 + v * 30;
      const sat = s.mono ? 70 : 88;
      ctx.fillStyle = hsl(hue, sat, light, 0.35 + v * 0.65);
      if (s.glow > 0 && v > 0.55) {
        ctx.shadowBlur = Math.min(18, s.glow);
        ctx.shadowColor = hsl(hue, sat, light + 10, 0.8);
      }
      ctx.fillText(ramp[gi], ox + c * cw + cw / 2, oy + r * ch + ch / 2);
      ctx.shadowBlur = 0;
    }
  }
}

/** CRT scanline + vignette overlay */
function crtOverlay(ctx: Ctx, w: number, h: number) {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#000';
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  ctx.restore();
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

/** Paint one complete frame into a 2D context of logical size w x h. */
export function renderScene(
  ctx: Ctx,
  w: number,
  h: number,
  s: Settings,
  g: Geometry,
  opts: RenderOpts,
) {
  const { time, opaque = false, background = true } = opts;
  if (background) {
    if (s.trail > 0 && !opaque) {
      ctx.fillStyle = `rgba(8,11,6,${Math.max(0.02, 1 - s.trail)})`;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);
      const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      grd.addColorStop(0, 'rgba(52,211,153,0.07)');
      grd.addColorStop(1, 'rgba(8,11,6,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
    }
  } else {
    ctx.clearRect(0, 0, w, h);
  }

  if (s.glyphMode) {
    drawGlyphs(ctx, w, h, s, g, time);
    if (s.scanlines && background) crtOverlay(ctx, w, h);
    return;
  }

  ctx.save();
  ctx.translate(w / 2, h / 2);
  const R = Math.min(w, h) * 0.46 * s.zoom;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (g.kind === 'lattice') {
    drawLattice(ctx, g, s, R, time, opts.proj);
  } else {
    ctx.rotate(s.rotA + (s.spin ? time * s.speed : 0));
    drawPlanar(ctx, g, s, R);
  }
  ctx.restore();
}
