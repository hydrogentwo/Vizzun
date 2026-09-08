import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Backend, Settings } from './lib/geometry';
import { DEFAULTS, buildGeometry } from './lib/geometry';
import { A287324, closedForm } from './lib/seq';
import {
  type Preset,
  describe,
  download,
  loadLast,
  loadPresets,
  saveLast,
  savePresets,
  sequenceCSV,
  sequenceJSON,
  settingsFromURL,
  shareURL,
  stamp,
} from './lib/storage';
import { sceneToSVG } from './lib/svg';
import Visualizer, { type VisualizerHandle } from './components/Visualizer';
import Controls from './components/Controls';
import CascadePanel from './components/CascadePanel';
import SourcePanel from './components/SourcePanel';
import SavePanel from './components/SavePanel';
import BackendSwitch from './components/BackendSwitch';
import { Cmd, Section } from './components/ui';

type Tab = 'controls' | 'cascade' | 'source' | 'save' | 'info';

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    const fromUrl = settingsFromURL();
    if (fromUrl) return fromUrl;
    const fromStorage = loadLast();
    if (fromStorage) return fromStorage;
    return { ...DEFAULTS };
  });

  const [presets, setPresets] = useState<Preset[]>(() => loadPresets());
  const [tab, setTab] = useState<Tab>('controls');
  const [notification, setNotification] = useState<string | null>('SYS OK :: A287324 ENGAGED');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const notifyTimer = useRef<number | null>(null);

  const visRef = useRef<VisualizerHandle | null>(null);

  const notify = useCallback((msg: string) => {
    setNotification(msg);
    if (notifyTimer.current) clearTimeout(notifyTimer.current);
    notifyTimer.current = window.setTimeout(() => setNotification(null), 4000);
  }, []);

  // Geometry cache
  const geometry = useMemo(() => buildGeometry(settings), [settings]);

  // Persist last settings
  useEffect(() => {
    saveLast(settings);
  }, [settings]);

  const setSetting = useCallback(<K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [k]: v }));
  }, []);

  const handleReset = useCallback(() => {
    setSettings({ ...DEFAULTS });
    notify('CONFIG RESET TO FACTORY DEFAULTS');
  }, [notify]);

  const handleRandomize = useCallback(() => {
    const layouts: Settings['layout'][] = ['rings', 'spiral', 'lattice'];
    const selectedLayout = layouts[Math.floor(Math.random() * layouts.length)];
    const hues = [28, 45, 142, 185, 210, 280, 330];
    const newHue = hues[Math.floor(Math.random() * hues.length)];

    setSettings((prev) => ({
      ...prev,
      layout: selectedLayout,
      terms: Math.floor(Math.random() * 22) + 8,
      shell: Math.floor(Math.random() * 8) + 4,
      density: Math.floor(Math.random() * 30) + 6,
      twist: Math.floor(Math.random() * 40) - 20,
      step: Math.floor(Math.random() * 12) + 1,
      hue: newHue,
      hueSpread: Math.floor(Math.random() * 26) - 13,
      nodeSize: +(Math.random() * 2.5 + 0.8).toFixed(1),
      lineWidth: +(Math.random() * 1.5 + 0.6).toFixed(1),
      lineAlpha: +(Math.random() * 0.5 + 0.35).toFixed(2),
      glow: Math.floor(Math.random() * 18),
      speed: +(Math.random() * 0.4 - 0.2).toFixed(2),
    }));
    notify('PARAM SEED RE-RANDOMIZED');
  }, [notify]);

  // Orbit & Zoom handlers from canvas pointer
  const handleOrbit = useCallback((dx: number, dy: number) => {
    setSettings((prev) => ({
      ...prev,
      rotA: prev.rotA + dx,
      rotB: prev.rotB + dy,
    }));
  }, []);

  const handleZoom = useCallback((factor: number) => {
    setSettings((prev) => ({
      ...prev,
      zoom: Math.max(0.2, Math.min(4, prev.zoom * factor)),
    }));
  }, []);

  // Presets and save operations
  const handleSavePreset = useCallback(
    (name: string) => {
      const trimmed = name.trim() || `view-${stamp()}`;
      const thumb = visRef.current?.thumbnail(128);
      const newPreset: Preset = {
        id: `p-${Date.now()}`,
        name: trimmed,
        createdAt: Date.now(),
        settings: { ...settings },
        thumb,
      };
      const updated = [newPreset, ...presets];
      setPresets(updated);
      savePresets(updated);
      notify(`SAVED PRESET: ${trimmed}`);
    },
    [presets, settings, notify],
  );

  const handleLoadPreset = useCallback(
    (p: Preset) => {
      setSettings(p.settings);
      notify(`LOADED: ${p.name}`);
    },
    [notify],
  );

  const handleDeletePreset = useCallback(
    (id: string) => {
      const updated = presets.filter((p) => p.id !== id);
      setPresets(updated);
      savePresets(updated);
      notify('PRESET PURGED');
    },
    [presets, notify],
  );

  const handleExportPNG = useCallback(
    async (size: number, transparent: boolean) => {
      notify(`RASTERIZING PNG (${size}x${size})...`);
      const blob = await visRef.current?.capture(size, transparent);
      if (blob) {
        download(`${describe(settings)}_${stamp()}.png`, blob);
        notify('PNG DOWNLOAD COMPLETE');
      } else {
        notify('ERROR RASTERIZING PNG');
      }
    },
    [settings, notify],
  );

  const handleExportSVG = useCallback(
    (size: number) => {
      notify(`SYNTHESIZING VECTOR SVG (${size}x${size})...`);
      const time = visRef.current?.time() ?? 0;
      const svgStr = sceneToSVG(settings, geometry, size, true, time);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      download(`${describe(settings)}_${stamp()}.svg`, blob);
      notify('SVG EXPORT COMPLETE');
    },
    [settings, geometry, notify],
  );

  const handleCopyLink = useCallback(() => {
    const url = shareURL(settings);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(
        () => notify('STATE URL COPIED TO CLIPBOARD'),
        () => notify('CLIPBOARD WRITE BLOCKED'),
      );
    } else {
      window.location.hash = `v=${url.split('#v=')[1]}`;
      notify('URL HASH UPDATED');
    }
  }, [settings, notify]);

  const handleExportSettings = useCallback(() => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], {
      type: 'application/json',
    });
    download(`a287324_settings_${stamp()}.json`, blob);
    notify('SETTINGS JSON EXPORTED');
  }, [settings, notify]);

  const handleImportSettings = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target?.result as string);
          setSettings((prev) => ({ ...prev, ...parsed }));
          notify(`IMPORTED: ${file.name}`);
        } catch {
          notify('PARSE ERROR: INVALID JSON');
        }
      };
      reader.readAsText(file);
    },
    [notify],
  );

  const handleExportPresets = useCallback(() => {
    const blob = new Blob([JSON.stringify(presets, null, 2)], {
      type: 'application/json',
    });
    download(`a287324_presets_${stamp()}.json`, blob);
    notify(`EXPORTED ${presets.length} PRESETS`);
  }, [presets, notify]);

  const handleImportPresets = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target?.result as string);
          if (Array.isArray(parsed)) {
            setPresets(parsed);
            savePresets(parsed);
            notify(`LOADED ${parsed.length} PRESETS`);
          } else {
            notify('INVALID PRESETS FILE');
          }
        } catch {
          notify('PARSE ERROR IN PRESETS FILE');
        }
      };
      reader.readAsText(file);
    },
    [notify],
  );

  const handleExportCSV = useCallback(() => {
    const csv = sequenceCSV(100);
    const blob = new Blob([csv], { type: 'text/csv' });
    download(`A287324_terms_${stamp()}.csv`, blob);
    notify('TERMS CSV EXPORTED');
  }, [notify]);

  const handleExportSeqJSON = useCallback(() => {
    const json = sequenceJSON(100);
    const blob = new Blob([json], { type: 'application/json' });
    download(`A287324_metadata_${stamp()}.json`, blob);
    notify('TERMS JSON EXPORTED');
  }, [notify]);

  // Keyboard shortcut listener
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setSettings((prev) => ({ ...prev, spin: !prev.spin }));
        notify(`SPIN ${!settings.spin ? 'ENGAGED' : 'HALTED'}`);
      } else if (e.key === 't' || e.key === 'T') {
        setSettings((prev) => ({ ...prev, glyphMode: !prev.glyphMode }));
        notify(`RENDER: ${!settings.glyphMode ? 'TUI GLYPH RASTER' : 'SMOOTH VECTOR'}`);
      } else if (e.key === 'r' || e.key === 'R') {
        handleRandomize();
      } else if (e.key === 'w' || e.key === 'W') {
        setSettings((prev) => ({
          ...prev,
          backend: prev.backend === 'wgpu' ? 'ash' : 'wgpu',
        }));
        notify(`BACKEND: ${settings.backend === 'wgpu' ? 'ASH (VULKAN)' : 'WGPU'}`);
      } else if (e.key === '1') {
        setTab('controls');
      } else if (e.key === '2') {
        setTab('cascade');
      } else if (e.key === '3') {
        setTab('source');
      } else if (e.key === '4') {
        setTab('save');
      } else if (e.key === '5') {
        setTab('info');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings.spin, settings.glyphMode, settings.backend, handleRandomize, notify]);

  const activeTerm = settings.layout === 'lattice' ? settings.shell : settings.terms;
  const aVal = A287324(activeTerm);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#050803] font-mono text-emerald-300 select-none">
      {/* ── Top Header / Shell Bar ── */}
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-emerald-900/80 bg-[#030602] px-3 text-[11px]">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-widest text-emerald-400">
            A287324<span className="text-amber-400">::</span>TUI
          </span>
          <span className="hidden text-emerald-800 md:inline">|</span>
          <span className="hidden text-[10px] uppercase text-emerald-600 sm:inline">
            OEIS 4D-LATTICE RECURRENCE VISUALIZER
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Layout badge */}
          <div className="hidden items-center gap-1 border border-emerald-900/70 bg-black/40 px-2 py-0.5 text-[10px] md:flex">
            <span className="text-emerald-700">MODE:</span>
            <span className="text-amber-300 uppercase">{settings.layout}</span>
          </div>

          {/* Value badge */}
          <div className="flex items-center gap-1 border border-emerald-900/70 bg-black/40 px-2 py-0.5 text-[10px]">
            <span className="text-emerald-700">a({activeTerm})=</span>
            <span className="font-bold text-amber-300">{aVal.toLocaleString()}</span>
          </div>

          {/* Spin toggle */}
          <button
            onClick={() => setSetting('spin', !settings.spin)}
            className={`border px-2 py-0.5 text-[10px] uppercase transition ${
              settings.spin
                ? 'border-emerald-600 bg-emerald-950/40 text-emerald-300'
                : 'border-emerald-950 text-emerald-800 hover:text-emerald-600'
            }`}
            title="Toggle Auto Orbit (Space)"
          >
            {settings.spin ? '▶ SPIN' : '❚❚ PAUSE'}
          </button>

          {/* Toggle sidebar button */}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="border border-emerald-900/70 px-2 py-0.5 text-[10px] text-emerald-400 hover:border-emerald-600"
            title="Toggle inspector panel"
          >
            {sidebarOpen ? '► HIDE' : '◄ PANEL'}
          </button>
        </div>
      </header>

      {/* ── Main Workspace Body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left / Center Viewport */}
        <div className="relative flex flex-1 flex-col overflow-hidden bg-[#050803]">
          {/* Canvas Container */}
          <div className="relative h-full w-full flex-1">
            <Visualizer
              ref={visRef}
              settings={settings}
              geometry={geometry}
              onOrbit={handleOrbit}
              onZoom={handleZoom}
            />

            {/* Corner retro markings */}
            <div className="pointer-events-none absolute left-3 top-3 font-mono text-[9px] text-emerald-700/80">
              <div>┌── VIEWPORT 4D.PROJ ──────────────────────</div>
              <div className="mt-0.5 text-emerald-500">
                L: {settings.layout.toUpperCase()} | NODES: {geometry.nodeCount.toLocaleString()} |
                EDGES: {geometry.edgeCount.toLocaleString()}
              </div>
              <div className="text-emerald-700">
                ZOOM: {settings.zoom.toFixed(2)}x | ROT_A: {((settings.rotA * 180) / Math.PI).toFixed(0)}°
                {settings.layout === 'lattice' &&
                  ` | ROT_B: ${((settings.rotB * 180) / Math.PI).toFixed(0)}°`}
              </div>
            </div>

            <div className="pointer-events-none absolute bottom-3 left-3 font-mono text-[9px] text-emerald-800/80">
              <div>└── INTERACTION: DRAG=ORBIT · WHEEL=ZOOM · [SPACE]=SPIN · [T]=GLYPHS ────</div>
            </div>

            {/* Quick layout shortcuts overlaid on canvas */}
            <div className="absolute right-3 top-3 flex flex-col items-end gap-1 font-mono">
              <div className="flex gap-1 border border-emerald-900/80 bg-black/80 p-1 text-[10px] backdrop-blur">
                <button
                  onClick={() => setSetting('layout', 'rings')}
                  className={`px-1.5 py-0.5 ${
                    settings.layout === 'rings'
                      ? 'bg-amber-400/20 text-amber-300 font-bold'
                      : 'text-emerald-700 hover:text-emerald-400'
                  }`}
                >
                  SHELLS
                </button>
                <button
                  onClick={() => setSetting('layout', 'spiral')}
                  className={`px-1.5 py-0.5 ${
                    settings.layout === 'spiral'
                      ? 'bg-amber-400/20 text-amber-300 font-bold'
                      : 'text-emerald-700 hover:text-emerald-400'
                  }`}
                >
                  SPIRAL
                </button>
                <button
                  onClick={() => setSetting('layout', 'lattice')}
                  className={`px-1.5 py-0.5 ${
                    settings.layout === 'lattice'
                      ? 'bg-amber-400/20 text-amber-300 font-bold'
                      : 'text-emerald-700 hover:text-emerald-400'
                  }`}
                >
                  Z⁴-LATTICE
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar Panel */}
        {sidebarOpen && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-emerald-900/80 bg-[#030602] md:w-96">
            {/* Panel Tabs */}
            <div className="flex border-b border-emerald-900/80 bg-black/40 text-[10px]">
              <button
                onClick={() => setTab('controls')}
                className={`flex-1 py-1.5 text-center transition ${
                  tab === 'controls'
                    ? 'border-b-2 border-amber-400 bg-emerald-950/20 text-amber-300 font-semibold'
                    : 'text-emerald-700 hover:text-emerald-400'
                }`}
              >
                [1] CTRL
              </button>
              <button
                onClick={() => setTab('cascade')}
                className={`flex-1 py-1.5 text-center transition ${
                  tab === 'cascade'
                    ? 'border-b-2 border-amber-400 bg-emerald-950/20 text-amber-300 font-semibold'
                    : 'text-emerald-700 hover:text-emerald-400'
                }`}
              >
                [2] CASC
              </button>
              <button
                onClick={() => setTab('source')}
                className={`flex-1 py-1.5 text-center transition ${
                  tab === 'source'
                    ? 'border-b-2 border-amber-400 bg-emerald-950/20 text-amber-300 font-semibold'
                    : 'text-emerald-700 hover:text-emerald-400'
                }`}
              >
                [3] CODE
              </button>
              <button
                onClick={() => setTab('save')}
                className={`flex-1 py-1.5 text-center transition ${
                  tab === 'save'
                    ? 'border-b-2 border-amber-400 bg-emerald-950/20 text-amber-300 font-semibold'
                    : 'text-emerald-700 hover:text-emerald-400'
                }`}
              >
                [4] EXPORT
              </button>
              <button
                onClick={() => setTab('info')}
                className={`flex-1 py-1.5 text-center transition ${
                  tab === 'info'
                    ? 'border-b-2 border-amber-400 bg-emerald-950/20 text-amber-300 font-semibold'
                    : 'text-emerald-700 hover:text-emerald-400'
                }`}
              >
                [5] INFO
              </button>
            </div>

            {/* Tab Body */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'controls' && (
                <Controls
                  s={settings}
                  set={setSetting}
                  reset={handleReset}
                  randomize={handleRandomize}
                />
              )}

              {tab === 'cascade' && (
                <div className="p-2">
                  <CascadePanel />
                  <div className="mt-3 p-2 font-mono text-[10px] text-emerald-600 border border-emerald-900/60 bg-black/40">
                    <div className="text-amber-300/90 uppercase tracking-wide">Cascade Principle</div>
                    <p className="mt-1 leading-relaxed text-emerald-500">
                      Each sequence in the iterated summation cascade is the binomial transform or partial sum
                      vector of the row above:
                    </p>
                    <ul className="mt-2 space-y-1 text-emerald-400">
                      <li>• A000292: Tetrahedral numbers</li>
                      <li>• A000330: Square pyramidal</li>
                      <li>• A005900: Octahedral numbers</li>
                      <li>• A001845: Centered octahedral (3D ball)</li>
                      <li>• A008412: 4D hypercubic lattice Z⁴ shell</li>
                      <li>• A287324: a(n) = A008412(n-1) + A008412(n-2)</li>
                    </ul>
                  </div>
                </div>
              )}

              {tab === 'source' && (
                <SourcePanel
                  settings={settings}
                  backend={settings.backend}
                  onBackend={(b: Backend) => setSetting('backend', b)}
                  onNotify={notify}
                />
              )}

              {tab === 'save' && (
                <SavePanel
                  presets={presets}
                  onSave={handleSavePreset}
                  onLoad={handleLoadPreset}
                  onDelete={handleDeletePreset}
                  onExportPNG={handleExportPNG}
                  onExportSVG={handleExportSVG}
                  onCopyLink={handleCopyLink}
                  onExportSettings={handleExportSettings}
                  onImportSettings={handleImportSettings}
                  onExportPresets={handleExportPresets}
                  onImportPresets={handleImportPresets}
                  onExportCSV={handleExportCSV}
                  onExportSeqJSON={handleExportSeqJSON}
                />
              )}

              {tab === 'info' && (
                <div className="p-3 space-y-3 font-mono text-[11px]">
                  <Section title="OEIS.A287324" accent="amber">
                    <p className="text-emerald-300 font-bold">
                      Coordination Sum Sequence
                    </p>
                    <p className="text-emerald-500 text-[10px] leading-relaxed mt-1">
                      Definition: a(n) = A008412(n-1) + A008412(n-2) for n &gt; 1, with initial conditions a(0)=0, a(1)=1.
                    </p>
                  </Section>

                  <Section title="FORMULA">
                    <div className="bg-black/60 p-2 border border-emerald-900/60 text-amber-300 text-[10px]">
                      a(n) = (16n³ - 72n² + 152n - 120) / 3
                    </div>
                    <p className="text-[10px] text-emerald-600 mt-1">
                      Valid for all integer indices n ≥ 3.
                    </p>
                    <div className="mt-2 text-[10px] text-emerald-400">
                      <div>n = {activeTerm}</div>
                      <div>closedForm({activeTerm}) = {closedForm(activeTerm)}</div>
                      <div>a({activeTerm}) = {A287324(activeTerm)}</div>
                    </div>
                  </Section>

                  <Section title="GEOMETRIC.INTERPRETATION">
                    <p className="text-[10px] text-emerald-400 leading-relaxed">
                      A008412 counts the number of points at ℓ₁ Manhattan distance m from the origin in
                      the 4-dimensional integer cubic lattice ℤ⁴.
                    </p>
                    <p className="mt-1.5 text-[10px] text-emerald-500 leading-relaxed">
                      In the Z⁴-lattice layout, this application generates the exact integer coordinate vertices
                      at shell distance (n-1) and (n-2) and visualizes the unit lattice edges bridging them in 4D space.
                    </p>
                  </Section>

                  <Section title="GPU.EXPORTS">
                    <p className="text-[10px] text-emerald-500 leading-relaxed">
                      The Code tab compiles a standalone, production-ready Rust Cargo project leveraging either:
                    </p>
                    <div className="mt-1 space-y-1 text-[10px]">
                      <div>
                        <span className="text-amber-300 font-bold">WGPU:</span> Modern, portable WebGPU API rendering with WGSL compute &amp; graphics.
                      </div>
                      <div>
                        <span className="text-amber-300 font-bold">ASH:</span> Direct, raw Vulkan 0.38 bindings with spir-v bytecode and explicit fences.
                      </div>
                    </div>
                  </Section>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── Bottom Statusline / Footer ── */}
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-emerald-900/80 bg-[#020502] px-3 text-[10px] text-emerald-600">
        <div className="flex items-center gap-2 overflow-hidden truncate">
          <span className="text-emerald-500">$</span>
          <span className={notification ? 'text-amber-300 font-semibold' : 'text-emerald-500'}>
            {notification || 'IDLE :: READY'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Option to turn on TUI raster down at the bottom */}
          <button
            onClick={() => {
              const next = !settings.glyphMode;
              setSetting('glyphMode', next);
              notify(`RENDER: ${next ? 'TUI GLYPH RASTER' : 'SMOOTH VECTOR'}`);
            }}
            className={`border px-2 py-0.5 text-[9px] uppercase transition ${
              settings.glyphMode
                ? 'border-amber-500/80 bg-amber-400/20 text-amber-300 font-bold'
                : 'border-emerald-900/70 bg-black/50 text-emerald-600 hover:border-emerald-700 hover:text-emerald-300'
            }`}
            title="Toggle TUI Monospace Raster vs Vector (Key: T)"
          >
            {settings.glyphMode ? '■ TUI RASTER: ON' : '□ TUI RASTER: OFF'}
          </button>

          <div className="hidden items-center gap-3 md:flex">
            <span className="text-emerald-950">|</span>
            <span>BACKEND: <span className="text-amber-300">{settings.backend.toUpperCase()}</span></span>
            <span className="text-emerald-950">|</span>
            <span>KEYS: [R] rand [Space] spin [T] tui [W] gpu [1-5] tabs</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
