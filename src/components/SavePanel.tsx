import { useRef, useState } from 'react';
import type { Preset } from '../lib/storage';
import { Cmd, Field, Section } from './ui';

type Props = {
  presets: Preset[];
  onSave: (name: string) => void;
  onLoad: (p: Preset) => void;
  onDelete: (id: string) => void;
  onExportPNG: (size: number, transparent: boolean) => void;
  onExportSVG: (size: number) => void;
  onCopyLink: () => void;
  onExportSettings: () => void;
  onImportSettings: (file: File) => void;
  onExportPresets: () => void;
  onImportPresets: (file: File) => void;
  onExportCSV: () => void;
  onExportSeqJSON: () => void;
};

const SIZES = [800, 1600, 2400, 4000];

export default function SavePanel(p: Props) {
  const [name, setName] = useState('');
  const [size, setSize] = useState(1600);
  const [transparent, setTransparent] = useState(false);
  const settingsFile = useRef<HTMLInputElement | null>(null);
  const presetsFile = useRef<HTMLInputElement | null>(null);

  const save = () => {
    p.onSave(name.trim());
    setName('');
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto py-1">
      <Section title="save.view" accent="amber">
        <div className="flex gap-1">
          <Field value={name} onChange={setName} onEnter={save} placeholder="preset name" />
          <Cmd onClick={save} tone="primary">
            write
          </Cmd>
        </div>
        <p className="font-mono text-[9px] text-emerald-900">
          # localStorage – thumbnail captured from the live frame
        </p>
      </Section>

      <Section title={`presets [${p.presets.length}]`}>
        {p.presets.length === 0 ? (
          <p className="py-3 text-center font-mono text-[10px] text-emerald-900">
            — no saved views —
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-1">
            {p.presets.map((preset) => (
              <div
                key={preset.id}
                className="group relative border border-emerald-900/70 bg-black/40 transition hover:border-emerald-600"
              >
                <button onClick={() => p.onLoad(preset)} className="block w-full text-left">
                  {preset.thumb ? (
                    <img
                      src={preset.thumb}
                      alt={preset.name}
                      className="aspect-square w-full object-cover opacity-80 transition group-hover:opacity-100"
                    />
                  ) : (
                    <div className="aspect-square w-full bg-black" />
                  )}
                  <div className="px-1.5 py-1 font-mono">
                    <div className="truncate text-[9px] text-emerald-300">{preset.name}</div>
                    <div className="text-[9px] text-emerald-800">
                      {preset.settings.layout === 'lattice'
                        ? `z4 n=${preset.settings.shell}`
                        : `${preset.settings.layout} n=${preset.settings.terms}`}
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => p.onDelete(preset.id)}
                  title="delete"
                  className="absolute right-0 top-0 bg-black/80 px-1 font-mono text-[10px] text-red-500 opacity-0 transition group-hover:opacity-100"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="export.image">
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono">
          {SIZES.map((sz) => (
            <button
              key={sz}
              onClick={() => setSize(sz)}
              className={`text-[11px] transition ${
                size === sz ? 'text-amber-300' : 'text-emerald-700 hover:text-emerald-400'
              }`}
            >
              <span className="text-emerald-900">(</span>
              {size === sz ? '●' : '○'}
              <span className="text-emerald-900">)</span> {sz}
            </button>
          ))}
        </div>
        <button
          onClick={() => setTransparent((v) => !v)}
          className={`block w-full text-left font-mono text-[11px] transition ${
            transparent ? 'text-emerald-300' : 'text-emerald-800 hover:text-emerald-500'
          }`}
        >
          <span className="text-emerald-900">[</span>
          {transparent ? 'x' : ' '}
          <span className="text-emerald-900">]</span> alpha background
        </button>
        <div className="grid grid-cols-2 gap-1 pt-0.5">
          <Cmd onClick={() => p.onExportPNG(size, transparent)} tone="primary">
            png: 1600px
          </Cmd>
          <Cmd onClick={() => p.onExportSVG(size)}>svg: vector</Cmd>
        </div>
      </Section>

      <Section title="share.files">
        <Cmd onClick={p.onCopyLink} tone="primary" className="w-full">
          share: copy link
        </Cmd>
        <div className="grid grid-cols-2 gap-1">
          <Cmd onClick={p.onExportSettings}>save: view.json</Cmd>
          <Cmd onClick={() => settingsFile.current?.click()}>load: view</Cmd>
          <Cmd onClick={p.onExportPresets}>save: presets</Cmd>
          <Cmd onClick={() => presetsFile.current?.click()}>load: import</Cmd>
        </div>
        <input
          ref={settingsFile}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onImportSettings(f);
            e.target.value = '';
          }}
        />
        <input
          ref={presetsFile}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onImportPresets(f);
            e.target.value = '';
          }}
        />
      </Section>

      <Section title="export.data">
        <div className="grid grid-cols-2 gap-1">
          <Cmd onClick={p.onExportCSV}>data: terms.csv</Cmd>
          <Cmd onClick={p.onExportSeqJSON}>data: terms.json</Cmd>
        </div>
        <p className="font-mono text-[9px] text-emerald-900"># first 60 terms of A287324</p>
      </Section>
    </div>
  );
}
