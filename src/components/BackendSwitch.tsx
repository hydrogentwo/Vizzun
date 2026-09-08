import type { Backend } from '../lib/geometry';

/**
 * Terminal-style rocker switch built from box-drawing and block glyphs.
 * Depth comes from a hard offset shadow (no gradients, no gloss) so it reads
 * as an extruded panel key while staying inside the phosphor palette.
 */
export default function BackendSwitch({
  value,
  onChange,
  compact = false,
}: {
  value: Backend;
  onChange: (b: Backend) => void;
  compact?: boolean;
}) {
  const on = value === 'wgpu';
  const cell = (active: boolean, label: string, mark: string) =>
    active ? (
      <span
        className="flex-1 px-1.5 py-[3px] text-center text-[10px] font-bold tracking-[0.12em] text-black transition-all duration-150"
        style={{
          background: 'linear-gradient(#fbbf24,#f59e0b)',
          boxShadow: 'inset -1px -1px 0 rgba(0,0,0,0.45), inset 1px 1px 0 rgba(255,255,255,0.5)',
        }}
      >
        {mark} {label}
      </span>
    ) : (
      <span
        className="flex-1 px-1.5 py-[3px] text-center text-[10px] tracking-[0.12em] text-emerald-900 transition-all duration-150"
        style={{
          background:
            'repeating-linear-gradient(90deg,#04120a 0px,#04120a 2px,#020b06 2px,#020b06 4px)',
          boxShadow: 'inset 1px 1px 2px rgba(0,0,0,0.9)',
        }}
      >
        {label}
      </span>
    );

  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(on ? 'ash' : 'wgpu')}
      title={`gpu backend: ${value} (W)`}
      className="group block w-full text-left font-mono"
    >
      <span
        className="flex w-full items-stretch border transition-colors duration-150 active:translate-x-[1px] active:translate-y-[1px]"
        style={{
          borderColor: on ? 'rgba(245,158,11,0.55)' : 'rgba(6,78,59,0.95)',
          boxShadow: `2px 2px 0 ${on ? 'rgba(120,53,15,0.7)' : 'rgba(6,78,59,0.55)'}`,
          background: '#020b06',
        }}
      >
        {cell(on, 'WGPU', '▶')}
        <span className="w-px shrink-0 bg-emerald-950" />
        {cell(!on, 'ASH', '■')}
      </span>
      {!compact && (
        <span className="mt-1 flex items-center gap-1.5 text-[9px] leading-none">
          <span
            className="inline-block h-[7px] w-[7px] rounded-full transition-all duration-200"
            style={{
              background: on ? '#fbbf24' : '#065f46',
              boxShadow: on ? '0 0 7px 1.5px rgba(251,191,36,0.75)' : 'none',
            }}
          />
          <span className={on ? 'text-amber-400/90' : 'text-emerald-600'}>
            {on ? 'I – ENGAGED' : 'O – ENGAGED'}
          </span>
          <span className="ml-auto text-emerald-800">
            {on ? 'wgpu 23' : 'ash 0.38'}
          </span>
        </span>
      )}
    </button>
  );
}
