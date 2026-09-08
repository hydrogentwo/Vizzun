import type { Layout, RadiusLaw, RampName, Settings } from '../lib/geometry';
import { A287324 } from '../lib/seq';
import { Cmd, Section, Segmented, Slider, Toggle } from './ui';

type Props = {
  s: Settings;
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
  reset: () => void;
  randomize: () => void;
};

export default function Controls({ s, set, reset, randomize }: Props) {
  const lattice = s.layout === 'lattice';

  return (
    <div className="flex h-full flex-col overflow-y-auto py-1">
      <div className="flex gap-1 px-3 py-2">
        <Cmd onClick={randomize} tone="primary" className="flex-1">
          rand: randomize
        </Cmd>
        <Cmd onClick={reset} className="flex-1">
          init: reset
        </Cmd>
      </div>

      <Section title="draw.mode">
        <Segmented<Layout>
          label="layout"
          value={s.layout}
          onChange={(v) => set('layout', v)}
          options={[
            { value: 'rings', label: 'shells' },
            { value: 'spiral', label: 'spiral' },
            { value: 'lattice', label: 'z4-lattice' },
          ]}
        />
        <div className="grid grid-cols-2 gap-1 pt-1">
          <Cmd
            onClick={() => set('nodes', !s.nodes)}
            tone={s.nodes ? 'primary' : 'ghost'}
          >
            {s.nodes ? '[x]' : '[ ]'} node
          </Cmd>
          <Cmd
            onClick={() => set('polygon', !s.polygon)}
            tone={s.polygon ? 'primary' : 'ghost'}
          >
            {s.polygon ? '[x]' : '[ ]'} polygon
          </Cmd>
        </div>
      </Section>

      <Section title="sequence">
        {lattice ? (
          <Slider
            label="term n"
            value={s.shell}
            min={2}
            max={14}
            onChange={(v) => set('shell', v)}
            format={(v) => `n=${v} a=${A287324(v).toLocaleString()}`}
            hint={`shell |x|1=${Math.max(0, s.shell - 1)} + shell |x|1=${Math.max(
              0,
              s.shell - 2,
            )} of Z^4`}
          />
        ) : (
          <>
            <Slider
              label="terms drawn"
              value={s.terms}
              min={2}
              max={40}
              onChange={(v) => set('terms', v)}
              format={(v) => `n=1..${v}`}
            />
            <Slider
              label="units per node"
              value={s.density}
              min={1}
              max={80}
              onChange={(v) => set('density', v)}
              format={(v) => `1:${v}`}
              hint="ring n carries a(n)/d points"
            />
          </>
        )}
      </Section>

      {!lattice && (
        <Section title="geometry">
          <Segmented<RadiusLaw>
            label="radius law"
            value={s.radiusLaw}
            onChange={(v) => set('radiusLaw', v)}
            options={[
              { value: 'index', label: 'n' },
              { value: 'cbrt', label: 'cbrt(a)' },
              { value: 'sqrt', label: 'sqrt(a)' },
              { value: 'value', label: 'a(n)' },
            ]}
          />
          <Slider
            label="radial spread"
            value={s.spread}
            min={0.25}
            max={2.5}
            step={0.01}
            onChange={(v) => set('spread', v)}
            format={(v) => `r^${v.toFixed(2)}`}
          />
          <Slider
            label="twist / shell"
            value={s.twist}
            min={-45}
            max={45}
            step={0.1}
            onChange={(v) => set('twist', v)}
            format={(v) => `${v.toFixed(1)}deg`}
          />
          <Slider
            label="chord skip"
            value={s.step}
            min={1}
            max={60}
            onChange={(v) => set('step', v)}
            format={(v) => `{c/${v}}`}
          />
          <Toggle label="radial spokes" value={s.spokes} onChange={(v) => set('spokes', v)} />
          <Toggle label="fill polygons" value={s.fill} onChange={(v) => set('fill', v)} />
        </Section>
      )}

      <Section title="style">
        <Slider
          label="node size"
          value={s.nodeSize}
          min={0.4}
          max={7}
          step={0.1}
          onChange={(v) => set('nodeSize', v)}
          format={(v) => `${v.toFixed(1)}px`}
        />
        <Slider
          label="line weight"
          value={s.lineWidth}
          min={0.2}
          max={4}
          step={0.1}
          onChange={(v) => set('lineWidth', v)}
          format={(v) => v.toFixed(1)}
        />
        <Slider
          label="line alpha"
          value={s.lineAlpha}
          min={0.05}
          max={1}
          step={0.01}
          onChange={(v) => set('lineAlpha', v)}
          format={(v) => v.toFixed(2)}
        />
        <Slider label="glow" value={s.glow} min={0} max={30} onChange={(v) => set('glow', v)} />
        <Slider
          label="hue"
          value={s.hue}
          min={0}
          max={359}
          onChange={(v) => set('hue', v)}
          format={(v) => `${v}deg`}
        />
        <Slider
          label="hue drift"
          value={s.hueSpread}
          min={-30}
          max={30}
          step={0.5}
          onChange={(v) => set('hueSpread', v)}
          format={(v) => `${v}deg`}
        />
        <Slider
          label="motion trail"
          value={s.trail}
          min={0}
          max={0.97}
          step={0.01}
          onChange={(v) => set('trail', v)}
          format={(v) => (v === 0 ? 'off' : v.toFixed(2))}
        />
      </Section>

      <Section title="motion.framing">
        <Toggle label="auto rotate" value={s.spin} onChange={(v) => set('spin', v)} />
        <Slider
          label="speed"
          value={s.speed}
          min={-1.2}
          max={1.2}
          step={0.01}
          onChange={(v) => set('speed', v)}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="zoom"
          value={s.zoom}
          min={0.25}
          max={3}
          step={0.01}
          onChange={(v) => set('zoom', v)}
          format={(v) => `${v.toFixed(2)}x`}
        />
        <Slider
          label={lattice ? 'plane xz' : 'phase'}
          value={s.rotA}
          min={-Math.PI}
          max={Math.PI}
          step={0.01}
          onChange={(v) => set('rotA', v)}
          format={(v) => `${((v * 180) / Math.PI).toFixed(0)}deg`}
        />
        {lattice && (
          <Slider
            label="plane yw"
            value={s.rotB}
            min={-Math.PI}
            max={Math.PI}
            step={0.01}
            onChange={(v) => set('rotB', v)}
            format={(v) => `${((v * 180) / Math.PI).toFixed(0)}deg`}
          />
        )}
        <p className="font-mono text-[9px] leading-tight text-emerald-900">
          # drag viewport = orbit – wheel = zoom
        </p>
      </Section>

      <Section title="tui.glyph.raster" accent="amber">
        <Toggle
          label="enable tui glyph raster (ascii / terminal)"
          value={s.glyphMode}
          onChange={(v) => set('glyphMode', v)}
        />
        {s.glyphMode ? (
          <>
            <Slider
              label="cell size"
              value={s.cell}
              min={4}
              max={24}
              onChange={(v) => set('cell', v)}
              format={(v) => `${v}x${Math.round(v * 1.9)}px`}
            />
            <Segmented<RampName>
              label="glyph ramp"
              value={s.ramp}
              onChange={(v) => set('ramp', v)}
              options={[
                { value: 'blocks', label: '░▒▓█' },
                { value: 'ascii', label: '.:=#@' },
                { value: 'shade', label: '·oO@' },
                { value: 'dots', label: '·:∴⁘' },
                { value: 'binary', label: '01' },
              ]}
            />
            <Toggle label="crt scanlines" value={s.scanlines} onChange={(v) => set('scanlines', v)} />
            <Toggle label="monochrome phosphor" value={s.mono} onChange={(v) => set('mono', v)} />
          </>
        ) : (
          <p className="font-mono text-[9px] leading-tight text-emerald-900">
            # smooth vector mode active — toggle on for retro ASCII / CRT glyphs
          </p>
        )}
      </Section>
    </div>
  );
}
