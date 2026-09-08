import { DEFAULTS } from './geometry';
import type { Settings } from './geometry';
import { A287324 } from './seq';

export type Preset = {
  id: string;
  name: string;
  createdAt: number;
  settings: Settings;
  thumb?: string; // small data-url
};

const KEY = 'a287324.presets.v1';
const LAST = 'a287324.last.v2';

export function sanitize(raw: unknown): Settings {
  const out: Settings = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  (Object.keys(DEFAULTS) as (keyof Settings)[]).forEach((k) => {
    const v = r[k as string];
    const d = DEFAULTS[k];
    if (typeof v === typeof d && v !== null && v !== undefined) {
      // @ts-expect-error homogeneous assignment guarded above
      out[k] = v;
    }
  });
  return out;
}

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Preset[];
    if (!Array.isArray(arr)) return [];
    return arr.map((p) => ({ ...p, settings: sanitize(p.settings) }));
  } catch {
    return [];
  }
}

export function savePresets(list: Preset[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 60)));
  } catch {
    /* quota – ignore */
  }
}

export function saveLast(s: Settings) {
  try {
    localStorage.setItem(LAST, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function loadLast(): Settings | null {
  try {
    const raw = localStorage.getItem(LAST);
    return raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

// --- share links -----------------------------------------------------------

export function encodeSettings(s: Settings): string {
  const json = JSON.stringify(s);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeSettings(token: string): Settings | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64)));
    return sanitize(JSON.parse(json));
  } catch {
    return null;
  }
}

export function settingsFromURL(): Settings | null {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash.startsWith('v=')) return null;
  return decodeSettings(hash.slice(2));
}

export function shareURL(s: Settings): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#v=${encodeSettings(s)}`;
}

// --- file helpers ----------------------------------------------------------

export function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}`;
}

export function describe(s: Settings): string {
  const mode = s.layout === 'lattice' ? `Z4-n${s.shell}` : `${s.layout}-n${s.terms}`;
  const draw = [s.nodes ? 'nodes' : null, s.polygon ? 'poly' : null].filter(Boolean).join('+');
  return `a287324_${mode}_${draw || 'blank'}`;
}

// --- data exports ----------------------------------------------------------

export function sequenceCSV(count = 60): string {
  const lines = ['n,a(n)'];
  for (let n = 0; n < count; n++) lines.push(`${n},${A287324(n)}`);
  return lines.join('\n');
}

export function sequenceJSON(count = 60) {
  return JSON.stringify(
    {
      id: 'A287324',
      name: 'a(n) = A008412(n-1) + A008412(n-2) for n>1, a(0)=0, a(1)=1',
      offset: 0,
      formula: '(16n^3 - 72n^2 + 152n - 120)/3 for n >= 3',
      terms: Array.from({ length: count }, (_, n) => A287324(n)),
    },
    null,
    2,
  );
}
