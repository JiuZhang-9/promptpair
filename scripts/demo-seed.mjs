/**
 * 生成一个演示库（.smoke/lib），用于自动化截图与视觉验收。
 * 不碰用户真实的「文档/PromptPair」。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'

const ROOT = path.resolve('.smoke/lib')
const MEDIA = path.join(ROOT, 'media')

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const tb = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0)
  return Buffer.concat([len, tb, data, crc])
}
function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function art(w, h, c1, c2, seed) {
  const buf = Buffer.alloc(w * h * 4)
  let s = seed
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  const cx = w * (0.3 + rnd() * 0.4)
  const cy = h * (0.3 + rnd() * 0.4)
  const rad = w * (0.22 + rnd() * 0.16)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (x / w) * 0.6 + (y / h) * 0.4
      let r = c1[0] + (c2[0] - c1[0]) * t
      let g = c1[1] + (c2[1] - c1[1]) * t
      let b = c1[2] + (c2[2] - c1[2]) * t

      const d = Math.hypot(x - cx, y - cy)
      const glow = Math.max(0, 1 - d / (rad * 2.4))
      r = Math.min(255, r + glow * 70)
      g = Math.min(255, g + glow * 60)
      b = Math.min(255, b + glow * 80)

      if (Math.abs(d - rad) < 1.6) {
        r = 255
        g = 255
        b = 255
      }
      // 底部暗角
      const vig = 1 - Math.pow(Math.hypot(x - w / 2, y - h / 2) / (w * 0.75), 2.4) * 0.5
      r *= vig
      g *= vig
      b *= vig

      const o = (y * w + x) * 4
      buf[o] = Math.round(r)
      buf[o + 1] = Math.round(g)
      buf[o + 2] = Math.round(b)
      buf[o + 3] = 255
    }
  }
  return buf
}

const PALETTES = [
  [[26, 20, 48], [120, 70, 190]],
  [[10, 32, 44], [40, 180, 176]],
  [[48, 22, 26], [220, 110, 90]],
  [[16, 24, 40], [70, 120, 220]],
  [[34, 30, 18], [200, 170, 80]],
  [[22, 30, 24], [90, 200, 130]],
  [[36, 20, 36], [200, 90, 170]],
  [[18, 18, 22], [150, 150, 165]]
]

const DEMO = [
  {
    title: '赛博朋克雨夜街头',
    positive:
      'cyberpunk street at night, neon signs reflecting on wet asphalt, rain, volumetric fog, cinematic lighting, 85mm lens, shallow depth of field, highly detailed, 8k',
    negative: 'blurry, low quality, watermark, text, deformed hands',
    tags: ['赛博朋克', '夜景', '电影感'],
    coll: '视觉实验',
    params: { model: '即梦 3.0', width: 1536, height: 1024, seed: '884213', steps: 32, cfg: 7.5, sampler: 'DPM++ 2M' },
    platform: '即梦',
    assets: 3
  },
  {
    title: '水墨山川 · 留白',
    positive:
      'traditional chinese ink painting, misty mountains, vast negative space, minimal brush strokes, rice paper texture, subtle wash, monochrome with a single vermilion seal',
    negative: '',
    tags: ['水墨', '东方', '留白'],
    coll: '客户A',
    params: { model: 'MJ v6.1', width: 1024, height: 1536, seed: '2718281', steps: 30, cfg: 6 },
    platform: 'Midjourney',
    assets: 2
  },
  {
    title: '产品图 · 香水瓶悬浮',
    positive:
      'luxury perfume bottle floating mid air, soft studio lighting, gradient background, subtle caustics, water droplets, ultra clean, commercial product photography',
    negative: 'cluttered, harsh shadows',
    tags: ['产品图', '棚拍', '极简'],
    coll: '客户A',
    params: { model: 'SDXL', width: 1024, height: 1024, seed: '55901', steps: 28, cfg: 7, sampler: 'Euler a' },
    platform: 'ComfyUI',
    assets: 4
  },
  {
    title: '苔藓森林中的机械鹿',
    positive:
      'a mechanical deer covered in moss standing in an ancient forest, sun rays through canopy, bioluminescent details, macro texture on metal, fantasy realism',
    negative: 'cartoon, flat colors',
    tags: ['奇幻', '生物设计', '自然'],
    coll: '',
    params: { model: '即梦 3.0', width: 1024, height: 1024, seed: '144779', steps: 36, cfg: 8 },
    platform: '即梦',
    assets: 1
  },
  {
    title: '复古胶片人像',
    positive:
      'portrait of a young woman, 35mm film grain, kodak portra 400, golden hour backlight, soft bokeh, natural skin texture, candid expression',
    negative: 'plastic skin, over-sharpened',
    tags: ['人像', '胶片', '暖调'],
    coll: '视觉实验',
    params: { model: 'MJ v6.1', width: 1024, height: 1536, seed: '90210', steps: 30, cfg: 5.5 },
    platform: 'Midjourney',
    assets: 2
  },
  {
    title: '等距小岛 · 低多边形',
    positive:
      'isometric tiny floating island, low poly, pastel palette, soft ambient occlusion, blender render, clean geometry, miniature diorama',
    negative: '',
    tags: ['等距', '低多边形', '3D'],
    coll: '',
    params: { model: 'SDXL', width: 1024, height: 1024, seed: '30012', steps: 24, cfg: 6.5 },
    platform: 'Stable Diffusion',
    assets: 3
  },
  {
    title: '文字海报 · 粗野主义',
    positive:
      'brutalist typographic poster, heavy black type on off-white paper, asymmetric grid, exposed structure, swiss design influence, high contrast',
    negative: 'gradient, glossy, 3d text',
    tags: ['海报', '平面', '排版'],
    coll: '',
    params: { model: '即梦 3.0', width: 1024, height: 1536 },
    platform: '即梦',
    assets: 1
  },
  {
    title: '深海发光水母群',
    positive:
      'swarm of bioluminescent jellyfish in deep ocean, volumetric god rays, teal and violet palette, particles suspended in water, ultra wide shot',
    negative: 'noise, grain',
    tags: ['自然', '深海', '光效'],
    coll: '视觉实验',
    params: { model: '可灵 1.6', width: 1920, height: 1080, seed: '77123' },
    platform: '可灵',
    assets: 2
  }
]

/* 清理重来 */
fs.rmSync(ROOT, { recursive: true, force: true })
fs.mkdirSync(MEDIA, { recursive: true })

const now = Date.now()
const tagGroups = [
  { id: 'g1', name: '风格', color: '#7c9cff', order: 0 },
  { id: 'g2', name: '题材', color: '#4fd1a5', order: 1 },
  { id: 'g3', name: '镜头', color: '#f5a524', order: 2 },
  { id: 'g4', name: '画质', color: '#c77dff', order: 3 },
  { id: 'g5', name: '用途', color: '#ff7a8a', order: 4 }
]
const TAG_GROUP = {
  赛博朋克: 'g1', 水墨: 'g1', 胶片: 'g1', 极简: 'g1', 低多边形: 'g1', 粗野主义: 'g1',
  夜景: 'g2', 东方: 'g2', 奇幻: 'g2', 自然: 'g2', 深海: 'g2', 生物设计: 'g2',
  电影感: 'g3', 留白: 'g3', 棚拍: 'g3', 等距: 'g3', 人像: 'g3', 暖调: 'g3',
  光效: 'g4', '3D': 'g4', 排版: 'g4',
  产品图: 'g5', 海报: 'g5', 平面: 'g5'
}

const tags = Object.keys(TAG_GROUP).map((name, i) => ({
  id: 't' + i,
  name,
  groupId: TAG_GROUP[name]
}))
const tagIdByName = new Map(tags.map((t) => [t.name, t.id]))

const collections = [
  { id: 'c1', name: '视觉实验', color: '#7c9cff', createdAt: new Date(now).toISOString() },
  { id: 'c2', name: '客户A', color: '#4fd1a5', createdAt: new Date(now).toISOString() }
]

const assets = []
const entries = []
let n = 0

for (const d of DEMO) {
  const pal = PALETTES[n % PALETTES.length]
  const assetIds = []
  for (let k = 0; k < d.assets; k++) {
    const w = 768
    const h = d.params.width && d.params.height && d.params.height > d.params.width ? 1024 : 768
    const buf = art(w, h, pal[0], pal[1], 1234 + n * 97 + k * 13)
    const png = encodePng(w, h, buf)
    const sha = crypto.createHash('sha256').update(png).digest('hex')
    const id = sha.slice(0, 24)
    const rel = `media/${sha.slice(0, 2)}/${sha}.png`
    const abs = path.join(ROOT, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, png)
    if (!assets.some((a) => a.id === id)) {
      assets.push({
        id,
        sha256: sha,
        kind: 'image',
        ext: '.png',
        bytes: png.length,
        width: w,
        height: h,
        relPath: rel,
        addedAt: new Date(now - n * 3600_000).toISOString()
      })
    }
    assetIds.push(id)
  }

  entries.push({
    id: 'e' + n,
    title: d.title,
    positive: d.positive,
    negative: d.negative,
    note: n % 3 === 0 ? '这组里第 3 张的光比最接近参考。' : '',
    rating: (n % 5) + 1,
    favorite: n % 4 === 0,
    collectionIds: d.coll ? [collections.find((c) => c.name === d.coll).id] : [],
    tagIds: d.tags.map((t) => tagIdByName.get(t)).filter(Boolean),
    assetIds,
    params: d.params,
    source: { platform: d.platform, originalName: `img_${n}.png` },
    createdAt: new Date(now - n * 3600_000).toISOString(),
    updatedAt: new Date(now - n * 3600_000).toISOString()
  })
  n++
}

const lib = {
  schemaVersion: 1,
  id: 'demo',
  name: '我的素材库',
  createdAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
  entries,
  assets,
  tagGroups,
  tags,
  collections
}

fs.writeFileSync(path.join(ROOT, 'library.json'), JSON.stringify(lib, null, 2))
fs.mkdirSync(path.join(ROOT, 'thumbs'), { recursive: true })

// 让应用指向演示库
const UD = path.resolve('.smoke/userdata')
fs.mkdirSync(UD, { recursive: true })
fs.writeFileSync(
  path.join(UD, 'config.json'),
  JSON.stringify(
    {
      libraryPath: ROOT,
      theme: 'dark',
      thumbSize: 220,
      duplicateThreshold: 6,
      autoTagFromFolder: true,
      autoCreateTags: true,
      autoReadSidecar: true,
      autoGroupByStem: true,
      minimizeToTray: false
    },
    null,
    2
  )
)

console.log(`✓ 演示库已生成：${ROOT}`)
console.log(`  记录 ${entries.length} 条 / 媒体 ${assets.length} 个`)
