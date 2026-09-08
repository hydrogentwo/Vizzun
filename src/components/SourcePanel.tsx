import { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import type { Backend, Settings } from '../lib/geometry';
import { SEQ_RS, rustProject } from '../lib/rust';
import { wgpuProject } from '../lib/wgpu';
import { download, stamp } from '../lib/storage';
import { Cmd } from './ui';
import BackendSwitch from './BackendSwitch';

const KEYWORDS =
  /\b(fn|let|mut|pub|struct|impl|enum|use|mod|const|static|for|in|if|else|match|return|self|Self|unsafe|as|where|type|trait|loop|while|break|continue|move|ref|dyn|crate|super|true|false)\b/g;

function highlight(code: string, lang: string): string {
  let out = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // strings first, protected with a placeholder
  const strings: string[] = [];
  out = out.replace(/"(?:[^"\\]|\\.)*"/g, (m) => {
    strings.push(m);
    return `\u0000S${strings.length - 1}\u0000`;
  });

  const comments: string[] = [];
  out = out.replace(/(\/\/[^\n]*|#[^\n]*)/g, (m) => {
    comments.push(m);
    return `\u0000C${comments.length - 1}\u0000`;
  });

  if (lang === 'rust' || lang === 'glsl') {
    out = out.replace(KEYWORDS, '<span class="text-fuchsia-400">$1</span>');
    out = out.replace(
      /\b(vk|ash|Device|Instance|Entry|Renderer|Vertex|Result|Vec|Option|String|u32|u8|i32|i64|f32|usize|bool)\b/g,
      '<span class="text-cyan-300">$1</span>',
    );
    out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="text-amber-300">$1</span>');
    out = out.replace(/(#\[[^\]]*\])/g, '<span class="text-emerald-600">$1</span>');
  }

  if (lang === 'glsl') {
    out = out.replace(
      /\b(layout|location|in|out|uniform|vec2|vec4|float|void|main|gl_Position|gl_PointSize)\b/g,
      '<span class="text-cyan-300">$1</span>',
    );
  }

  out = out.replace(/\u0000S(\d+)\u0000/g, (_m, i) => `<span class="text-lime-300">${strings[+i]}</span>`);
  out = out.replace(
    /\u0000C(\d+)\u0000/g,
    (_m, i) => `<span class="text-emerald-800 italic">${comments[+i]}</span>`,
  );

  return out;
}

export default function SourcePanel({
  settings,
  backend,
  onBackend,
  onNotify,
}: {
  settings: Settings;
  backend: Backend;
  onBackend: (b: Backend) => void;
  onNotify: (m: string) => void;
}) {
  const files = useMemo(
    () =>
      backend === 'wgpu' ? wgpuProject(settings, SEQ_RS) : rustProject(settings),
    [settings, backend],
  );

  const [active, setActive] = useState('src/main.rs');
  const file = files.find((f) => f.path === active) ?? files[0];

  // keep a sensible selection when the backend swaps the file list
  useEffect(() => {
    if (!files.some((f) => f.path === active)) setActive('src/main.rs');
  }, [files, active]);

  const html = useMemo(() => highlight(file.code, file.lang), [file]);
  const lines = file.code.split('\n').length;

  const zip = async () => {
    onNotify(`packing ${backend} cargo project...`);
    const z = new JSZip();
    const root = z.folder(`a287324-tui-${backend}`)!;
    files.forEach((f) => root.file(f.path, f.code));
    const blob = await z.generateAsync({ type: 'blob' });
    download(`a287324-tui-${backend}_${stamp()}.zip`, blob);
    onNotify('cargo project downloaded');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file.code);
      onNotify(`copied ${file.path}`);
    } catch {
      onNotify('clipboard blocked');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col font-mono">
      {/* backend rocker */}
      <div className="border-b border-emerald-900/70 px-2 py-2">
        <div className="flex items-center gap-1 pb-1 text-[10px] leading-none text-emerald-900">
          <span>┌</span>
          <span className="uppercase tracking-[0.16em] text-amber-300/90">gpu.backend</span>
          <span className="flex-1 overflow-hidden whitespace-nowrap">
            ────────────────────────────────────────
          </span>
          <span>┐</span>
        </div>
        <div className="border-x border-emerald-900/60 px-2 py-1.5">
          <BackendSwitch value={backend} onChange={onBackend} />
          <p className="mt-1.5 text-[9px] leading-tight text-emerald-900">
            <span className="text-emerald-800"># </span>
            {backend === 'wgpu'
              ? 'safe portable wgsl – vulkan/metal/dx12/gl – no unsafe'
              : 'raw vulkan via ash 0.38 – glsl spir-v – explicit sync'}
          </p>
        </div>
        <div className="flex text-[10px] leading-none text-emerald-900">
          <span>└</span>
          <span className="flex-1 overflow-hidden whitespace-nowrap">
            ────────────────────────────────────────
          </span>
          <span>┘</span>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-emerald-900/70 px-2 py-1.5">
        <Cmd onClick={zip} tone="primary">
          zip: cargo .zip
        </Cmd>
        <Cmd onClick={copy}>copy file</Cmd>
        <span className="ml-auto text-[9px] text-emerald-800">
          {files.length}f · {lines} ln
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="w-[38%] shrink-0 overflow-y-auto border-r border-emerald-900/70 py-1">
          <div className="px-2 pb-1 text-[9px] uppercase tracking-wider text-emerald-800">
            a287324-tui-{backend}/
          </div>
          {files.map((f, i) => {
            const on = f.path === active;
            const last = i === files.length - 1;
            return (
              <button
                key={f.path}
                onClick={() => setActive(f.path)}
                className={`flex w-full items-center gap-1 px-2 py-[3px] text-left text-[10px] transition ${
                  on ? 'bg-emerald-400/10 text-amber-300' : 'text-emerald-700 hover:text-emerald-300'
                }`}
              >
                <span className="text-emerald-900">{last ? '└' : '├'}</span>
                <span className="truncate">{f.path}</span>
              </button>
            );
          })}
          <div className="mt-2 border-t border-emerald-900/50 px-2 pt-2 text-[9px] leading-relaxed text-emerald-800">
            {backend === 'wgpu' ? (
              <>
                # R8Unorm texture
                <br /># 256B row align
                <br /># wgsl @ runtime
              </>
            ) : (
              <>
                # offscreen R8 image
                <br /># no swapchain
                <br /># fence + readback
              </>
            )}
            <br /># glyphs = luminance
          </div>
        </nav>

        <div className="min-w-0 flex-1 overflow-auto bg-black/40">
          <pre className="min-w-max p-2 text-[10px] leading-[1.45] text-emerald-300">
            <code dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
        </div>
      </div>
    </div>
  );
}
