import fs from 'node:fs'
import path from 'node:path'
import { nativeImage } from 'electron'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import type { Asset } from '../shared/types'
import { Library } from './library'

const GIF_SIZE = 720
const BG = [15, 15, 17, 255]
const FRAME_DELAY_MS = 720

/**
 * 把两张图放进同一个正方形画布（letterbox），BGRA → RGBA。
 * nativeImage.toBitmap() 在 Windows 上是 BGRA。
 */
function frameOf(lib: Library, asset: Asset): Uint8Array {
  const abs = lib.abs(asset.relPath)
  if (!fs.existsSync(abs)) throw new Error('图片不存在：' + asset.relPath)
  const img = nativeImage.createFromPath(abs)
  if (img.isEmpty()) throw new Error('图片解码失败：' + asset.relPath)
  const size = img.getSize()
  if (!size.width || !size.height) throw new Error('图片尺寸异常：' + asset.relPath)

  const scale = Math.min(GIF_SIZE / size.width, GIF_SIZE / size.height)
  const w = Math.max(1, Math.round(size.width * scale))
  const h = Math.max(1, Math.round(size.height * scale))
  const small = w === size.width && h === size.height ? img : img.resize({ width: w, height: h, quality: 'good' })
  const bmp = small.toBitmap()
  const out = new Uint8Array(GIF_SIZE * GIF_SIZE * 4)

  for (let i = 0; i < out.length; i += 4) {
    out[i] = BG[0]
    out[i + 1] = BG[1]
    out[i + 2] = BG[2]
    out[i + 3] = BG[3]
  }

  const ox = Math.floor((GIF_SIZE - w) / 2)
  const oy = Math.floor((GIF_SIZE - h) / 2)
  const rowBytes = w * 4
  for (let y = 0; y < h; y++) {
    const srcRow = y * rowBytes
    const dstRow = ((oy + y) * GIF_SIZE + ox) * 4
    for (let x = 0; x < w; x++) {
      const si = srcRow + x * 4
      const di = dstRow + x * 4
      // BGRA -> RGBA
      out[di] = bmp[si + 2]
      out[di + 1] = bmp[si + 1]
      out[di + 2] = bmp[si]
      out[di + 3] = 255
    }
  }
  return out
}

export interface CompareGifResult {
  path: string
  bytes: number
  frames: number
  width: number
  height: number
}

/** A/B 两帧循环 GIF：两帧各停留 720ms，无限循环 */
export async function exportCompareGif(
  lib: Library,
  aId: string,
  bId: string,
  outPath: string
): Promise<CompareGifResult> {
  const a = lib.getAsset(aId)
  const b = lib.getAsset(bId)
  if (!a || a.kind !== 'image') throw new Error('A 不是图片')
  if (!b || b.kind !== 'image') throw new Error('B 不是图片')

  const gif = GIFEncoder()
  const frames = [frameOf(lib, a), frameOf(lib, b)]
  frames.forEach((rgba, i) => {
    const palette = quantize(rgba, 256)
    const index = applyPalette(rgba, palette)
    gif.writeFrame(index, GIF_SIZE, GIF_SIZE, {
      palette,
      delay: FRAME_DELAY_MS,
      repeat: 0,
      // 第一帧写全局调色板；第二帧用自己的调色板
      first: i === 0
    })
  })
  gif.finish()
  const bytes = gif.bytes()

  const dir = path.dirname(outPath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(outPath, Buffer.from(bytes))
  return {
    path: outPath,
    bytes: bytes.length,
    frames: 2,
    width: GIF_SIZE,
    height: GIF_SIZE
  }
}
