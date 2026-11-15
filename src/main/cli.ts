/**
 * 无头 CLI 通道（参照 CLI-Anything / VS Code 的「同一个 exe，两种用法」思路）：
 * 不另起炉灶，直接复用 library.ts / media.ts 的核心逻辑
 * （sha256 去重、缩略图、dHash、schema 迁移），保证 CLI 写进来的库
 * 与 GUI 完全同构。
 *
 * 用法：
 *   promptpair --cli list [--library <路径>]
 *   promptpair --cli add --batch <batch.json> [--library <路径>] [--dry-run]
 *
 * 约定：JSON 回执走 stdout（脚本 / Agent 解析用），人类可读日志走 stderr。
 *
 * 写保护：add 模式在写库前会检查 PromptPair 是否正在运行（tasklist），
 * 以及单实例锁是否被占用——库正被 GUI 打开时，GUI 内存里的旧数据
 * 会在下次落盘时覆盖 CLI 的写入，所以宁可拒绝执行。
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { app, BrowserWindow } from 'electron'
import { Library } from './library'
import { Config } from './config'
import { addFileToLibrary } from './media'
import type { EntryDraft, ImportResult, PromptEntry } from '../shared/types'

/** 批次文件里的一条待录入条目 */
export interface CliEntryInput {
  /** 跨批次幂等：同 originId 重复执行会更新同一条而不是重复创建 */
  originId?: string
  title: string
  positive: string
  negative?: string
  note?: string
  rating?: number
  favorite?: boolean
  params?: EntryDraft['params']
  source?: EntryDraft['source']
  /** 按名字给标签 / 集合，不存在则自动创建；标签可带组名（组不存在则建组） */
  tags?: (string | { name: string; group?: string })[]
  collections?: string[]
  /** 顺序即入库顺序（约定「原图在前、成图在后」）；role 仅作备注，暂不落库 */
  assets?: { path: string; role?: string }[]
}

export interface CliBatch {
  entries: CliEntryInput[]
}

export function isCliRequest(argv: string[] = process.argv): boolean {
  return argv.includes('--cli')
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < args.length; i++) {
    const t = args[i]
    if (t.startsWith('--')) {
      // 支持 --key=value（转发链路里 Chromium 会重排命令行，只能靠等号保住键值对）
      const eq = t.indexOf('=')
      if (eq > 2) {
        flags[t.slice(0, eq)] = t.slice(eq + 1)
        continue
      }
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
        flags[t] = next
        i++
      } else {
        flags[t] = true
      }
    }
  }
  return flags
}

function ensureCollectionByName(lib: Library, name: string): string {
  const found = lib.data.collections.find((c) => c.name === name)
  if (found) return found.id
  return lib.createCollection(name).id
}

/** params.model 只是字符串快照，词表里没有时补一条，模型管理器才有得管 */
function ensureModelByName(lib: Library, name: string): void {
  if (!name || lib.findModelByName(name)) return
  lib.createModel(name, 'image')
}

function ensureTagGroupByName(lib: Library, name: string): string {
  const found = lib.data.tagGroups.find((g) => g.name === name)
  if (found) return found.id
  return lib.createTagGroup(name, '#a1a1aa').id
}

function findEntryByOriginId(lib: Library, originId: string): PromptEntry | undefined {
  return lib.data.entries.find((e) => e.originId === originId)
}

/** 库被 GUI 打开时写库会被旧内存覆盖，直接拒绝 */
function guardNoRunningApp(): void {
  if (process.platform !== 'win32') return
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq PromptPair.exe" /FO CSV /NH', {
      encoding: 'utf8'
    })
    if (out.includes('PromptPair.exe')) {
      throw new Error('检测到 PromptPair 正在运行，请先退出应用再执行写操作（避免库被 GUI 内存覆盖）')
    }
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('检测到')) throw e
    // tasklist 本身失败不阻塞（如非 Windows 环境）
  }
}

function librarySummary(lib: Library) {
  return {
    library: lib.root,
    schemaVersion: lib.data.schemaVersion,
    entries: lib.data.entries.length,
    assets: lib.data.assets.length,
    collections: lib.data.collections.map((c) => c.name),
    tags: lib.data.tags.length,
    models: lib.data.models?.map((m) => m.name) ?? []
  }
}

function loadBatch(batchFile: string): CliBatch {
  const raw = fs.readFileSync(batchFile, 'utf8')
  const batch = JSON.parse(raw) as CliBatch
  if (!Array.isArray(batch.entries) || batch.entries.length === 0) {
    throw new Error('批次文件里没有条目（entries 为空）')
  }
  return batch
}

function precheckAssets(batch: CliBatch): { key: string; path: string }[] {
  const missing: { key: string; path: string }[] = []
  for (const it of batch.entries) {
    for (const a of it.assets ?? []) {
      if (!fs.existsSync(a.path)) missing.push({ key: it.title || it.originId || '?', path: a.path })
    }
  }
  return missing
}

function backupLibrary(lib: Library): void {
  if (fs.existsSync(lib.filePath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    fs.copyFileSync(lib.filePath, path.join(lib.root, `library.backup-cli-${ts}.json`))
    console.error(`[cli] 已备份原库文件 → library.backup-cli-${ts}.json`)
  }
}

export interface BatchStats {
  created: number
  updated: number
  importedAssets: number
  reusedAssets: number
  failed: { key: string; reason: string }[]
  newCollections: Set<string>
  createdTags: Set<string>
}

/** 批次导入核心：CLI 独立运行与「转发给运行中的软件」共用同一套逻辑 */
export async function importBatchIntoLibrary(
  lib: Library,
  batch: CliBatch,
  opts: { dryRun: boolean }
): Promise<BatchStats> {
  const beforeCollections = new Set(lib.data.collections.map((c) => c.id))
  const beforeTags = new Set(lib.data.tags.map((t) => t.id))
  const stats: BatchStats = {
    created: 0,
    updated: 0,
    importedAssets: 0,
    reusedAssets: 0,
    failed: [],
    newCollections: new Set<string>(),
    createdTags: new Set<string>()
  }

  for (let i = 0; i < batch.entries.length; i++) {
    const it = batch.entries[i]
    const key = it.title || it.originId || `#${i}`
    try {
      // dry-run 只做计划统计，绝不写库（0.12.1 修复：此前 dry-run 误执行真实写入）
      const exist = it.originId ? findEntryByOriginId(lib, it.originId) : undefined
      if (opts.dryRun) {
        if (exist) stats.updated++
        else stats.created++
        for (const c of it.collections ?? []) {
          if (!lib.data.collections.find((x) => x.name === c)) stats.newCollections.add(c)
        }
        continue
      }

      const assetIds: string[] = []
      for (const a of it.assets ?? []) {
        const res = await addFileToLibrary(lib, a.path)
        assetIds.push(res.asset.id)
        if (res.reused) stats.reusedAssets++
        else stats.importedAssets++
      }
      const tagIds = (it.tags ?? []).map((t) => {
        if (typeof t === 'string') return lib.ensureTag(t).id
        const gid = t.group ? ensureTagGroupByName(lib, t.group) : ''
        const tag = lib.ensureTag(t.name, gid)
        if (!beforeTags.has(tag.id)) stats.createdTags.add(tag.name)
        return tag.id
      })
      const collectionIds = (it.collections ?? []).map((c) => {
        const id = ensureCollectionByName(lib, c)
        if (!beforeCollections.has(id)) stats.newCollections.add(c)
        return id
      })
      ensureModelByName(lib, it.params?.model ?? '')

      const draft: EntryDraft = {
        title: it.title,
        positive: it.positive,
        negative: it.negative ?? '',
        note: it.note ?? '',
        rating: it.rating ?? 0,
        favorite: !!it.favorite,
        collectionIds,
        tagIds,
        assetIds,
        params: it.params ?? {},
        source: it.source ?? {}
      }

      if (exist) {
        lib.upsertEntry({ ...draft, id: exist.id, originId: it.originId })
        stats.updated++
      } else {
        lib.upsertEntry(it.originId ? { ...draft, originId: it.originId } : draft)
        stats.created++
      }
    } catch (e) {
      stats.failed.push({ key, reason: (e as Error).message })
    }
  }
  return stats
}

/* ──────────────── 转发：软件运行中时，CLI 把批次交给运行中的实例执行 ──────────────── */

export interface ForwardedCtx {
  /** GUI 模式传运行中的 Library；CLI 主实例转发时不传，落到配置库 */
  lib?: Library
  win: BrowserWindow | null
}

function sendImportDone(win: BrowserWindow | null, result: ImportResult): void {
  win?.webContents.send('import:done', result)
}

/** 运行中的 PromptPair 收到 second-instance 转发的 CLI add 命令后，在自己进程内完成导入。返回是否成功 */
export async function handleForwardedAdd(argv: string[], ctx: ForwardedCtx): Promise<boolean> {
  try {
    const addIdx = argv.indexOf('add')
    if (addIdx < 0) return true // 只转发 add；list/dry-run 由 CLI 进程本地执行
    // second-instance 的 commandLine 被 Chromium 重排过（--batch 会被提为独立开关），
    // 不能按位置取值：直接找 --batch 记号，等号形式取等号后，否则取下一个非开关令牌
    const batchIdx = argv.findIndex((a) => a.startsWith('--batch'))
    let batchFile = ''
    if (batchIdx >= 0) {
      const tok = argv[batchIdx]
      if (tok.includes('=')) batchFile = tok.slice(tok.indexOf('=') + 1)
      else {
        const next = argv[batchIdx + 1]
        batchFile = next && !next.startsWith('--') ? next : ''
      }
    }
    if (!batchFile) {
      const flags = parseFlags(argv.slice(addIdx + 1))
      batchFile = flags['--batch'] ? String(flags['--batch']) : ''
    }
    if (!batchFile) {
      // 兜底：转发命令行里非开关令牌按原序保留，批次路径是末尾的 .json
      const candidates = argv
        .filter((a, i) => i > 0 && !a.startsWith('--') && a !== '.' && /\.json$/i.test(a))
        .reverse()
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          batchFile = c
          break
        }
      }
    }
    if (!batchFile) {
      console.error('[cli][转发] 未找到 --batch 批次文件，忽略本次转发')
      return true
    }

    const batch = loadBatch(batchFile)
    const missing = precheckAssets(batch)
    if (missing.length > 0) {
      console.error(`[cli][转发] ${missing.length} 个媒体文件不存在，导入中止`)
      sendImportDone(ctx.win, {
        importedAssets: 0,
        reusedAssets: 0,
        createdEntries: 0,
        createdTags: [],
        failed: missing.slice(0, 5).map((m) => ({ path: m.path, reason: '文件不存在' }))
      })
      return false
    }

    const own = ctx.lib ? null : new Library(new Config().data.libraryPath)
    const lib = ctx.lib ?? own!
    backupLibrary(lib)
    const stats = await importBatchIntoLibrary(lib, batch, { dryRun: false })
    if (own) own.dispose()
    else lib.flush() // GUI 的库走延迟落盘，转发导入后立即刷一次

    console.error(`[cli][转发] 导入完成：${stats.created} 新建 / ${stats.updated} 更新 / ${stats.failed.length} 失败`)
    sendImportDone(ctx.win, {
      importedAssets: stats.importedAssets,
      reusedAssets: stats.reusedAssets,
      createdEntries: stats.created,
      createdTags: [...stats.createdTags],
      failed: stats.failed.map((f) => ({ path: f.key, reason: f.reason }))
    })
    return stats.failed.length === 0
  } catch (e) {
    console.error('[cli][转发] 导入失败：' + (e as Error).message)
    sendImportDone(ctx.win, {
      importedAssets: 0,
      reusedAssets: 0,
      createdEntries: 0,
      createdTags: [],
      failed: [{ path: 'CLI 转发导入', reason: (e as Error).message }]
    })
    return false
  }
}

// CLI 主实例（无窗口）也可能收到转发：排队，待当前导入结束后顺次执行
const forwardedQueue: string[][] = []
let draining = false

export function queueForwarded(argv: string[]): void {
  forwardedQueue.push(argv)
}

export async function drainForwarded(): Promise<number> {
  if (draining) return 0
  draining = true
  let failed = 0
  try {
    while (forwardedQueue.length) {
      const argv = forwardedQueue.shift()!
      const ok = await handleForwardedAdd(argv, { win: null })
      if (!ok) failed++
    }
  } finally {
    draining = false
  }
  return failed
}

export async function runCli(args: string[]): Promise<number> {
  await app.whenReady()
  // dev 模式 argv 是 [electron, '.', '--cli', …]，打包后是 [exe, '--cli', …]，统一滤掉 --cli
  const clean = args.filter((a) => a !== '--cli')
  const sub = clean[0]
  const flags = parseFlags(clean.slice(1))
  const started = Date.now()

  try {
    if (sub === 'list') {
      const libPath = flags['--library'] ? path.resolve(String(flags['--library'])) : new Config().data.libraryPath
      const lib = new Library(libPath)
      const summary = librarySummary(lib)
      lib.dispose()
      console.log(JSON.stringify(summary, null, 2))
      return 0
    }

    if (sub === 'add') {
      const batchFile = flags['--batch'] ? String(flags['--batch']) : ''
      if (!batchFile) throw new Error('缺少 --batch <batch.json>')
      const dryRun = flags['--dry-run'] === true
      const batch = loadBatch(batchFile)

      const libPath = flags['--library'] ? path.resolve(String(flags['--library'])) : new Config().data.libraryPath

      // ── 预检：资源路径存在性（dry-run 也执行）──
      const missing = precheckAssets(batch)
      if (missing.length > 0) {
        console.error(`[cli] 有 ${missing.length} 个媒体文件不存在，前 5 个：`)
        for (const m of missing.slice(0, 5)) console.error(`  - [${m.key}] ${m.path}`)
        throw new Error('媒体文件缺失，中止导入')
      }

      const lib = new Library(libPath)
      const beforeEntries = lib.data.entries.length

      if (!dryRun) {
        // 写保护只针对「配置库」：显式传入的测试库路径不与 GUI 冲突，放行
        const cfgLib = new Config().data.libraryPath
        const writingConfigured = !flags['--library'] || path.resolve(String(flags['--library'])) === path.resolve(cfgLib)
        if (writingConfigured) guardNoRunningApp()
        backupLibrary(lib)
      }

      const stats = await importBatchIntoLibrary(lib, batch, { dryRun })
      lib.dispose()
      const receipt = {
        ok: stats.failed.length === 0,
        dryRun,
        library: libPath,
        total: batch.entries.length,
        created: stats.created,
        updated: stats.updated,
        beforeEntries,
        afterEntries: beforeEntries + stats.created,
        importedAssets: stats.importedAssets,
        reusedAssets: stats.reusedAssets,
        createdCollections: [...stats.newCollections],
        createdTags: [...stats.createdTags],
        failed: stats.failed,
        seconds: Math.round(((Date.now() - started) / 1000) * 10) / 10
      }
      console.log(JSON.stringify(receipt, null, 2))
      console.error(
        `[cli] ${dryRun ? '预检' : '导入'}完成：${stats.created} 新建 / ${stats.updated} 更新 / ${stats.failed.length} 失败，媒体 ${stats.importedAssets} 新入 / ${stats.reusedAssets} 复用，用时 ${receipt.seconds}s`
      )
      return stats.failed.length === 0 ? 0 : 1
    }

    console.error('用法：')
    console.error('  promptpair --cli list [--library <路径>]')
    console.error('  promptpair --cli add --batch <batch.json> [--library <路径>] [--dry-run]')
    return 1
  } catch (e) {
    console.error('[cli] 失败：' + (e as Error).message)
    return 1
  }
}
