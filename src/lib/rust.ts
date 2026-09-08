import type { Settings } from './geometry';

export type SourceFile = { path: string; lang: string; code: string };

const CARGO = `[package]
name = "a287324-tui"
version = "0.1.0"
edition = "2021"
description = "Terminal visualiser for OEIS A287324 rendered with Vulkan via ash"

[dependencies]
ash = { version = "0.38", features = ["linked"] }
crossterm = "0.28"
ratatui = "0.29"
anyhow = "1"

[profile.release]
opt-level = 3
lto = true
`;

export const SEQ_RS = `//! OEIS A287324 – a(n) = A008412(n-1) + A008412(n-2), a(0)=0, a(1)=1.

/// A008412: coordination sequence of the 4-D cubic lattice Z^4.
/// a(0) = 1, a(m) = 8*m*(m^2 + 2)/3 for m >= 1.
pub fn a008412(m: i64) -> i64 {
    if m < 0 {
        0
    } else if m == 0 {
        1
    } else {
        8 * m * (m * m + 2) / 3
    }
}

/// A287324.
pub fn a287324(n: i64) -> i64 {
    match n {
        n if n <= 0 => 0,
        1 => 1,
        n => a008412(n - 1) + a008412(n - 2),
    }
}

/// Closed form, valid for n >= 3.
pub fn closed_form(n: i64) -> i64 {
    (16 * n * n * n - 72 * n * n + 152 * n - 120) / 3
}

/// Every lattice point of Z^4 with |x|_1 == m. Length == a008412(m).
pub fn shell(m: i32) -> Vec<[i32; 4]> {
    if m <= 0 {
        return vec![[0, 0, 0, 0]];
    }
    let mut pts = Vec::with_capacity(a008412(m as i64) as usize);
    for x in -m..=m {
        let rx = m - x.abs();
        for y in -rx..=rx {
            let ry = rx - y.abs();
            for z in -ry..=ry {
                let w = ry - z.abs();
                if w == 0 {
                    pts.push([x, y, z, 0]);
                } else {
                    pts.push([x, y, z, w]);
                    pts.push([x, y, z, -w]);
                }
            }
        }
    }
    pts
}

/// The iterated-summation cascade: next[0] = 1, next[i] = prev[i] + prev[i-1].
pub fn cascade(rows: usize, cols: usize) -> Vec<Vec<i64>> {
    let mut cur: Vec<i64> = (1..=cols as i64)
        .map(|i| i * (i + 1) * (i + 2) / 6)
        .collect();
    let mut out = Vec::with_capacity(rows);
    for _ in 0..rows {
        out.push(cur.clone());
        let next: Vec<i64> = cur
            .iter()
            .enumerate()
            .map(|(i, v)| if i == 0 { 1 } else { v + cur[i - 1] })
            .collect();
        cur = next;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_oeis_b_file() {
        let want = [0, 1, 9, 40, 120, 280, 552, 968, 1560, 2360, 3400, 4712];
        for (n, w) in want.iter().enumerate() {
            assert_eq!(a287324(n as i64), *w);
        }
    }

    #[test]
    fn shell_size_is_a008412() {
        for m in 0..7 {
            assert_eq!(shell(m).len() as i64, a008412(m as i64));
        }
    }
}
`;

const VK_RS = `//! Offscreen Vulkan renderer built directly on \`ash\`.
//! The scene is rasterised into a host-visible R8_UNORM image; the terminal
//! front-end then downsamples that luminance buffer into a character grid.
//! No swapchain, no window, no surface extension — the GPU output is text.

use anyhow::{anyhow, Result};
use ash::{util::read_spv, vk, Device, Entry, Instance};
use std::{ffi::CString, io::Cursor, mem::size_of};

pub const FORMAT: vk::Format = vk::Format::R8_UNORM;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Vertex {
    pub pos: [f32; 2],
    pub intensity: f32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Push {
    pub aspect: f32,
    pub point_size: f32,
}

pub struct Renderer {
    _entry: Entry,
    instance: Instance,
    pub device: Device,
    phys: vk::PhysicalDevice,
    queue: vk::Queue,
    queue_family: u32,
    pool: vk::CommandPool,
    pub width: u32,
    pub height: u32,
    image: vk::Image,
    image_mem: vk::DeviceMemory,
    view: vk::ImageView,
    readback: vk::Buffer,
    readback_mem: vk::DeviceMemory,
    render_pass: vk::RenderPass,
    framebuffer: vk::Framebuffer,
    layout: vk::PipelineLayout,
    point_pipe: vk::Pipeline,
    line_pipe: vk::Pipeline,
    vbuf: vk::Buffer,
    vmem: vk::DeviceMemory,
    vcap: usize,
}

impl Renderer {
    pub fn new(width: u32, height: u32) -> Result<Self> {
        let entry = unsafe { Entry::load()? };
        let app_name = CString::new("a287324-tui")?;
        let app_info = vk::ApplicationInfo::default()
            .application_name(&app_name)
            .api_version(vk::make_api_version(0, 1, 1, 0));
        let create = vk::InstanceCreateInfo::default().application_info(&app_info);
        let instance = unsafe { entry.create_instance(&create, None)? };

        let phys = unsafe { instance.enumerate_physical_devices()? }
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("no vulkan device"))?;

        let queue_family = unsafe { instance.get_physical_device_queue_family_properties(phys) }
            .iter()
            .position(|p| p.queue_flags.contains(vk::QueueFlags::GRAPHICS))
            .ok_or_else(|| anyhow!("no graphics queue"))? as u32;

        let prio = [1.0f32];
        let qinfo = [vk::DeviceQueueCreateInfo::default()
            .queue_family_index(queue_family)
            .queue_priorities(&prio)];
        let dinfo = vk::DeviceCreateInfo::default().queue_create_infos(&qinfo);
        let device = unsafe { instance.create_device(phys, &dinfo, None)? };
        let queue = unsafe { device.get_device_queue(queue_family, 0) };

        let pool = unsafe {
            device.create_command_pool(
                &vk::CommandPoolCreateInfo::default()
                    .queue_family_index(queue_family)
                    .flags(vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER),
                None,
            )?
        };

        let mut r = Self {
            _entry: entry,
            instance,
            device,
            phys,
            queue,
            queue_family,
            pool,
            width,
            height,
            image: vk::Image::null(),
            image_mem: vk::DeviceMemory::null(),
            view: vk::ImageView::null(),
            readback: vk::Buffer::null(),
            readback_mem: vk::DeviceMemory::null(),
            render_pass: vk::RenderPass::null(),
            framebuffer: vk::Framebuffer::null(),
            layout: vk::PipelineLayout::null(),
            point_pipe: vk::Pipeline::null(),
            line_pipe: vk::Pipeline::null(),
            vbuf: vk::Buffer::null(),
            vmem: vk::DeviceMemory::null(),
            vcap: 0,
        };

        r.create_target()?;
        r.create_pipelines()?;
        Ok(r)
    }

    fn mem_type(&self, bits: u32, want: vk::MemoryPropertyFlags) -> Result<u32> {
        let props = unsafe { self.instance.get_physical_device_memory_properties(self.phys) };
        (0..props.memory_type_count)
            .find(|i| {
                bits & (1 << i) != 0
                    && props.memory_types[*i as usize].property_flags.contains(want)
            })
            .ok_or_else(|| anyhow!("no suitable memory type"))
    }

    fn create_target(&mut self) -> Result<()> {
        let dev = &self.device;
        let info = vk::ImageCreateInfo::default()
            .image_type(vk::ImageType::TYPE_2D)
            .format(FORMAT)
            .extent(vk::Extent3D { width: self.width, height: self.height, depth: 1 })
            .mip_levels(1)
            .array_layers(1)
            .samples(vk::SampleCountFlags::TYPE_1)
            .tiling(vk::ImageTiling::OPTIMAL)
            .usage(vk::ImageUsageFlags::COLOR_ATTACHMENT | vk::ImageUsageFlags::TRANSFER_SRC)
            .initial_layout(vk::ImageLayout::UNDEFINED);

        self.image = unsafe { dev.create_image(&info, None)? };
        let req = unsafe { dev.get_image_memory_requirements(self.image) };
        let idx = self.mem_type(req.memory_type_bits, vk::MemoryPropertyFlags::DEVICE_LOCAL)?;
        self.image_mem = unsafe {
            dev.allocate_memory(
                &vk::MemoryAllocateInfo::default()
                    .allocation_size(req.size)
                    .memory_type_index(idx),
                None,
            )?
        };
        unsafe { dev.bind_image_memory(self.image, self.image_mem, 0)? };

        self.view = unsafe {
            dev.create_image_view(
                &vk::ImageViewCreateInfo::default()
                    .image(self.image)
                    .view_type(vk::ImageViewType::TYPE_2D)
                    .format(FORMAT)
                    .subresource_range(vk::ImageSubresourceRange {
                        aspect_mask: vk::ImageAspectFlags::COLOR,
                        base_mip_level: 0,
                        level_count: 1,
                        base_array_layer: 0,
                        layer_count: 1,
                    }),
                None,
            )?
        };

        // linear host-visible buffer we copy the frame into
        let size = (self.width * self.height) as vk::DeviceSize;
        self.readback = unsafe {
            dev.create_buffer(
                &vk::BufferCreateInfo::default()
                    .size(size)
                    .usage(vk::BufferUsageFlags::TRANSFER_DST)
                    .sharing_mode(vk::SharingMode::EXCLUSIVE),
                None,
            )?
        };
        let req = unsafe { dev.get_buffer_memory_requirements(self.readback) };
        let idx = self.mem_type(
            req.memory_type_bits,
            vk::MemoryPropertyFlags::HOST_VISIBLE | vk::MemoryPropertyFlags::HOST_COHERENT,
        )?;
        self.readback_mem = unsafe {
            dev.allocate_memory(
                &vk::MemoryAllocateInfo::default()
                    .allocation_size(req.size)
                    .memory_type_index(idx),
                None,
            )?
        };
        unsafe { dev.bind_buffer_memory(self.readback, self.readback_mem, 0)? };

        let attach = [vk::AttachmentDescription::default()
            .format(FORMAT)
            .samples(vk::SampleCountFlags::TYPE_1)
            .load_op(vk::AttachmentLoadOp::CLEAR)
            .store_op(vk::AttachmentStoreOp::STORE)
            .initial_layout(vk::ImageLayout::UNDEFINED)
            .final_layout(vk::ImageLayout::TRANSFER_SRC_OPTIMAL)];
        let refs = [vk::AttachmentReference::default()
            .attachment(0)
            .layout(vk::ImageLayout::COLOR_ATTACHMENT_OPTIMAL)];
        let sub = [vk::SubpassDescription::default()
            .pipeline_bind_point(vk::PipelineBindPoint::GRAPHICS)
            .color_attachments(&refs)];
        self.render_pass = unsafe {
            dev.create_render_pass(
                &vk::RenderPassCreateInfo::default().attachments(&attach).subpasses(&sub),
                None,
            )?
        };

        let views = [self.view];
        self.framebuffer = unsafe {
            dev.create_framebuffer(
                &vk::FramebufferCreateInfo::default()
                    .render_pass(self.render_pass)
                    .attachments(&views)
                    .width(self.width)
                    .height(self.height)
                    .layers(1),
                None,
            )?
        };

        Ok(())
    }

    fn create_pipelines(&mut self) -> Result<()> {
        let dev = &self.device;
        let vert = unsafe {
            dev.create_shader_module(
                &vk::ShaderModuleCreateInfo::default()
                    .code(&read_spv(&mut Cursor::new(&include_bytes!("../shaders/point.vert.spv")[..]))?),
                None,
            )?
        };
        let frag = unsafe {
            dev.create_shader_module(
                &vk::ShaderModuleCreateInfo::default()
                    .code(&read_spv(&mut Cursor::new(&include_bytes!("../shaders/point.frag.spv")[..]))?),
                None,
            )?
        };

        let push = [vk::PushConstantRange::default()
            .stage_flags(vk::ShaderStageFlags::VERTEX)
            .offset(0)
            .size(size_of::<Push>() as u32)];
        self.layout = unsafe {
            dev.create_pipeline_layout(
                &vk::PipelineLayoutCreateInfo::default().push_constant_ranges(&push),
                None,
            )?
        };

        let entry = CString::new("main")?;
        let stages = [
            vk::PipelineShaderStageCreateInfo::default()
                .stage(vk::ShaderStageFlags::VERTEX)
                .module(vert)
                .name(&entry),
            vk::PipelineShaderStageCreateInfo::default()
                .stage(vk::ShaderStageFlags::FRAGMENT)
                .module(frag)
                .name(&entry),
        ];

        let bindings = [vk::VertexInputBindingDescription::default()
            .binding(0)
            .stride(size_of::<Vertex>() as u32)
            .input_rate(vk::VertexInputRate::VERTEX)];
        let attrs = [
            vk::VertexInputAttributeDescription::default()
                .location(0)
                .binding(0)
                .format(vk::Format::R32G32_SFLOAT)
                .offset(0),
            vk::VertexInputAttributeDescription::default()
                .location(1)
                .binding(0)
                .format(vk::Format::R32_SFLOAT)
                .offset(8),
        ];
        let vinput = vk::PipelineVertexInputStateCreateInfo::default()
            .vertex_binding_descriptions(&bindings)
            .vertex_attribute_descriptions(&attrs);

        let viewports = [vk::Viewport {
            x: 0.0,
            y: 0.0,
            width: self.width as f32,
            height: self.height as f32,
            min_depth: 0.0,
            max_depth: 1.0,
        }];
        let scissors = [vk::Rect2D {
            offset: vk::Offset2D { x: 0, y: 0 },
            extent: vk::Extent2D { width: self.width, height: self.height },
        }];
        let vstate = vk::PipelineViewportStateCreateInfo::default()
            .viewports(&viewports)
            .scissors(&scissors);

        let raster = vk::PipelineRasterizationStateCreateInfo::default()
            .polygon_mode(vk::PolygonMode::FILL)
            .cull_mode(vk::CullModeFlags::NONE)
            .line_width(1.0);
        let msaa = vk::PipelineMultisampleStateCreateInfo::default()
            .rasterization_samples(vk::SampleCountFlags::TYPE_1);

        // additive blending: overlapping strokes accumulate into brighter cells
        let blend_attach = [vk::PipelineColorBlendAttachmentState::default()
            .color_write_mask(vk::ColorComponentFlags::R)
            .blend_enable(true)
            .src_color_blend_factor(vk::BlendFactor::ONE)
            .dst_color_blend_factor(vk::BlendFactor::ONE)
            .color_blend_op(vk::BlendOp::ADD)
            .src_alpha_blend_factor(vk::BlendFactor::ONE)
            .dst_alpha_blend_factor(vk::BlendFactor::ONE)
            .alpha_blend_op(vk::BlendOp::ADD)];
        let blend = vk::PipelineColorBlendStateCreateInfo::default().attachments(&blend_attach);

        let mut pipes = Vec::new();
        for topo in [vk::PrimitiveTopology::POINT_LIST, vk::PrimitiveTopology::LINE_LIST] {
            let asm = vk::PipelineInputAssemblyStateCreateInfo::default().topology(topo);
            let info = vk::GraphicsPipelineCreateInfo::default()
                .stages(&stages)
                .vertex_input_state(&vinput)
                .input_assembly_state(&asm)
                .viewport_state(&vstate)
                .rasterization_state(&raster)
                .multisample_state(&msaa)
                .color_blend_state(&blend)
                .layout(self.layout)
                .render_pass(self.render_pass)
                .subpass(0);
            let p = unsafe {
                dev.create_graphics_pipelines(vk::PipelineCache::null(), &[info], None)
                    .map_err(|(_, e)| e)?
            };
            pipes.push(p[0]);
        }
        self.point_pipe = pipes[0];
        self.line_pipe = pipes[1];

        unsafe {
            dev.destroy_shader_module(vert, None);
            dev.destroy_shader_module(frag, None);
        }
        Ok(())
    }

    fn ensure_vertex_capacity(&mut self, bytes: usize) -> Result<()> {
        if bytes <= self.vcap {
            return Ok(());
        }
        unsafe {
            if self.vbuf != vk::Buffer::null() {
                self.device.destroy_buffer(self.vbuf, None);
                self.device.free_memory(self.vmem, None);
            }
        }
        let cap = bytes.next_power_of_two().max(1 << 16);
        self.vbuf = unsafe {
            self.device.create_buffer(
                &vk::BufferCreateInfo::default()
                    .size(cap as vk::DeviceSize)
                    .usage(vk::BufferUsageFlags::VERTEX_BUFFER)
                    .sharing_mode(vk::SharingMode::EXCLUSIVE),
                None,
            )?
        };
        let req = unsafe { self.device.get_buffer_memory_requirements(self.vbuf) };
        let idx = self.mem_type(
            req.memory_type_bits,
            vk::MemoryPropertyFlags::HOST_VISIBLE | vk::MemoryPropertyFlags::HOST_COHERENT,
        )?;
        self.vmem = unsafe {
            self.device.allocate_memory(
                &vk::MemoryAllocateInfo::default()
                    .allocation_size(req.size)
                    .memory_type_index(idx),
                None,
            )?
        };
        unsafe { self.device.bind_buffer_memory(self.vbuf, self.vmem, 0)? };
        self.vcap = cap;
        Ok(())
    }

    /// Draw points + lines and return the R8 luminance buffer (row major).
    pub fn draw(&mut self, points: &[Vertex], lines: &[Vertex], point_size: f32) -> Result<Vec<u8>> {
        let all: Vec<Vertex> = points.iter().chain(lines.iter()).copied().collect();
        let bytes = all.len() * size_of::<Vertex>();
        self.ensure_vertex_capacity(bytes.max(size_of::<Vertex>()))?;
        unsafe {
            let ptr = self.device.map_memory(
                self.vmem,
                0,
                bytes as vk::DeviceSize,
                vk::MemoryMapFlags::empty(),
            )? as *mut Vertex;
            std::ptr::copy_nonoverlapping(all.as_ptr(), ptr, all.len());
            self.device.unmap_memory(self.vmem);
        }

        let cmd = unsafe {
            self.device.allocate_command_buffers(
                &vk::CommandBufferAllocateInfo::default()
                    .command_pool(self.pool)
                    .level(vk::CommandBufferLevel::PRIMARY)
                    .command_buffer_count(1),
            )?[0]
        };

        let clear = [vk::ClearValue { color: vk::ClearColorValue { float32: [0.0; 4] } }];
        let push = Push { aspect: self.width as f32 / self.height as f32, point_size };

        unsafe {
            self.device.begin_command_buffer(
                cmd,
                &vk::CommandBufferBeginInfo::default()
                    .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT),
            )?;
            self.device.cmd_begin_render_pass(
                cmd,
                &vk::RenderPassBeginInfo::default()
                    .render_pass(self.render_pass)
                    .framebuffer(self.framebuffer)
                    .render_area(vk::Rect2D {
                        offset: vk::Offset2D { x: 0, y: 0 },
                        extent: vk::Extent2D { width: self.width, height: self.height },
                    })
                    .clear_values(&clear),
                vk::SubpassContents::INLINE,
            );

            self.device.cmd_push_constants(
                cmd,
                self.layout,
                vk::ShaderStageFlags::VERTEX,
                0,
                std::slice::from_raw_parts(
                    &push as *const Push as *const u8,
                    size_of::<Push>(),
                ),
            );

            self.device.cmd_bind_vertex_buffers(cmd, 0, &[self.vbuf], &[0]);
            if !lines.is_empty() {
                self.device.cmd_bind_pipeline(cmd, vk::PipelineBindPoint::GRAPHICS, self.line_pipe);
                self.device.cmd_draw(cmd, lines.len() as u32, 1, points.len() as u32, 0);
            }
            if !points.is_empty() {
                self.device.cmd_bind_pipeline(cmd, vk::PipelineBindPoint::GRAPHICS, self.point_pipe);
                self.device.cmd_draw(cmd, points.len() as u32, 1, 0, 0);
            }

            self.device.cmd_end_render_pass(cmd);

            self.device.cmd_copy_image_to_buffer(
                cmd,
                self.image,
                vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
                self.readback,
                &[vk::BufferImageCopy::default()
                    .image_subresource(vk::ImageSubresourceLayers {
                        aspect_mask: vk::ImageAspectFlags::COLOR,
                        mip_level: 0,
                        base_array_layer: 0,
                        layer_count: 1,
                    })
                    .image_extent(vk::Extent3D {
                        width: self.width,
                        height: self.height,
                        depth: 1,
                    })],
            );

            self.device.end_command_buffer(cmd)?;

            let fence = self.device.create_fence(&vk::FenceCreateInfo::default(), None)?;
            let cmds = [cmd];
            let submit = [vk::SubmitInfo::default().command_buffers(&cmds)];
            self.device.queue_submit(self.queue, &submit, fence)?;
            self.device.wait_for_fences(&[fence], true, u64::MAX)?;
            self.device.destroy_fence(fence, None);
            self.device.free_command_buffers(self.pool, &cmds);

            let n = (self.width * self.height) as usize;
            let ptr = self.device.map_memory(
                self.readback_mem,
                0,
                n as vk::DeviceSize,
                vk::MemoryMapFlags::empty(),
            )? as *const u8;
            let out = std::slice::from_raw_parts(ptr, n).to_vec();
            self.device.unmap_memory(self.readback_mem);
            Ok(out)
        }
    }

    pub fn queue_family(&self) -> u32 {
        self.queue_family
    }
}

impl Drop for Renderer {
    fn drop(&mut self) {
        unsafe {
            let _ = self.device.device_wait_idle();
            if self.vbuf != vk::Buffer::null() {
                self.device.destroy_buffer(self.vbuf, None);
                self.device.free_memory(self.vmem, None);
            }
            self.device.destroy_pipeline(self.point_pipe, None);
            self.device.destroy_pipeline(self.line_pipe, None);
            self.device.destroy_pipeline_layout(self.layout, None);
            self.device.destroy_framebuffer(self.framebuffer, None);
            self.device.destroy_render_pass(self.render_pass, None);
            self.device.destroy_buffer(self.readback, None);
            self.device.free_memory(self.readback_mem, None);
            self.device.destroy_image_view(self.view, None);
            self.device.destroy_image(self.image, None);
            self.device.free_memory(self.image_mem, None);
            self.device.destroy_command_pool(self.pool, None);
            self.device.destroy_device(None);
            self.instance.destroy_instance(None);
        }
    }
}
`;

const VERT = `#version 450
// point.vert – places one lattice/ring vertex in clip space.

layout(location = 0) in vec2 in_pos;      // already in [-1, 1] scene space
layout(location = 1) in float in_intensity;

layout(push_constant) uniform Push {
    float aspect;
    float point_size;
} pc;

layout(location = 0) out float v_intensity;

void main() {
    vec2 p = in_pos;
    p.x /= pc.aspect;
    gl_Position = vec4(p, 0.0, 1.0);
    gl_PointSize = pc.point_size;
    v_intensity = in_intensity;
}
`;

const FRAG = `#version 450
// point.frag – single channel luminance; the terminal maps it to glyphs.

layout(location = 0) in float v_intensity;
layout(location = 0) out float out_luma;

void main() {
    out_luma = v_intensity;
}
`;

const BUILD_RS = `//! Compiles the GLSL sources to SPIR-V with glslangValidator or glslc.

use std::{env, path::Path, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=shaders");
    let dir = Path::new("shaders");
    for name in ["point.vert", "point.frag"] {
        let src = dir.join(name);
        let dst = dir.join(format!("{}.spv", name));
        let compiler = env::var("GLSLC").unwrap_or_else(|_| "glslc".into());
        let status = Command::new(&compiler)
            .arg(&src)
            .arg("-o")
            .arg(&dst)
            .status()
            .unwrap_or_else(|e| panic!("could not run {compiler}: {e}"));
        assert!(status.success(), "shader compilation failed for {name}");
    }
}
`;

const README = `# a287324-tui

A terminal visualiser for **OEIS A287324** – \`a(n) = A008412(n-1) + A008412(n-2)\`, \`a(0)=0\`, \`a(1)=1\` –
where the actual rasterisation is done by **Vulkan** through the [\`ash\`](https://crates.io/crates/ash) wrapper.

## How it works

1. \`seq.rs\` enumerates the two coordination shells of the 4-D cubic lattice
   \`Z^4\` whose sizes are \`A008412(n-1)\` and \`A008412(n-2)\`. Their union has
   exactly \`a(n)\` points – the recurrence made geometric.
2. Those points are projected 4D -> 2D through two independent rotation planes
   (xz and yw) and uploaded as a host-visible vertex buffer.
3. \`vk.rs\` builds an **offscreen** Vulkan pipeline: no swapchain, no surface,
   no window. A single \`R8_UNORM\` colour attachment is rendered with additive
   blending so overlapping strokes accumulate luminance.
4. The image is copied to a host-coherent buffer, downsampled to the terminal's
   character grid, and each cell is mapped through a glyph ramp
   (\` ░▒▓█\`) and a 256-colour phosphor palette by \`ratatui\` + \`crossterm\`.

The GPU renders. The terminal displays. No pixels are ever shown.

## Run

\`\`\`sh
cargo run --release
\`\`\`

Requires a Vulkan 1.1 loader/ICD and \`glslc\` (or set \`GLSLC=glslangValidator\`) on \`PATH\` for the build script.

## Keys

| key            | action                          |
|----------------|---------------------------------|
| \`h\` / \`l\`      | previous / next term \`n\`        |
| \`j\` / \`k\`      | glyph ramp density              |
| \`[\` / \`]\`      | rotation speed                  |
| \`p\`            | toggle polygon (edge) pass      |
| \`o\`            | toggle node (point) pass        |
| \`space\`        | pause auto-rotation             |
| \`q\` / \`Ctrl-C\` | quit                            |
`;

function fmt(n: number, d = 3) {
  return Number.isInteger(n) ? `${n}.0` : n.toFixed(d);
}

function mainRs(s: Settings): string {
  return `//! a287324-tui – OEIS A287324 rendered by Vulkan (ash), displayed as text.

mod seq;
mod vk;

use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph},
};
use std::{
    io::stdout,
    time::{Duration, Instant},
};
use vk::Vertex;

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
        Self {
            n: TERM_N,
            time: 0.0,
            paused: false,
            gain: 1.0,
            nodes: DRAW_NODES,
            edges: DRAW_EDGES,
        }
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
            points.push(Vertex { pos: [p[0] * k, p[1] * k], intensity: 1.0 });
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
                        lines.push(Vertex { pos: [po[i][0] * k, po[i][1] * k], intensity: 0.4 });
                        lines.push(Vertex { pos: [pi[*j][0] * k, pi[*j][1] * k], intensity: 0.4 });
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
    let mut renderer = vk::Renderer::new(1024, 1024)?;
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
            .block(Block::default().borders(Borders::ALL).title(" vulkan – ash – offscreen "));
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
                Paragraph::new(
                    " h/l term – j/k gain – o nodes – p edges – space pause – q quit ",
                )
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

export function rustProject(s: Settings): SourceFile[] {
  return [
    { path: 'Cargo.toml', lang: 'toml', code: CARGO },
    { path: 'build.rs', lang: 'rust', code: BUILD_RS },
    { path: 'src/main.rs', lang: 'rust', code: mainRs(s) },
    { path: 'src/vk.rs', lang: 'rust', code: VK_RS },
    { path: 'src/seq.rs', lang: 'rust', code: SEQ_RS },
    { path: 'shaders/point.vert', lang: 'glsl', code: VERT },
    { path: 'shaders/point.frag', lang: 'glsl', code: FRAG },
    { path: 'README.md', lang: 'md', code: README },
  ];
}
