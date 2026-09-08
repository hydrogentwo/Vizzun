import type { Settings } from './geometry';
import type { SourceFile } from './rust';

const CARGO = `[package]
name = "a287324-tui"
version = "0.1.0"
edition = "2021"
description = "Terminal visualiser for OEIS A287324 rendered headlessly with wgpu"

[dependencies]
wgpu = "23"
pollster = "0.4"
bytemuck = { version = "1", features = ["derive"] }
crossterm = "0.28"
ratatui = "0.29"
anyhow = "1"

[profile.release]
opt-level = 3
lto = true
`;

const GPU_RS = `//! Headless \`wgpu\` renderer.
//! wgpu picks the best backend for the machine (Vulkan, Metal, DX12, GL) and
//! gives us a safe, \`async\`-free-at-the-edges API via \`pollster\`. There is no
//! window and no surface: we render into an offscreen \`R8Unorm\` texture, copy
//! it into a mapped buffer, and hand the luminance grid to the terminal.

use anyhow::{anyhow, Result};
use bytemuck::{Pod, Zeroable};
use std::borrow::Cow;
use wgpu::util::{BufferInitDescriptor, DeviceExt};

pub const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::R8Unorm;

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Vertex {
    pub pos: [f32; 2],
    pub intensity: f32,
    pub _pad: f32,
}

impl Vertex {
    pub fn new(pos: [f32; 2], intensity: f32) -> Self {
        Self { pos, intensity, _pad: 0.0 }
    }

    const ATTRS: [wgpu::VertexAttribute; 2] =
        wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32];

    fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRS,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    aspect: f32,
    point_size: f32,
    _pad: [f32; 2],
}

pub struct Renderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pub width: u32,
    pub height: u32,
    /// bytes-per-row must be a multiple of 256 for texture -> buffer copies
    padded_row: u32,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    readback: wgpu::Buffer,
    uniform: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    point_pipe: wgpu::RenderPipeline,
    line_pipe: wgpu::RenderPipeline,
    pub adapter_name: String,
    pub backend: String,
}

impl Renderer {
    pub fn new(width: u32, height: u32) -> Result<Self> {
        pollster::block_on(Self::new_async(width, height))
    }

    async fn new_async(width: u32, height: u32) -> Result<Self> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..Default::default()
        });
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| anyhow!("no wgpu adapter"))?;
        let info = adapter.get_info();
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("a287324"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_defaults(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await?;

        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("target"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());

        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT; // 256
        let padded_row = ((width + align - 1) / align) * align;
        let readback = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: (padded_row * height) as wgpu::BufferAddress,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        let uniform = device.create_buffer_init(&BufferInitDescriptor {
            label: Some("uniforms"),
            contents: bytemuck::bytes_of(&Uniforms {
                aspect: width as f32 / height as f32,
                point_size: 1.0,
                _pad: [0.0; 2],
            }),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &bgl,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform.as_entire_binding(),
            }],
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene.wgsl"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(include_str!("scene.wgsl"))),
        });

        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[&bgl],
            push_constant_ranges: &[],
        });

        // additive blending: overlapping strokes accumulate luminance
        let blend = wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::One,
                operation: wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent::REPLACE,
        };

        let make = |topology: wgpu::PrimitiveTopology, label: &str| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(&layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vs_main"),
                    buffers: &[Vertex::layout()],
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some("fs_main"),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: FORMAT,
                        blend: Some(blend),
                        write_mask: wgpu::ColorWrites::RED,
                    })],
                    compilation_options: Default::default(),
                }),
                primitive: wgpu::PrimitiveState { topology, ..Default::default() },
                depth_stencil: None,
                multisample: Default::default(),
                multiview: None,
                cache: None,
            })
        };

        Ok(Self {
            point_pipe: make(wgpu::PrimitiveTopology::PointList, "points"),
            line_pipe: make(wgpu::PrimitiveTopology::LineList, "lines"),
            device,
            queue,
            width,
            height,
            padded_row,
            texture,
            view,
            readback,
            uniform,
            bind_group,
            adapter_name: info.name,
            backend: format!("{:?}", info.backend),
        })
    }

    /// Draw one frame and return the R8 luminance buffer, row major, unpadded.
    pub fn draw(&mut self, points: &[Vertex], lines: &[Vertex], point_size: f32) -> Result<Vec<u8>> {
        self.queue.write_buffer(
            &self.uniform,
            0,
            bytemuck::bytes_of(&Uniforms {
                aspect: self.width as f32 / self.height as f32,
                point_size,
                _pad: [0.0; 2],
            }),
        );

        let all: Vec<Vertex> = points.iter().chain(lines.iter()).copied().collect();
        let vbuf = self.device.create_buffer_init(&BufferInitDescriptor {
            label: Some("verts"),
            contents: bytemuck::cast_slice(if all.is_empty() {
                &[Vertex::new([0.0, 0.0], 0.0)][..]
            } else {
                &all[..]
            }),
            usage: wgpu::BufferUsages::VERTEX,
        });

        let mut enc = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });

        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
            });
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.set_vertex_buffer(0, vbuf.slice(..));
            if !lines.is_empty() {
                pass.set_pipeline(&self.line_pipe);
                let start = points.len() as u32;
                pass.draw(start..start + lines.len() as u32, 0..1);
            }
            if !points.is_empty() {
                pass.set_pipeline(&self.point_pipe);
                pass.draw(0..points.len() as u32, 0..1);
            }
        }

        enc.copy_texture_to_buffer(
            wgpu::ImageCopyTexture {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::ImageCopyBuffer {
                buffer: &self.readback,
                layout: wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(self.padded_row),
                    rows_per_image: Some(self.height),
                },
            },
            wgpu::Extent3d { width: self.width, height: self.height, depth: 0 + 1 },
        );

        self.queue.submit(Some(enc.finish()));

        let slice = self.readback.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        self.device.poll(wgpu::Maintain::Wait);
        rx.recv()??;

        let data = slice.get_mapped_range();
        let mut out = Vec::with_capacity((self.width * self.height) as usize);
        for row in 0..self.height {
            let start = (row * self.padded_row) as usize;
            out.extend_from_slice(&data[start..start + self.width as usize]);
        }
        drop(data);
        self.readback.unmap();
        Ok(out)
    }
}
`;

const WGSL = `// scene.wgsl – one pipeline pair (points + lines) writing luminance only.

struct Uniforms {
    aspect: f32,
    point_size: f32,
    _pad: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) intensity: f32,
};

@vertex
fn vs_main(
    @location(0) pos: vec2<f32>,      // already in [-1, 1] scene space
    @location(1) intensity: f32,
) -> VsOut {
    var out: VsOut;
    var p = pos;
    p.x = p.x / u.aspect;
    out.clip = vec4<f32>(p, 0.0, 1.0);
    out.intensity = intensity;
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    // only the red channel is written (R8Unorm target)
    return vec4<f32>(in.intensity, 0.0, 0.0, 1.0);
}
`;

const README = `# a287324-tui (wgpu)

A terminal visualiser for **OEIS A287324** – \`a(n) = A008412(n-1) + A008412(n-2)\`, \`a(0)=0\`, \`a(1)=1\` –
rendered **headlessly on the GPU with [\`wgpu\`](https://crates.io/crates/wgpu)** and displayed as text.

## Why wgpu

\`wgpu\` is the safe, portable option: one WGSL shader and one pipeline description run on
**Vulkan, Metal, DX12 and GL** without \`unsafe\`, without a loader to install, and without
per-platform surface extensions. The \`ash\` variant of this project is ~700 lines of explicit
Vulkan; this one is ~250 and runs everywhere. Flip the switch in the web UI to compare them
side by side.

## How it works

1. \`seq.rs\` enumerates the two coordination shells of the 4-D cubic lattice
   \`Z^4\` whose sizes are \`A008412(n-1)\` and \`A008412(n-2)\`. Their union has
   exactly \`a(n)\` points – the recurrence made geometric.
2. Points are projected 4D -> 2D through two rotation planes (xz and yw) and
   uploaded as a vertex buffer.
3. \`gpu.rs\` renders them into an offscreen \`R8Unorm\` texture with additive
   blending, so overlapping strokes accumulate luminance. No window, no surface.
4. The texture is copied into a mapped buffer (respecting the 256-byte
   \`bytes_per_row\` alignment), downsampled onto the terminal's character grid,
   and mapped through a glyph ramp by \`ratatui\` + \`crossterm\`.

## Run

\`\`\`sh
cargo run --release
\`\`\`

No shader toolchain required – WGSL is compiled at runtime by naga.

## Keys

| key            | action                          |
|----------------|---------------------------------|
| \`h\` / \`l\`      | previous / next term \`n\`        |
| \`j\` / \`k\`      | glyph gain                      |
| \`p\`            | toggle polygon (edge) pass      |
| \`o\`            | toggle node (point) pass        |
| \`space\`        | pause auto-rotation             |
| \`q\` / \`Ctrl-C\` | quit                            |
`;

function fmt(n: number) {
  return Number.isInteger(n) ? `${n}.0` : n.toFixed(3);
}

function mainRs(s: Settings): string {
  return `//! a287324-tui – OEIS A287324 rendered headlessly by wgpu, displayed as text.

mod gpu;
mod seq;

use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use gpu::Vertex;
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph},
};
use std::{
    io::stdout,
    time::{Duration, Instant},
};

/// Exported from the web visualiser.
const TERM_N: i32 = ${s.layout === 'lattice' ? s.shell : s.terms};
const ROT_A: f32 = ${fmt(s.rotA)};
const ROT_B: f32 = ${fmt(s.rotB)};
const SPEED: f32 = ${fmt(s.speed)};
const ZOOM: f32 = ${fmt(s.zoom)};
const DRAW_NODES: bool = ${s.nodes};
const DRAW_EDGES: bool = ${s.polygon};
const RAMP: &[char] = &[' ', '░', '▒', '▓', '█'];

struct App {
    n: i32,
    time: f32,
    paused: bool,
    gain: f32,
    nodes: bool,
    edges: bool,
}

impl Default for App {
    fn default() -> Self {
        Self { n: TERM_N, time: 0.0, paused: false, gain: 1.0, nodes: DRAW_NODES, edges: DRAW_EDGES }
    }
}

/// Rotate in the (x,z) and (y,w) planes, then fold the extra axes back in.
fn project4(p: [i32; 4], a: f32, b: f32) -> [f32; 2] {
    let (x, y, z, w) = (p[0] as f32, p[1] as f32, p[2] as f32, p[3] as f32);
    let (ca, sa) = (a.cos(), a.sin());
    let (cb, sb) = (b.cos(), b.sin());
    let x1 = x * ca - z * sa;
    let z1 = x * sa + z * ca;
    let y1 = y * cb - w * sb;
    let w1 = y * sb + w * cb;
    [x1 + z1 * 0.5, y1 + w1 * 0.5]
}

fn build_scene(app: &App) -> (Vec<Vertex>, Vec<Vertex>) {
    let m1 = (app.n - 1).max(0);
    let m2 = (app.n - 2).max(0);
    let outer = seq::shell(m1);
    let inner = seq::shell(m2);

    let a = ROT_A + if app.paused { 0.0 } else { app.time * SPEED };
    let b = ROT_B + if app.paused { 0.0 } else { app.time * SPEED * 0.618 };
    let k = ZOOM / (m1.max(1) as f32 * 1.6);

    let po: Vec<[f32; 2]> = outer.iter().map(|p| project4(*p, a, b)).collect();
    let pi: Vec<[f32; 2]> = inner.iter().map(|p| project4(*p, a, b)).collect();

    let mut points = Vec::new();
    if app.nodes {
        for p in po.iter().chain(pi.iter()) {
            points.push(Vertex::new([p[0] * k, p[1] * k], 1.0));
        }
    }

    // unit-distance edges between the two shells – the "+" of the recurrence
    let mut lines = Vec::new();
    if app.edges {
        use std::collections::HashMap;
        let mut idx: HashMap<[i32; 4], usize> = HashMap::with_capacity(inner.len());
        for (i, p) in inner.iter().enumerate() {
            idx.insert(*p, i);
        }
        for (i, p) in outer.iter().enumerate() {
            for axis in 0..4 {
                for d in [-1, 1] {
                    let mut q = *p;
                    q[axis] += d;
                    if let Some(j) = idx.get(&q) {
                        lines.push(Vertex::new([po[i][0] * k, po[i][1] * k], 0.4));
                        lines.push(Vertex::new([pi[*j][0] * k, pi[*j][1] * k], 0.4));
                    }
                }
            }
        }
    }

    (points, lines)
}

/// Box-average the R8 frame down onto the character grid, then pick glyphs.
fn to_glyphs(buf: &[u8], w: u32, h: u32, cols: u16, rows: u16, gain: f32) -> Vec<Vec<(char, u8)>> {
    let mut out = vec![vec![(' ', 0u8); cols as usize]; rows as usize];
    let cw = (w / cols.max(1) as u32).max(1);
    let chh = (h / rows.max(1) as u32).max(1);

    for r in 0..rows as u32 {
        for c in 0..cols as u32 {
            let mut acc = 0u32;
            for y in r * chh..((r + 1) * chh).min(h) {
                for x in c * cw..((c + 1) * cw).min(w) {
                    acc += buf[(y * w + x) as usize] as u32;
                }
            }
            let avg = acc as f32 / (cw * chh) as f32 / 255.0;
            let v = (avg * gain * 6.0).powf(0.55).clamp(0.0, 1.0);
            let gi = ((v * (RAMP.len() - 1) as f32).round() as usize).min(RAMP.len() - 1);
            out[r as usize][c as usize] = (RAMP[gi], (v * 255.0) as u8);
        }
    }
    out
}

fn main() -> Result<()> {
    let mut renderer = gpu::Renderer::new(1024, 1024)?;
    let banner = format!(" wgpu – {} – {} ", renderer.backend, renderer.adapter_name);
    let mut app = App::default();

    enable_raw_mode()?;
    execute!(stdout(), EnterAlternateScreen)?;
    let mut term = Terminal::new(CrosstermBackend::new(stdout()))?;

    let start = Instant::now();

    loop {
        app.time = start.elapsed().as_secs_f32();
        let (points, lines) = build_scene(&app);
        let frame = renderer.draw(&points, &lines, 1.5)?;

        term.draw(|f| {
            let area = f.area();
            let chunks = Layout::vertical([
                Constraint::Length(3),
                Constraint::Min(1),
                Constraint::Length(1),
            ])
            .split(area);

            let a = seq::a287324(app.n as i64);
            let head = Paragraph::new(Line::from(vec![
                Span::styled(" A287324 ", Style::new().fg(Color::Black).bg(Color::LightGreen)),
                Span::raw("  a(n) = A008412(n-1) + A008412(n-2)   "),
                Span::styled(
                    format!("a({}) = {}", app.n, a),
                    Style::new().fg(Color::LightYellow).bold(),
                ),
            ]))
            .block(Block::default().borders(Borders::ALL).title(banner.clone()));
            f.render_widget(head, chunks[0]);

            let view = chunks[1];
            let inner = view.inner(Margin::new(1, 1));
            let grid = to_glyphs(
                &frame,
                renderer.width,
                renderer.height,
                inner.width,
                inner.height,
                app.gain,
            );

            let text: Vec<Line> = grid
                .iter()
                .map(|row| {
                    Line::from(
                        row.iter()
                            .map(|(ch, v)| {
                                Span::styled(
                                    ch.to_string(),
                                    Style::new().fg(Color::Rgb(*v / 3, *v, (*v / 2).max(24))),
                                )
                            })
                            .collect::<Vec<_>>(),
                    )
                })
                .collect();

            f.render_widget(
                Paragraph::new(text).block(Block::default().borders(Borders::ALL).title(format!(
                    " Z^4 shells |x|1={} + |x|1={} – {} pts – {} lines ",
                    (app.n - 1).max(0),
                    (app.n - 2).max(0),
                    points.len(),
                    lines.len() / 2
                ))),
                view,
            );

            f.render_widget(
                Paragraph::new(" h/l term – j/k gain – o nodes – p edges – space pause – q quit ")
                    .style(Style::new().fg(Color::DarkGray)),
                chunks[2],
            );
        })?;

        if event::poll(Duration::from_millis(16))? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    match key.code {
                        KeyCode::Char('q') | KeyCode::Esc => break,
                        KeyCode::Char('l') => app.n = (app.n + 1).min(14),
                        KeyCode::Char('h') => app.n = (app.n - 1).max(2),
                        KeyCode::Char('k') => app.gain = (app.gain * 1.15).min(12.0),
                        KeyCode::Char('j') => app.gain = (app.gain / 1.15).max(0.1),
                        KeyCode::Char('o') => app.nodes = !app.nodes,
                        KeyCode::Char('p') => app.edges = !app.edges,
                        KeyCode::Char(' ') => app.paused = !app.paused,
                        _ => {}
                    }
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(stdout(), LeaveAlternateScreen)?;
    Ok(())
}
`;
}

export function wgpuProject(s: Settings, seqRs: string): SourceFile[] {
  return [
    { path: 'Cargo.toml', lang: 'toml', code: CARGO },
    { path: 'src/main.rs', lang: 'rust', code: mainRs(s) },
    { path: 'src/gpu.rs', lang: 'rust', code: GPU_RS },
    { path: 'src/scene.wgsl', lang: 'glsl', code: WGSL },
    { path: 'src/seq.rs', lang: 'rust', code: seqRs },
    { path: 'README.md', lang: 'md', code: README },
  ];
}
