import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Zip, ZipPassThrough, Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'
import type { ExportOptions, LibraryData, PromptEntry } from '../shared/types'
import { Library, newId, nowIso, safeName } from './library'
import { addFileToLibrary } from './media'
import { buildPreviewHtml, type PreviewAsset, type PreviewItem, type PreviewPack } from './preview'

export const PACK_MAGIC = 'promptpair.pack'
export const PACK_FORMAT_VERSION = 1

/* ────────────────────────── 导出 ────────────────────────── */

export interface ExportProgress {
  stage: 'collect' | 'write' | 'done'
  done: number
  total: number
  current?: string
}

/** 把条目转成预览页需要的结构；.promptpack 与单页 HTML 共用 */
export function buildPreviewPack(
  lib: Library,
  entries: PromptEntry[],
  packName: string,
  appVersion: string
): PreviewPack {
  const tagById = new Map(lib.data.tags.map((t) => [t.id, t]))
  const groupById = new Map(lib.data.tagGroups.map((g) => [g.id, g]))
  const collById = new Map(lib.data.collections.map((c) => [c.id, c]))
  const assetById = new Map(lib.data.assets.map((a) => [a.id, a]))

  const tagNameOf = (id: string): string => tagById.get(id)?.name ?? ''
  const tagColorOf = (id: string): string => {
    const t = tagById.get(id)
    if (!t) return '#8b95a8'
    return groupById.get(t.groupId)?.color ?? '#8b95a8'
  }

  const previewItems: PreviewItem[] = entries.map((e) => ({
    title: e.title,
    positive: e.positive,
    negative: e.negative,
    note: e.note,
    rating: e.rating,
    tags: e.tagIds.map(tagNameOf).filter(Boolean),
    collections: e.collectionIds.map((c) => collById.get(c)?.name ?? '').filter(Boolean),
    model: e.params?.model,
    seed: e.params?.seed,
    size: e.params?.width && e.params?.height ? `${e.params.width}×${e.params.height}` : undefined,
    steps: e.params?.steps,
    cfg: e.params?.cfg,
    sampler: e.params?.sampler,
    platform: e.source?.platform,
    url: e.source?.url,
    createdAt: e.createdAt,
    assets: e.assetIds
      .map((id) => assetById.get(id))
      .filter(Boolean)
      .map((a) => ({
        assetId: a!.id,
        rel: a!.relPath,
        thumb: a!.thumbRel,
        name: a!.relPath.split('/').pop(),
        kind: a!.kind,
        w: a!.width,
        h: a!.height
      }))
  }))

  const usedTagNames = [...new Set(entries.flatMap((e) => e.tagIds.map(tagNameOf)).filter(Boolean))]

  return {
    name: packName,
    exportedAt: nowIso(),
    appVersion,
    items: previewItems,
    tags: usedTagNames.map((n) => {
      const id = entries.flatMap((e) => e.tagIds).find((tid) => tagById.get(tid)?.name === n)!
      return { name: n, color: tagColorOf(id) }
    }),
    collections: [...new Set(entries.flatMap((e) => e.collectionIds))]
      .map((id) => collById.get(id))
      .filter(Boolean)
      .map((c) => ({ name: c!.name, color: c!.color }))
  }
}

const IMG_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif'
}

function dataUrlOf(absPath: string): { url: string; bytes: number } {
  const ext = path.extname(absPath).toLowerCase()
  const buf = fs.readFileSync(absPath)
  return {
    url: `data:${IMG_MIME[ext] ?? 'application/octet-stream'};base64,${buf.toString('base64')}`,
    bytes: buf.length
  }
}

export interface SingleHtmlOptions {
  entryIds: string[]
  outPath: string
  /** thumb = 默认轻量；full = 嵌原图（视频仍只放封面） */
  embed: 'thumb' | 'full'
}

/** 导出单页 HTML：对方双击即看、直接复制，不需要解压或安装 */
export async function exportSingleHtml(
  lib: Library,
  opts: SingleHtmlOptions,
  meta: { appVersion: string }
): Promise<{ path: string; entries: number; assets: number; bytes: number }> {
  const entries = lib.data.entries.filter((e) => opts.entryIds.includes(e.id))
  if (!entries.length) throw new Error('没有可导出的条目')

  const packName = path.basename(opts.outPath).replace(/\.html?$/i, '')
  const pack = buildPreviewPack(lib, entries, packName, meta.appVersion)
  const full = opts.embed === 'full'

  interface PlanItem {
    asset: PreviewAsset
    src: string | null
    poster: string | null
  }
  const plan: PlanItem[] = []
  let total = 0

  for (const item of pack.items) {
    for (const pa of item.assets) {
      const a = pa.assetId ? lib.getAsset(pa.assetId) : undefined
      if (!a) continue
      const thumbAbs = a.thumbRel ? lib.abs(a.thumbRel) : ''
      const fullAbs = lib.abs(a.relPath)
      const thumbOk = !!thumbAbs && fs.existsSync(thumbAbs)
      const fullOk = fs.existsSync(fullAbs)

      let src = ''
      let poster = ''
      if (a.kind === 'video') {
        poster = thumbOk ? thumbAbs : ''
      } else if (full) {
        src = fullOk ? fullAbs : thumbOk ? thumbAbs : ''
        poster = thumbOk ? thumbAbs : src
      } else {
        src = thumbOk ? thumbAbs : fullOk ? fullAbs : ''
        poster = src
      }

      if (src) total += fs.statSync(src).size
      if (poster && poster !== src) total += fs.statSync(poster).size
      plan.push({ asset: pa, src: src || null, poster: poster || null })
    }
  }

  const estimated = Math.ceil(total * 1.34)
  if (estimated > 200 * 1024 * 1024) {
    throw new Error(
      `单页 HTML 预计约 ${Math.round(estimated / 1024 / 1024)}MB，超过 200MB 上限；请改用「缩略图」模式或 .promptpack`
    )
  }

  for (const p of plan) {
    const poster = p.poster ? dataUrlOf(p.poster) : null
    const src = p.src ? dataUrlOf(p.src) : null
    if (p.asset.kind === 'video') {
      p.asset.rel = ''
      p.asset.thumb = poster?.url
      p.asset.playable = false
    } else if (full) {
      p.asset.rel = src?.url ?? poster?.url ?? ''
      p.asset.thumb = poster?.url ?? p.asset.rel
    } else {
      p.asset.rel = src?.url ?? ''
      p.asset.thumb = p.asset.rel
    }
  }

  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true })
  const html = buildPreviewHtml(pack)
  fs.writeFileSync(opts.outPath, html, 'utf8')
  const bytes = fs.statSync(opts.outPath).size
  return { path: opts.outPath, entries: entries.length, assets: plan.length, bytes }
}

export async function exportPack(
  lib: Library,
  opts: ExportOptions,
  meta: { appVersion: string },
  onProgress?: (p: ExportProgress) => void
): Promise<{ path: string; entries: number; assets: number; bytes: number }> {
  const entries = lib.data.entries.filter((e) => opts.entryIds.includes(e.id))
  if (!entries.length) throw new Error('没有可导出的条目')

  // 收集涉及的资源
  const assetIds = new Set<string>()
  for (const e of entries) for (const id of e.assetIds) assetIds.add(id)
  const assets = lib.data.assets.filter((a) => assetIds.has(a.id))

  const tagById = new Map(lib.data.tags.map((t) => [t.id, t]))
  const collById = new Map(lib.data.collections.map((c) => [c.id, c]))
  const tagNameOf = (id: string): string => tagById.get(id)?.name ?? ''

  const packName = path.basename(opts.outPath).replace(/\.promptpack$/i, '')
  const previewPack = buildPreviewPack(lib, entries, packName, meta.appVersion)

  const manifest = {
    magic: PACK_MAGIC,
    formatVersion: PACK_FORMAT_VERSION,
    appVersion: meta.appVersion,
    library: { id: lib.data.id, name: lib.data.name, schemaVersion: lib.data.schemaVersion },
    exportedAt: nowIso(),
    counts: { entries: entries.length, assets: assets.length },
    hasMedia: opts.includeMedia,
    entry: 'data/prompts.json'
  }

  // 机器可读的完整数据（重新导入用）
  const payload = {
    formatVersion: PACK_FORMAT_VERSION,
    appVersion: meta.appVersion,
    exportedAt: manifest.exportedAt,
    schemaVersion: lib.data.schemaVersion,
    tagGroups: lib.data.tagGroups.map((g) => ({ name: g.name, color: g.color, order: g.order })),
    tags: lib.data.tags.map((t) => ({
      name: t.name,
      group: lib.data.tagGroups.find((g) => g.id === t.groupId)?.name ?? ''
    })),
    collections: lib.data.collections.map((c) => ({ name: c.name, color: c.color })),
    models: (lib.data.models ?? []).map((m) => ({ name: m.name, kind: m.kind })),
    entries: entries.map((e) => ({
      title: e.title,
      positive: e.positive,
      negative: e.negative,
      note: e.note,
      rating: e.rating,
      favorite: e.favorite,
      tags: e.tagIds.map(tagNameOf).filter(Boolean),
      collections: e.collectionIds.map((c) => collById.get(c)?.name ?? '').filter(Boolean),
      params: e.params,
      source: e.source,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      assets: e.assetIds
        .map((id) => assets.find((a) => a.id === id))
        .filter(Boolean)
        .map((a) => ({
          rel: a!.relPath,
          thumb: a!.thumbRel,
          kind: a!.kind,
          w: a!.width,
          h: a!.height,
          bytes: a!.bytes,
          sha256: a!.sha256
        }))
    }))
  }

  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true })
  const fd = fs.openSync(opts.outPath, 'w')
  let writeError: Error | null = null

  try {
    const zip = new Zip((err, chunk) => {
      if (err) {
        writeError = err
        return
      }
      if (chunk && chunk.length) fs.writeSync(fd, chunk)
    })

    const put = (name: string, data: string | Uint8Array): void => {
      const entry = new ZipPassThrough(name)
      zip.add(entry)
      const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data
      entry.push(buf, true)
    }

    const putFile = (name: string, absPath: string): void => {
      const entry = new ZipPassThrough(name)
      zip.add(entry)
      const src = fs.openSync(absPath, 'r')
      const buf = Buffer.allocUnsafe(1 << 16)
      try {
        let n: number
        while ((n = fs.readSync(src, buf, 0, buf.length, null)) > 0) {
          entry.push(new Uint8Array(buf.subarray(0, n)), false)
        }
      } finally {
        fs.closeSync(src)
      }
      entry.push(new Uint8Array(0), true)
    }

    put('manifest.json', JSON.stringify(manifest, null, 2))
    put('data/prompts.json', JSON.stringify(payload, null, 2))
    put('index.html', buildPreviewHtml(previewPack))
    put('README.txt', readmeText(packName, meta.appVersion, entries.length, assets.length))

    if (opts.includeMedia) {
      const total = assets.length * 2
      let done = 0
      for (const a of assets) {
        if (writeError) break
        onProgress?.({ stage: 'write', done, total, current: a.relPath })
        const abs = lib.abs(a.relPath)
        if (fs.existsSync(abs)) putFile(a.relPath, abs)
        done++
        if (a.thumbRel) {
          const tabs = lib.abs(a.thumbRel)
          if (fs.existsSync(tabs)) putFile(a.thumbRel, tabs)
        }
        done++
      }
    }

    zip.end()
    if (writeError) throw writeError
  } finally {
    fs.closeSync(fd)
  }

  const bytes = fs.statSync(opts.outPath).size
  onProgress?.({ stage: 'done', done: 1, total: 1 })
  return { path: opts.outPath, entries: entries.length, assets: assets.length, bytes }
}

function readmeText(name: string, version: string, entries: number, assets: number): string {
  return `PromptPair 分享包：${name}
====================================

导出时间：${nowIso()}
生成工具：PromptPair ${version}
记录数：${entries} 条
媒体数：${assets} 个

【怎么查看】
直接双击本文件夹里的 index.html，用浏览器打开即可。
不需要安装任何软件。支持搜索、按标签筛选、点开看大图/播放视频、
一键复制提示词。

【怎么导入回 PromptPair】
打开 PromptPair → 顶部「导入」→「导入分享包」→ 选择这个 .promptpack 文件。
所有提示词、标签、集合、生成参数都会还原，媒体文件按内容哈希去重，
不会重复占用空间。

【文件夹结构】
  manifest.json        包清单（格式版本、来源库、数量）
  data/prompts.json    全部结构化数据（可被任何程序读取）
  index.html           自带的可视化浏览页
  media/               原始图片/视频
  thumbs/              缩略图

本包格式为开放格式，任何工具都可以解析 data/prompts.json。
`
}

/* ────────────────────────── 解包 ────────────────────────── */

export function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true })
    const unzip = new Unzip()
    unzip.register(UnzipInflate)
    unzip.register(UnzipPassThrough)

    let pending = 0
    let ended = false
    let settled = false

    const maybeDone = (): void => {
      if (ended && pending === 0 && !settled) {
        settled = true
        resolve()
      }
    }

    unzip.onfile = (file): void => {
      // 防目录穿越
      const rel = file.name.replace(/\\/g, '/').replace(/^\/+/, '')
      if (rel.includes('..')) return
      const dest = path.join(destDir, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      const ws = fs.createWriteStream(dest)
      pending++
      file.ondata = (err, chunk, final): void => {
        if (err) {
          if (!settled) {
            settled = true
            reject(err)
          }
          return
        }
        if (chunk && chunk.length) ws.write(chunk)
        if (final) {
          ws.end(() => {
            pending--
            maybeDone()
          })
        }
      }
      file.start()
    }

    const rs = fs.createReadStream(zipPath, { highWaterMark: 1 << 20 })
    rs.on('data', (c) => unzip.push(new Uint8Array(c as Buffer), false))
    rs.on('end', () => {
      unzip.push(new Uint8Array(0), true)
      ended = true
      maybeDone()
    })
    rs.on('error', reject)
  })
}

export interface MergeResult {
  entries: number
  assets: number
  createdTags: string[]
  createdCollections: string[]
  createdModels: string[]
}

/** 把 .promptpack 合并进目标库 */
export async function mergePack(lib: Library, packPath: string): Promise<MergeResult> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-pack-'))
  try {
    await extractZip(packPath, tmp)

    const manifestPath = path.join(tmp, 'manifest.json')
    if (!fs.existsSync(manifestPath)) throw new Error('不是有效的 PromptPair 分享包（缺少 manifest.json）')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (manifest.magic !== PACK_MAGIC) throw new Error('不是有效的 PromptPair 分享包（magic 不匹配）')

    const dataPath = path.join(tmp, manifest.entry ?? 'data/prompts.json')
    if (!fs.existsSync(dataPath)) throw new Error('分享包缺少 data/prompts.json')
    const payload = JSON.parse(fs.readFileSync(dataPath, 'utf8'))

    const result: MergeResult = {
      entries: 0,
      assets: 0,
      createdTags: [],
      createdCollections: [],
      createdModels: []
    }

    // 标签组：按名字对齐，不存在则建
    const groupNameToId = new Map<string, string>()
    for (const g of lib.data.tagGroups) groupNameToId.set(g.name, g.id)
    for (const g of payload.tagGroups ?? []) {
      if (!groupNameToId.has(g.name)) {
        const ng = lib.createTagGroup(g.name, g.color)
        groupNameToId.set(g.name, ng.id)
      }
    }
    for (const t of payload.tags ?? []) {
      if (!lib.findTagByName(t.name)) {
        lib.ensureTag(t.name, groupNameToId.get(t.group) ?? '')
        result.createdTags.push(t.name)
      }
    }

    const collNameToId = new Map<string, string>()
    for (const c of lib.data.collections) collNameToId.set(c.name, c.id)
    for (const c of payload.collections ?? []) {
      if (!collNameToId.has(c.name)) {
        const nc = lib.createCollection(c.name, c.color)
        collNameToId.set(c.name, nc.id)
        result.createdCollections.push(c.name)
      }
    }

    for (const m of payload.models ?? []) {
      const name = String(m?.name ?? '').trim()
      if (!name) continue
      if (lib.findModelByName(name)) continue
      lib.createModel(name, m.kind === 'image' || m.kind === 'video' ? m.kind : 'other')
      result.createdModels.push(name)
    }

    for (const item of payload.entries ?? []) {
      const assetIds: string[] = []
      for (const a of item.assets ?? []) {
        const abs = path.join(tmp, (a.rel as string).replace(/\//g, path.sep))
        if (!fs.existsSync(abs)) continue
        const { asset } = await addFileToLibrary(lib, abs)
        assetIds.push(asset.id)
        result.assets++
      }
      if (!assetIds.length) continue

      const tagIds = (item.tags ?? []).map((n: string) => lib.ensureTag(n).id)
      const collectionIds = (item.collections ?? [])
        .map((n: string) => collNameToId.get(n))
        .filter(Boolean) as string[]

      lib.upsertEntry({
        title: item.title || '未命名',
        positive: item.positive || '',
        negative: item.negative || '',
        note: item.note || '',
        rating: item.rating || 0,
        favorite: !!item.favorite,
        collectionIds,
        tagIds,
        assetIds,
        params: item.params || {},
        source: item.source || {}
      })
      result.entries++
    }

    lib.flush()
    return result
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

/** 导出为纯 JSON（给用户做数据备份 / 二次开发） */
export function exportJson(lib: Library, outPath: string): void {
  fs.writeFileSync(outPath, JSON.stringify(lib.data, null, 2), 'utf8')
}

/** 生成默认包名 */
export function defaultPackName(lib: Library, collectionName?: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 13)
  return safeName(`${collectionName || lib.data.name}-${stamp}`) + '.promptpack'
}
