import { useMemo, useState } from 'react';
import { cascade } from '../lib/seq';

export default function CascadePanel() {
  const rows = useMemo(() => cascade(6, 8), []);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);

  const eq =
    hover && hover.r > 0 && hover.c > 0
      ? `${rows[hover.r - 1].values[hover.c - 1]} + ${rows[hover.r - 1].values[hover.c]} = ${
          rows[hover.r].values[hover.c]
        }`
      : 'hover: each cell = sum of the two above';

  return (
    <div className="border border-emerald-900/70 bg-black/70 font-mono backdrop-blur">
      <div className="flex items-center justify-between gap-3 border-b border-emerald-900/70 px-2 py-1">
        <span className="text-[9px] uppercase tracking-[0.16em] text-emerald-500">
          ┌─ cascade.log ────────────────────────
        </span>
        <span className="text-[9px] text-amber-300">{eq}</span>
      </div>
      <div className="overflow-x-auto px-2 py-1">
        <table className="w-full border-separate border-spacing-0 text-right text-[10px]">
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.k} className={r === rows.length - 1 ? 'text-amber-300' : 'text-emerald-600'}>
                <td className="whitespace-nowrap pr-2 text-left">
                  <span className="text-emerald-900">f({row.k},n)</span>{' '}
                  <span className={r === rows.length - 1 ? 'text-amber-300' : 'text-emerald-400'}>
                    {row.id}
                  </span>
                </td>
                {row.values.map((v, c) => {
                  const isHover = hover?.r === r && hover?.c === c;
                  const isParent =
                    hover && hover.r === r + 1 && (hover.c === c || hover.c === c + 1);
                  return (
                    <td
                      key={c}
                      onMouseEnter={() => setHover({ r, c })}
                      onMouseLeave={() => setHover(null)}
                      className={`w-12 px-1 tabular-nums transition ${
                        isHover
                          ? 'bg-amber-400/20 text-amber-200'
                          : isParent
                            ? 'bg-emerald-400/15 text-emerald-200'
                            : ''
                      }`}
                    >
                      {v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-emerald-900/70 px-2 py-1 text-[9px] leading-relaxed text-emerald-800">
        # tetrahedral → pyramidal → octahedral → A001845 → A008412 → A287324
      </p>
    </div>
  );
}
