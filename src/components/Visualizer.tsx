import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Geometry, Settings } from '../lib/geometry';
import { renderScene } from '../lib/render';

type Props = {
  settings: Settings;
  geometry: Geometry;
  onOrbit: (dx: number, dy: number) => void;
  onZoom: (factor: number) => void;
};

export type VisualizerHandle = {
  /** render the current frame off-screen at `size` px square and return a blob */
  capture: (size: number, transparent: boolean) => Promise<Blob | null>;
  /** small data-url used as a preset thumbnail */
  thumbnail: (size?: number) => string;
  /** elapsed animation seconds, so exports match what is on screen */
  time: () => number;
};

const Visualizer = forwardRef<VisualizerHandle, Props>(function Visualizer(
  { settings, geometry, onOrbit, onZoom },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sRef = useRef(settings);
  const gRef = useRef(geometry);
  const scratch = useRef({ buf: new Float32Array(0) });
  const timeRef = useRef(0);

  sRef.current = settings;
  gRef.current = geometry;

  useImperativeHandle(
    ref,
    () => ({
      time: () => timeRef.current,
      thumbnail: (size = 128) => {
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const cx = c.getContext('2d');
        if (!cx) return '';
        renderScene(cx, size, size, sRef.current, gRef.current, {
          time: timeRef.current,
          opaque: true,
        });
        return c.toDataURL('image/jpeg', 0.55);
      },
      capture: (size, transparent) =>
        new Promise<Blob | null>((resolve) => {
          const c = document.createElement('canvas');
          c.width = size;
          c.height = size;
          const cx = c.getContext('2d');
          if (!cx) return resolve(null);
          const s = sRef.current;
          // scale strokes/points with the export resolution
          const k = size / 900;
          const scaled: Settings = {
            ...s,
            nodeSize: s.nodeSize * k,
            lineWidth: s.lineWidth * k,
            glow: s.glow * k,
          };
          renderScene(cx, size, size, scaled, gRef.current, {
            time: timeRef.current,
            opaque: true,
            background: !transparent,
          });
          c.toBlob((b) => resolve(b), 'image/png');
        }),
    }),
    [],
  );

  // pointer interaction ------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    let dragging = false;
    let lx = 0;
    let ly = 0;

    const down = (e: PointerEvent) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      el.setPointerCapture(e.pointerId);
    };

    const move = (e: PointerEvent) => {
      if (!dragging) return;
      onOrbit((e.clientX - lx) * 0.006, (e.clientY - ly) * 0.006);
      lx = e.clientX;
      ly = e.clientY;
    };

    const up = () => {
      dragging = false;
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      onZoom(e.deltaY > 0 ? 0.94 : 1.06);
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('wheel', wheel, { passive: false });

    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointerleave', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [onOrbit, onZoom]);

  // render loop --------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const start = performance.now();
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      timeRef.current = t;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderScene(ctx, w, h, sRef.current, gRef.current, { time: t, proj: scratch.current });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full w-full touch-none overflow-hidden">
      <canvas ref={canvasRef} className="block h-full w-full cursor-grab active:cursor-grabbing" />
    </div>
  );
});

export default Visualizer;
