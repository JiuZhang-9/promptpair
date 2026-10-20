/**
 * 生成 build/icon.ico（多尺寸，PNG 编码的 ICO 条目，Windows Vista+ 支持）
 * 纯 Node 实现，零图形依赖：手写 PNG 编码 + ICO 容器。
 * 图形语义：一枚描边的方框（提示词）与一枚实心方框（产物）交叠 = "配对"。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const SS = 3 // 超采样倍数

/* ── PNG 编码 ── */
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
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ── 绘制 ── */

function mix(a, b, t) {
  return a + (b - a) * t
}

function roundedRectSdf(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r)
  const dy = Math.abs(py - cy) - (hh - r)
  const ax = Math.max(dx, 0)
  const ay = Math.max(dy, 0)
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0) - r
}

/** 在 size×size 上按超采样渲染，返回 RGBA Buffer */
function render(size) {
  const S = size * SS
  const acc = new Float32Array(size * size * 4)

  const C1 = [0x6c, 0x8c, 0xff]
  const C2 = [0x9d, 0x7c, 0xff]

  const bgHalf = S / 2
  const bgR = S * 0.225

  // 描边方框（提示词）
  const aCx = S * 0.375
  const aCy = S * 0.375
  const aHalf = S * 0.245
  const aR = S * 0.075
  const aStroke = S * 0.062

  // 实心方框（产物）
  const bCx = S * 0.635
  const bCy = S * 0.635
  const bHalf = S * 0.235
  const bR = S * 0.075

  const feather = S * 0.006

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5
      const py = y + 0.5

      // 背景：对角渐变 + 圆角矩形遮罩
      const g = (px / S + py / S) / 2
      let r = mix(C1[0], C2[0], g)
      let gg = mix(C1[1], C2[1], g)
      let b = mix(C1[2], C2[2], g)
      let a = 1

      const dBg = roundedRectSdf(px, py, bgHalf, bgHalf, bgHalf - S * 0.02, bgHalf - S * 0.02, bgR)
      let bgAlpha = Math.min(1, Math.max(0, 0.5 - dBg / feather))
      // 顶部高光
      r = Math.min(255, r + (1 - py / S) * 26)
      gg = Math.min(255, gg + (1 - py / S) * 20)
      b = Math.min(255, b + (1 - py / S) * 10)
      a = bgAlpha

      // A：描边方框
      const dA = roundedRectSdf(px, py, aCx, aCy, aHalf, aHalf, aR)
      const strokeAlpha = Math.min(1, Math.max(0, 0.5 - (Math.abs(dA) - aStroke / 2) / feather))
      r = mix(r, 255, strokeAlpha)
      gg = mix(gg, 255, strokeAlpha)
      b = mix(b, 255, strokeAlpha)
      a = Math.max(a, strokeAlpha)

      // B：实心方框
      const dB = roundedRectSdf(px, py, bCx, bCy, bHalf, bHalf, bR)
      const fillAlpha = Math.min(1, Math.max(0, 0.5 - dB / feather))
      r = mix(r, 255, fillAlpha)
      gg = mix(gg, 255, fillAlpha)
      b = mix(b, 255, fillAlpha)
      a = Math.max(a, fillAlpha)

      const o = (Math.floor(y / SS) * size + Math.floor(x / SS)) * 4
      acc[o] += r
      acc[o + 1] += gg
      acc[o + 2] += b
      acc[o + 3] += a * 255
    }
  }

  const n = SS * SS
  const out = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = Math.round(acc[i * 4] / n)
    out[i * 4 + 1] = Math.round(acc[i * 4 + 1] / n)
    out[i * 4 + 2] = Math.round(acc[i * 4 + 2] / n)
    out[i * 4 + 3] = Math.round(acc[i * 4 + 3] / n)
  }
  return out
}

/* ── ICO 容器 ── */

function buildIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  entries.forEach((e, i) => {
    const o = i * 16
    dir[o] = e.size >= 256 ? 0 : e.size
    dir[o + 1] = e.size >= 256 ? 0 : e.size
    dir[o + 2] = 0
    dir[o + 3] = 0
    dir.writeUInt16LE(1, o + 4) // planes
    dir.writeUInt16LE(32, o + 6) // bpp
    dir.writeUInt32LE(e.data.length, o + 8) // bytesInRes
    dir.writeUInt32LE(offset, o + 12) // imageOffset
    offset += e.data.length
  })

  return Buffer.concat([header, dir, ...entries.map((e) => e.data)])
}

/* ── 主流程 ── */

const outDir = path.resolve('build')
fs.mkdirSync(outDir, { recursive: true })

const entries = SIZES.map((size) => ({ size, data: encodePng(size, size, render(size)) }))
const ico = buildIco(entries)
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico)

// 同时输出 512 PNG，供 README / 商店用
const png512 = encodePng(512, 512, render(512))
fs.writeFileSync(path.join(outDir, 'icon.png'), png512)

// 浏览器插件图标
const extIconDir = path.resolve('extension/icons')
fs.mkdirSync(extIconDir, { recursive: true })
for (const s of [16, 48, 128]) {
  fs.writeFileSync(path.join(extIconDir, `${s}.png`), encodePng(s, s, render(s)))
}

console.log(`✓ build/icon.ico  (${SIZES.join(', ')} px, ${(ico.length / 1024).toFixed(1)} KB)`)
console.log(`✓ build/icon.png  (512 px)`)
console.log(`✓ extension/icons (16, 48, 128 px)`)
