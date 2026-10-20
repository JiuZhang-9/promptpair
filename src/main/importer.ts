import fs from 'node:fs'
import path from 'node:path'
import type { AppConfig, ImportResult, PromptEntry, PromptParams } from '../shared/types'
import { IMAGE_EXTS, VIDEO_EXTS, kindOfExt } from '../shared/types'
import { Library, nowIso, safeName } from './library'
import { addFileToLibrary } from './media'
import { detectPlatform, readSidecar, readSidecarByStem } from './sidecar'

const ALL_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS])

/** 递归收集目录下的媒体文件 */
export function collectMediaFiles(inputs: string[], maxDepth = 8): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const walk = (p: string, depth: number): void => {
    if (depth > maxDepth) return
    let st: fs.Stats
    try {
      st = fs.statSync(p)
    } catch {
      return
    }
    if (st.isFile()) {
      const ext = path.extname(p).toLowerCase()
      if (ALL_EXTS.has(ext) && !seen.has(p)) {
        seen.add(p)
        out.push(p)
      }
      return
    }
    if (!st.isDirectory()) return
    let names: string[]
    try {
      names = fs.readdirSync(p)
    } catch {
      return
    }
    for (const n of names) {
      if (n.startsWith('.') || n === 'node_modules' || n === 'System Volume Information') continue
      walk(path.join(p, n), depth + 1)
    }
  }

  for (const i of inputs) walk(i, 0)
  return out
}

/**
 * 连号归组：把同一次生成的多个产物归到一条记录里。
 * 例：`赛博朋克女孩_1.png` `赛博朋克女孩_2.png` → 同组
 *     `cyber_girl (1).jpg` `cyber_girl (2).jpg` → 同组
 */
export function stemKey(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath))
  return (
    base
      // 尾部序号：_1 / -01 / (1) / copy / 空格2
      .replace(/[\s_-]*\(\d{1,3}\)\s*$/, '')
      .replace(/[\s_-]+(?:copy|副本)\s*$/i, '')
      .replace(/[\s_-]+\d{1,3}\s*$/, '')
      // 平台常见后缀：_seed123 / _hd / _upscaled
      .replace(/[\s_-]+seed[\s_-]*\d+$/i, '')
      .replace(/[\s_-]+(?:hd|upscaled|final|output|result)$/i, '')
      .trim() || base
  )
}

/**
 * 这些文件夹名属于「容器」，不是「分类」。
 * 例如直接从下载目录导入，不应该给所有图都打上「Downloads」标签。
 */
const CONTAINER_FOLDER =
  /^(downloads?|desktop|documents?|pictures?|videos?|music|movies|新建文件夹|未命名文件夹|untitled( folder)?|new folder|temp|tmp|临时|导出|导出图|生成结果|outputs?|exports?|results?|下载|桌面|文档|图片|视频|音乐|素材|images?|imgs?|photos?|camera roll|screenshots?|截图)$/i

/**
 * 把「文件夹名」翻译成「标签」。
 *
 * 规则（按优先级）：
 *  1. 整个名字已经是现有标签 → 直接用它，不拆。
 *  2. 名字里含有某个「标签组名」→ 其余部分作为标签，并归入那个组。
 *     例：`风格_赛博朋克` → 标签「赛博朋克」放进组「风格」
 *         `镜头_特写`     → 标签「特写」    放进组「镜头」
 *  3. 其余情况按分隔符拆成多个标签（归入未分组）。
 *     中文名允许用 `_` 作分隔（中文用户习惯），英文名只用 `、,，|` 拆，
 *     避免 `my_style_folder` 被误拆成三个标签。
 *
 * 取样范围：从文件所在目录向上最多 3 层，包含用户选中的导入根目录本身
 * （那个名字通常是用户自己起的、最有信息量）；再往上就停，避免带上
 * 盘符和"下载/桌面"这类无意义容器名。
 */
function tagsFromPath(
  lib: Library,
  filePath: string,
  rootHints: string[],
  cfg: AppConfig
): string[] {
  if (!cfg.autoTagFromFolder) return []
  const roots = rootHints.map((r) => path.resolve(r))
  const names: string[] = []

  let dir = path.dirname(path.resolve(filePath))
  for (let i = 0; i < 3; i++) {
    const base = path.basename(dir)
    const isDriveRoot = /^[a-z]:$/i.test(base) || dir === path.dirname(dir)
    if (!base || isDriveRoot) break
    if (!CONTAINER_FOLDER.test(base.trim()) && base.length <= 40) names.push(base)
    // 到了用户选中的导入根（含）就停
    if (roots.includes(dir)) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  const hits: string[] = []

  const takeOne = (raw: string, groupId = ''): void => {
    const exist = lib.findTagByName(raw)
    if (exist) {
      hits.push(exist.name)
      // 已存在但没归组时，顺手补上分组，避免标签散在「未分组」里
      if (groupId && !exist.groupId) exist.groupId = groupId
      return
    }
    if (!cfg.autoCreateTags) return
    const t = lib.ensureTag(raw, groupId)
    hits.push(t.name)
  }

  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    if (/^\d+$/.test(name)) continue

    // 1. 整名命中
    const whole = lib.findTagByName(name)
    if (whole) {
      hits.push(whole.name)
      continue
    }

    // 2. 拆
    const hasCJK = /[\u4e00-\u9fa5]/.test(name)
    const parts = name
      .split(hasCJK ? /[_、,，|]+/ : /[、,，|]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 1 && s.length <= 24 && !/^\d+$/.test(s))

    if (parts.length === 0) continue

    // 2a. 其中是否有一段是已有的标签组名
    const group = parts
      .map((p) => lib.data.tagGroups.find((g) => g.name === p))
      .find(Boolean)
    if (group) {
      for (const p of parts) if (p !== group.name) takeOne(p, group.id)
      continue
    }

    // 3. 平铺
    for (const p of parts) takeOne(p)
  }

  return [...new Set(hits)]
}

export interface ImportOptions {
  /** 记录来源平台（用户可覆盖自动识别） */
  platformOverride?: string
  /** 归入某个集合 */
  collectionId?: string
  /** 默认追打的标签名（导入前在 UI 里预先勾好） */
  presetTags?: string[]
  /** 本次导入的根目录，用于截断目录名推断 */
  roots?: string[]
  /** 同批次连号合并 */
  groupByStem?: boolean
  /** 单条记录标题前缀 */
  titleFrom?: 'filename' | 'prompt' | 'date'
}

/**
 * 导入主流程。
 * 幂等：同一文件重复导入只会复用已有 asset，不会产生第二条记录（同 stem 已有条目会被追加媒体）。
 */
export async function importFiles(
  lib: Library,
  cfg: AppConfig,
  inputs: string[],
  opts: ImportOptions = {},
  onProgress?: (done: number, total: number, current: string) => void
): Promise<ImportResult> {
  const files = collectMediaFiles(inputs)
  const result: ImportResult = {
    importedAssets: 0,
    reusedAssets: 0,
    createdEntries: 0,
    createdTags: [],
    failed: []
  }
  if (!files.length) return result

  const groupByStem = opts.groupByStem ?? cfg.autoGroupByStem
  const roots = (opts.roots ?? inputs).map((p) => path.resolve(p))

  // 归组
  const groups = new Map<string, string[]>()
  for (const f of files) {
    const key = groupByStem ? `${path.dirname(f)}::${stemKey(f)}` : f
    const arr = groups.get(key) ?? []
    arr.push(f)
    groups.set(key, arr)
  }

  // 用于「重复导入时追加媒体」的索引：(stem|标题) → entry
  const existingByKey = new Map<string, PromptEntry>()
  for (const e of lib.data.entries) {
    const k = (e.source.originalPath ? path.dirname(e.source.originalPath) : '') + '::' + e.title
    existingByKey.set(k, e)
  }

  let done = 0
  const presetTags = opts.presetTags ?? []

  for (const [, group] of groups) {
    done++
    onProgress?.(done, groups.size, path.basename(group[0]))
    try {
      const assetIds: string[] = []
      let sidecarPositive = ''
      let sidecarNegative = ''
      let params: PromptParams = {}
      let sidecarOrigin: string = 'none'

      for (const f of group) {
        try {
          const { asset, reused } = await addFileToLibrary(lib, f)
          assetIds.push(asset.id)
          if (reused) result.reusedAssets++
          else result.importedAssets++
        } catch (e) {
          result.failed.push({ path: f, reason: (e as Error).message })
          continue
        }
        if (!sidecarPositive && cfg.autoReadSidecar) {
          let sc = readSidecar(f)
          // 连号组：city_1.png 找不到就试 city.txt（整组共用一份提示词）
          if (sc.origin === 'none') sc = readSidecarByStem(f, stemKey(f))
          if (sc.origin !== 'none') {
            sidecarPositive = sc.prompt.positive
            sidecarNegative = sc.prompt.negative
            params = sc.prompt.params
            sidecarOrigin = sc.origin
          }
        }
      }

      if (!assetIds.length) continue

      const first = group[0]
      const stem = stemKey(first)
      const tagNames = [
        ...new Set([...presetTags, ...tagsFromPath(lib, first, roots, cfg)])
      ].filter(Boolean)

      const tagIds: string[] = []
      for (const tn of tagNames) {
        const t = lib.ensureTag(tn)
        tagIds.push(t.id)
      }

      const platform =
        opts.platformOverride ||
        detectPlatform(...group.map((g) => path.basename(g)), ...roots) ||
        '本地导入'

      const titleMode = opts.titleFrom ?? 'filename'
      let title: string
      if (titleMode === 'prompt' && sidecarPositive) title = safeName(sidecarPositive.split('\n')[0], stem)
      else if (titleMode === 'date') title = `${path.basename(path.dirname(first))} ${stem}`
      else title = safeName(stem)

      // 已存在同键条目 → 只追加媒体，避免重复建条
      const ekey = `${path.dirname(first)}::${title}`
      const existing = existingByKey.get(ekey)
      if (existing) {
        const merged = [...new Set([...existing.assetIds, ...assetIds])]
        existing.assetIds = merged
        existing.tagIds = [...new Set([...existing.tagIds, ...tagIds])]
        if (!existing.positive && sidecarPositive) existing.positive = sidecarPositive
        if (!existing.negative && sidecarNegative) existing.negative = sidecarNegative
        if ((!existing.params || !Object.keys(existing.params).length) && Object.keys(params).length)
          existing.params = params
        existing.updatedAt = nowIso()
        lib.touch()
        continue
      }

      const entryDraft = {
        title,
        positive: sidecarPositive,
        negative: sidecarNegative,
        note: '',
        rating: 0,
        favorite: false,
        collectionIds: opts.collectionId ? [opts.collectionId] : [],
        tagIds,
        assetIds,
        params,
        source: {
          platform,
          originalName: path.basename(first),
          originalPath: first
        }
      }
      const created = lib.upsertEntry(entryDraft)
      result.createdEntries++
      existingByKey.set(ekey, created)
    } catch (e) {
      result.failed.push({ path: group[0], reason: (e as Error).message })
    }
  }

  lib.touch()
  return result
}

/** 浏览器插件采集：先落盘 dataURL/下载远端图，再走同一套入库逻辑 */
export async function importCaptured(
  lib: Library,
  cfg: AppConfig,
  payload: {
    buffer: Buffer
    ext: string
    fileName: string
    positive: string
    negative: string
    platform?: string
    pageUrl: string
    pageTitle: string
  }
): Promise<{ entry: PromptEntry; assetId: string }> {
  const tmpDir = path.join(lib.root, '.incoming')
  fs.mkdirSync(tmpDir, { recursive: true })
  const tmpFile = path.join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2)}${payload.ext}`)
  fs.writeFileSync(tmpFile, payload.buffer)

  try {
    const { asset } = await addFileToLibrary(lib, tmpFile)
    const tagNames = [payload.platform ?? detectPlatform(payload.pageTitle, payload.pageUrl) ?? '网页采集']
    const tagIds = tagNames.map((n) => lib.ensureTag(n).id)

    const entry = lib.upsertEntry({
      title: safeName(payload.pageTitle || path.basename(payload.fileName), '网页采集'),
      positive: payload.positive,
      negative: payload.negative,
      note: '',
      rating: 0,
      favorite: false,
      collectionIds: [],
      tagIds,
      assetIds: [asset.id],
      params: {},
      source: {
        platform: payload.platform ?? detectPlatform(payload.pageTitle, payload.pageUrl),
        url: payload.pageUrl,
        originalName: payload.fileName
      }
    })
    lib.touch()
    return { entry, assetId: asset.id }
  } finally {
    try {
      fs.rmSync(tmpFile, { force: true })
    } catch {
      /* ignore */
    }
  }
}
