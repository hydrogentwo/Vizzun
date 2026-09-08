import type { ReactNode } from 'react';

export const TUI = {
  green: 'text-emerald-300',
  dim: 'text-emerald-800',
  amber: 'text-amber-300',
  border: 'border-emerald-900/70',
};

/** ┌─ title ─ style panel */
export function Section({
  title,
  children,
  accent = 'emerald',
}: {
  title: string;
  children: ReactNode;
  accent?: 'emerald' | 'amber';
}) {
  const c = accent === 'amber' ? 'text-amber-300/90' : 'text-emerald-400/90';
  return (
    <div className="px-3 pb-3 pt-2 font-mono">
      <div className="flex items-center gap-1 text-[10px] leading-none text-emerald-900">
        <span>┌</span>
        <span className={`${c} uppercase tracking-[0.16em]`}>{title}</span>
        <span className="flex-1 overflow-hidden whitespace-nowrap">
          ────────────────────────────────────────────────
        </span>
        <span>┐</span>
      </div>
      <div className="space-y-2 border-x border-emerald-900/60 px-2.5 py-2">{children}</div>
      <div className="flex text-[10px] leading-none text-emerald-900">
        <span>└</span>
        <span className="flex-1 overflow-hidden whitespace-nowrap">
          ────────────────────────────────────────────────
        </span>
        <span>┘</span>
      </div>
    </div>
  );
}

const BAR_ON = '█';
const BAR_OFF = '░';

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  hint,
  width = 16,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
  width?: number;
}) {
  const pct = (value - min) / (max - min || 1);
  const filled = Math.round(pct * width);
  const bar = BAR_ON.repeat(Math.max(0, filled)) + BAR_OFF.repeat(Math.max(0, width - filled));
  return (
    <label className="block select-none font-mono">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-emerald-600">{label}</span>
        <span className="text-[10px] text-amber-300">{format ? format(value) : value}</span>
      </div>
      <div className="group relative mt-0.5">
        <div className="pointer-events-none flex items-center gap-1 text-[11px] leading-none">
          <span className="text-emerald-900">[</span>
          <span className="tracking-[0.05em] text-emerald-400 group-hover:text-emerald-300">
            {bar}
          </span>
          <span className="text-emerald-900">]</span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
      {hint ? (
        <p className="mt-0.5 text-[9px] leading-tight text-emerald-900">
          <span className="text-emerald-800"># </span>
          {hint}
        </p>
      ) : null}
    </label>
  );
}

/** ( ) opt  ( ) opt – radio row */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="font-mono">
      {label ? (
        <div className="text-[10px] uppercase tracking-wider text-emerald-600">{label}</div>
      ) : null}
      <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              className={`text-[11px] leading-tight transition ${
                on ? 'text-amber-300' : 'text-emerald-700 hover:text-emerald-400'
              }`}
            >
              <span className="text-emerald-900">(</span>
              {on ? '●' : '○'}
              <span className="text-emerald-900">)</span> {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** [x] label */
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`block w-full text-left font-mono text-[11px] transition ${
        value ? 'text-emerald-300' : 'text-emerald-800 hover:text-emerald-500'
      }`}
    >
      <span className="text-emerald-900">[</span>
      {value ? 'x' : ' '}
      <span className="text-emerald-900">]</span> {label}
    </button>
  );
}

/** < command > button */
export function Cmd({
  children,
  onClick,
  tone = 'ghost',
  className = '',
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: 'ghost' | 'primary' | 'danger';
  className?: string;
  title?: string;
}) {
  const tones = {
    ghost: 'border-emerald-900 text-emerald-500 hover:border-emerald-600 hover:text-emerald-300',
    primary:
      'border-amber-500/60 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 hover:border-amber-400',
    danger: 'border-red-900 text-red-400 hover:bg-red-500/10 hover:text-red-300',
  } as const;
  return (
    <button
      title={title}
      onClick={onClick}
      className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  value,
  onChange,
  onEnter,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  placeholder?: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 border border-emerald-900 bg-black/40 px-2 py-1 focus-within:border-emerald-600">
      <span className="font-mono text-[11px] text-emerald-600">$</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-emerald-200 caret-amber-300 placeholder:text-emerald-900 focus:outline-none"
      />
    </div>
  );
}
