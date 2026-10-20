import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { nativeImage, NativeImage } from 'electron'
import type { Asset, AssetKind } from '../shared/types'
import { kindOfExt } from '../shared/types'
import { Library, newId, nowIso, shardPath } from './library'

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    const s = fs.createReadStream(filePath)
    s.on('data', (c) => h.update(c))
    s.on('error', reject)
    s.on('end', () => resolve(h.digest('hex')))
  })
}

/** 感知哈希：9×8 灰度差分（dHash），输出 16 位十六进制（64bit） */
export function dhashOf(img: NativeImage): string | undefined {
  try {
    const small = img.resize({ width: 9, height: 8, quality: 'good' })
    const size = small.getSize()
    if (size.width < 9 || size.height < 8) return undefined
    const bmp = small.toBitmap() // BGRA
    let bits = ''
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i1 = (y * size.width + x) * 4
        const i2 = (y * size.width + x + 1) * 4
        const g1 = 0.114 * bmp[i1] + 0.587 * bmp[i1 + 1] + 0.299 * bmp[i1 + 2]
        const g2 = 0.114 * bmp[i2] + 0.587 * bmp[i2 + 1] + 0.299 * bmp[i2 + 2]
        bits += g1 > g2 ? '1' : '0'
      }
    }
    let hex = ''
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
    return hex
  } catch {
    return undefined
  }
}

export function hammingHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}

/**
 * 生成缩略图。优先用系统缩略图提供器（对视频也有效，无需 ffmpeg），
 * 失败则回退到 nativeImage 解码缩放。
 */
async function buildThumb(
  srcPath: string,
  destJpgAbs: string,
  maxEdge = 512
): Promise<{ img: NativeImage | null; width?: number; height?: number }> {
  let img: NativeImage | null = null

  try {
    const thumb = await nativeImage.createThumbnailFromPath(srcPath, {
      width: maxEdge,
      height: maxEdge
    })
    if (thumb && !thumb.isEmpty()) img = thumb
  } catch {
    /* 不支持的环境继续走回退 */
  }

  if (!img) {
    try {
      const raw = nativeImage.createFromPath(srcPath)
      if (raw && !raw.isEmpty()) {
        const s = raw.getSize()
        const scale = Math.min(1, maxEdge / Math.max(s.width, s.height))
        img = scale < 1 ? raw.resize({ width: Math.round(s.width * scale), quality: 'good' }) : raw
      }
    } catch {
      /* ignore */
    }
  }

  if (!img || img.isEmpty()) return { img: null }

  const size = img.getSize()
  fs.mkdirSync(path.dirname(destJpgAbs), { recursive: true })
  fs.writeFileSync(destJpgAbs, img.toJPEG(82))
  return { img, width: size.width, height: size.height }
}

export interface AddAssetResult {
  asset: Asset
  reused: boolean
}

/**
 * 把外部文件收进库：内容寻址 + 缩略图 + 感知哈希。
 * 同一文件（sha256 相同）重复导入直接复用，不复制第二份。
 */
export async function addFileToLibrary(
  lib: Library,
  srcPath: string,
  opts: { keepOriginalSize?: boolean } = {}
): Promise<AddAssetResult> {
  const ext = path.extname(srcPath).toLowerCase()
  const kind = kindOfExt(ext)
  if (!kind) throw new Error('不支持的文件类型：' + ext)

  const stat = fs.statSync(srcPath)
  if (!stat.isFile()) throw new Error('不是文件')
  if (stat.size === 0) throw new Error('空文件')

  const sha = await sha256File(srcPath)
  const exist = lib.findAssetBySha(sha)
  if (exist) return { asset: exist, reused: true }

  const id = sha.slice(0, 24)
  const relPath = shardPath('media', sha, ext)
  const absMedia = lib.abs(relPath)
  fs.mkdirSync(path.dirname(absMedia), { recursive: true })
  if (!fs.existsSync(absMedia)) fs.copyFileSync(srcPath, absMedia)

  const thumbRel = shardPath('thumbs', sha, '.jpg')
  const thumbAbs = lib.abs(thumbRel)
  let width: number | undefined
  let height: number | undefined
  let phash: string | undefined

  const t = await buildThumb(absMedia, thumbAbs)

  if (kind === 'image') {
    // 真实尺寸：直接解码原图读取
    try {
      const full = nativeImage.createFromPath(absMedia)
      if (!full.isEmpty()) {
        const s = full.getSize()
        width = s.width
        height = s.height
        phash = dhashOf(full)
      }
    } catch {
      /* ignore */
    }
  } else {
    // 视频无法可靠读取原始分辨率，用抽帧尺寸占位并标注
    width = t.width
    height = t.height
    phash = t.img ? dhashOf(t.img) : undefined
  }

  const asset: Asset = {
    id,
    sha256: sha,
    kind: kind as AssetKind,
    ext,
    bytes: stat.size,
    width,
    height,
    relPath,
    thumbRel: fs.existsSync(thumbAbs) ? thumbRel : undefined,
    phash,
    addedAt: nowIso()
  }

  lib.addAsset(asset)
  return { asset, reused: false }
}

/** 给历史资源补齐缩略图/哈希（老库升级或早期失败时用） */
export async function repairAsset(lib: Library, asset: Asset): Promise<Asset> {
  if (asset.thumbRel && asset.phash) return asset
  const absMedia = lib.abs(asset.relPath)
  if (!fs.existsSync(absMedia)) return asset
  const thumbRel = asset.thumbRel ?? shardPath('thumbs', asset.sha256, '.jpg')
  const t = await buildThumb(absMedia, lib.abs(thumbRel))
  if (!asset.thumbRel && fs.existsSync(lib.abs(thumbRel))) asset.thumbRel = thumbRel
  if (!asset.phash) asset.phash = t.img ? dhashOf(t.img) : undefined
  if (asset.kind === 'video' && (!asset.width || !asset.height)) {
    asset.width = t.width
    asset.height = t.height
  }
  lib.touch()
  return asset
}

export function ensureAssetId(): string {
  return newId()
}
