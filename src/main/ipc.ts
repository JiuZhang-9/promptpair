import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, net, shell } from 'electron'
import type {
  AppConfig,
  BatchPatch,
  CapturePayload,
  EntryDraft,
  ExportOptions,
  ImportResult,
  LibraryData,
  TagCandidateAssignment
} from '../shared/types'
import { kindOfExt } from '../shared/types'
import { Library } from './library'
import type { Config } from './config'
import { defaultLibraryPath } from './config'
import { importCaptured, importFiles, type ImportOptions } from './importer'
import { defaultPackName, exportJson, exportPack, exportSingleHtml, mergePack } from './exporter'
import { scanDuplicates } from './duplicates'
import { addFileToLibrary, repairAsset, hammingHex } from './media'
import { suggestTags, testAiConnection } from './ai'
import { startCaptureServer, getCapturePort } from './capture'
import { checkForUpdatesManually, getUpdateStatus, quitAndInstall } from './updater'
import { APP_VERSION } from './version'
import { applyUiScale } from './appearance'

export interface AppCtx {
  win: BrowserWindow | null
  lib: Library
  setLib(next: Library): Library
  cfg: Config
}

function send(ctx: AppCtx, channel: string, payload: unknown): void {
  ctx.win?.webContents.send(channel, payload)
}

/* 对话框封装：有窗口时挂到窗口上（模态），否则退化为独立对话框 */
function saveDialog(ctx: AppCtx, opts: Electron.SaveDialogOptions) {
  return ctx.win ? dialog.showSaveDialog(ctx.win, opts) : dialog.showSaveDialog(opts)
}
function openDialog(ctx: AppCtx, opts: Electron.OpenDialogOptions) {
  return ctx.win ? dialog.showOpenDialog(ctx.win, opts) : dialog.showOpenDialog(opts)
}
function messageBox(ctx: AppCtx, opts: Electron.MessageBoxOptions) {
  return ctx.win ? dialog.showMessageBox(ctx.win, opts) : dialog.showMessageBox(opts)
}

function snapshot(ctx: AppCtx): { data: LibraryData; root: string; config: AppConfig; version: string; capturePort: number } {
  return {
    data: ctx.lib.data,
    root: ctx.lib.root,
    config: ctx.cfg.data,
    version: APP_VERSION,
    capturePort: getCapturePort()
  }
}

/** 下载远端图片/视频到内存（浏览器插件采集用） */
async function fetchToBuffer(
  url: string,
  referer?: string
): Promise<{ buffer: Buffer; ext: string }> {
  // 用图片所在页面的地址做 Referer，比用图片域名更接近浏览器的真实请求，
  // 能减少图床防盗链误判。
  let ref = referer && /^https?:\/\//i.test(referer) ? referer : ''
  if (!ref) {
    try {
      ref = new URL(url).origin + '/'
    } catch {
      ref = ''
    }
  }

  let res: Response
  try {
    res = await net.fetch(url, {
      headers: {
        ...(ref ? { Referer: ref } : {}),
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
      }
    })
  } catch (e) {
    const msg = (e as Error).message || ''
    console.error('[capture] 图片下载失败', url, msg)
    if (/ERR_BLOCKED_BY_CLIENT|ERR_UNKNOWN_URL_SCHEME/i.test(msg) || /^blob:/i.test(url)) {
      throw new Error(
        '这张图是浏览器临时地址（blob）或受保护地址，桌面端直接下载不了；请更新插件后重试，或换一张图。'
      )
    }
    throw new Error('下载图片失败：' + msg)
  }
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
  const ab = await res.arrayBuffer()
  const buffer = Buffer.from(ab)

  const ct = (res.headers.get('content-type') ?? '').toLowerCase()
  let ext = ''
  if (ct.includes('png')) ext = '.png'
  else if (ct.includes('webp')) ext = '.webp'
  else if (ct.includes('gif')) ext = '.gif'
  else if (ct.includes('jpeg') || ct.includes('jpg')) ext = '.jpg'
  else if (ct.includes('mp4')) ext = '.mp4'
  else if (ct.includes('webm')) ext = '.webm'

  if (!ext) {
    try {
      ext = path.extname(new URL(url).pathname).toLowerCase()
    } catch {
      ext = ''
    }
  }
  if (!kindOfExt(ext)) ext = '.png'
  return { buffer, ext }
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; ext: string } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!m) throw new Error('无效的 dataURL')
  const mime = (m[1] ?? 'image/png').toLowerCase()
  const isB64 = !!m[2]
  const data = isB64 ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'binary')
  let ext = '.png'
  if (mime.includes('jpeg')) ext = '.jpg'
  else if (mime.includes('webp')) ext = '.webp'
  else if (mime.includes('gif')) ext = '.gif'
  else if (mime.includes('mp4')) ext = '.mp4'
  else if (mime.includes('webm')) ext = '.webm'
  return { buffer: data, ext }
}

export function registerIpc(ctx: AppCtx): void {
  /* ───────────── 基础 ───────────── */

  ipcMain.handle('app:info', () => ({
    version: APP_VERSION,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    userData: app.getPath('userData'),
    isPackaged: app.isPackaged
  }))

  ipcMain.handle('lib:get', () => snapshot(ctx))

  ipcMain.handle('lib:reveal', async () => {
    await shell.openPath(ctx.lib.root)
  })

  ipcMain.handle('lib:chooseRoot', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择素材库文件夹',
      defaultPath: ctx.cfg.data.libraryPath,
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    return r.filePaths[0]
  })

  ipcMain.handle('lib:switch', async (_e, target: string) => {
    const dir = path.resolve(target)
    fs.mkdirSync(dir, { recursive: true })
    ctx.lib.flush()
    const next = ctx.setLib(new Library(dir))
    return snapshot(ctx)
  })

  ipcMain.handle('lib:resetToDefault', async () => {
    const dir = defaultLibraryPath()
    fs.mkdirSync(dir, { recursive: true })
    ctx.lib.flush()
    const next = ctx.setLib(new Library(dir))
    return snapshot(ctx)
  })

  ipcMain.handle('config:patch', (_e, patch: Partial<AppConfig>) => {
    const cfg = ctx.cfg.patch(patch)
    if (patch.theme != null) nativeTheme.themeSource = cfg.theme
    if (patch.uiScale != null || patch.theme != null) {
      applyUiScale(ctx.win, cfg.uiScale ?? 1)
    }
    return cfg
  })

  ipcMain.handle('config:get', () => ctx.cfg.data)

  /* ───────────── 条目 ───────────── */

  ipcMain.handle('entry:save', (_e, draft: EntryDraft) => {
    const saved = ctx.lib.upsertEntry(draft)
    ctx.lib.flush()
    return saved
  })

  ipcMain.handle('entry:delete', (_e, ids: string[]) => {
    const n = ctx.lib.deleteEntries(ids)
    ctx.lib.flush()
    return { deleted: n }
  })

  ipcMain.handle('entry:batch', (_e, ids: string[], patch: BatchPatch) => {
    const n = ctx.lib.batchPatch(ids, patch)
    ctx.lib.flush()
    return { updated: n }
  })

  /* ───────────── 标签 / 集合 ───────────── */

  ipcMain.handle('tag:create', (_e, name: string, groupId: string) => {
    const t = ctx.lib.createTag(name, groupId)
    ctx.lib.flush()
    return t
  })

  ipcMain.handle('tag:update', (_e, id: string, patch: { name?: string; groupId?: string }) => {
    const t = ctx.lib.updateTag(id, patch)
    ctx.lib.flush()
    return t
  })

  ipcMain.handle('tag:delete', (_e, id: string) => {
    ctx.lib.deleteTag(id)
    ctx.lib.flush()
    return true
  })

  ipcMain.handle('tag:deleteMany', (_e, ids: string[]) => {
    const deleted = ctx.lib.deleteTags(ids)
    ctx.lib.flush()
    return { deleted }
  })

  ipcMain.handle('tag:merge', (_e, fromIds: string[], toId: string) => {
    const r = ctx.lib.mergeTags(fromIds, toId)
    ctx.lib.flush()
    return r
  })

  /* ───────────── AI 辅助打标（可选） ───────────── */

  ipcMain.handle('ai:suggestTags', (_e, entryIds: string[]) =>
    suggestTags(ctx.lib, ctx.cfg.data, entryIds)
  )

  ipcMain.handle('ai:test', () => testAiConnection(ctx.cfg.data))

  ipcMain.handle('ai:applyTags', (_e, assignments: TagCandidateAssignment[]) => {
    const r = ctx.lib.applyTagCandidates(assignments)
    ctx.lib.flush()
    return r
  })

  ipcMain.handle('tagGroup:create', (_e, name: string, color: string) => {
    const g = ctx.lib.createTagGroup(name, color)
    ctx.lib.flush()
    return g
  })

  ipcMain.handle('tagGroup:update', (_e, id: string, patch: { name?: string; color?: string }) => {
    const g = ctx.lib.updateTagGroup(id, patch)
    ctx.lib.flush()
    return g
  })

  ipcMain.handle('tagGroup:delete', (_e, id: string) => {
    ctx.lib.deleteTagGroup(id)
    ctx.lib.flush()
    return true
  })

  ipcMain.handle('collection:create', (_e, name: string, color: string) => {
    const c = ctx.lib.createCollection(name, color)
    ctx.lib.flush()
    return c
  })

  ipcMain.handle('collection:update', (_e, id: string, patch: { name?: string; color?: string }) => {
    const c = ctx.lib.updateCollection(id, patch)
    ctx.lib.flush()
    return c
  })

  ipcMain.handle('collection:delete', (_e, id: string) => {
    ctx.lib.deleteCollection(id)
    ctx.lib.flush()
    return true
  })

  /* ───────────── 导入 ───────────── */

  ipcMain.handle('import:pickFiles', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择图片或视频',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '媒体文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'mp4', 'webm', 'mov', 'm4v', 'mkv'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    })
    if (r.canceled) return []
    return r.filePaths
  })

  ipcMain.handle('import:pickFolder', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择要导入的文件夹（会递归扫描子文件夹）',
      properties: ['openDirectory']
    })
    if (r.canceled) return []
    return r.filePaths
  })

  ipcMain.handle(
    'import:paths',
    async (_e, inputs: string[], opts: ImportOptions = {}): Promise<ImportResult> => {
      send(ctx, 'import:start', { total: inputs.length })
      const res = await importFiles(ctx.lib, ctx.cfg.data, inputs, opts, (done, total, current) => {
        send(ctx, 'import:progress', { done, total, current })
      })
      ctx.lib.flush()
      send(ctx, 'import:done', res)
      return res
    }
  )

  /* ───────────── 媒体 ───────────── */

  ipcMain.handle('asset:add', async (_e, paths: string[]) => {
    const out = []
    for (const p of paths) {
      try {
        const { asset, reused } = await addFileToLibrary(ctx.lib, p)
        out.push({ ...asset, reused })
      } catch (e) {
        console.error('[asset:add]', p, (e as Error).message)
      }
    }
    ctx.lib.flush()
    return out
  })

  ipcMain.handle('asset:fromClipboard', async () => {
    const img = clipboard.readImage()
    if (!img.isEmpty()) {
      const tmp = path.join(os.tmpdir(), `pp-clip-${Date.now()}.png`)
      fs.writeFileSync(tmp, img.toPNG())
      try {
        const { asset } = await addFileToLibrary(ctx.lib, tmp)
        ctx.lib.flush()
        return asset
      } finally {
        try {
          fs.rmSync(tmp, { force: true })
        } catch {
          /* ignore */
        }
      }
    }
    // 剪贴板里可能是文件路径（在资源管理器里复制文件）
    const text = clipboard.readText().trim()
    if (text) {
      const cand = text.replace(/^"|"$/g, '')
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        try {
          const { asset } = await addFileToLibrary(ctx.lib, cand)
          ctx.lib.flush()
          return asset
        } catch {
          return null
        }
      }
    }
    return null
  })

  ipcMain.handle('asset:reveal', (_e, assetId: string) => {
    const a = ctx.lib.getAsset(assetId)
    if (!a) return false
    shell.showItemInFolder(ctx.lib.abs(a.relPath))
    return true
  })

  ipcMain.handle('asset:repairAll', async () => {
    let fixed = 0
    for (const a of [...ctx.lib.data.assets]) {
      if (a.thumbRel && a.phash) continue
      await repairAsset(ctx.lib, a)
      fixed++
    }
    ctx.lib.flush()
    return { fixed }
  })

  /* ───────────── 重复检测 ───────────── */

  ipcMain.handle('dup:scan', (_e, threshold?: number) => {
    const t = typeof threshold === 'number' ? threshold : ctx.cfg.data.duplicateThreshold
    const report = scanDuplicates(ctx.lib, t)
    // 附带每条资源被引用的情况，便于界面显示
    const usage: Record<string, string[]> = {}
    for (const e of ctx.lib.data.entries) {
      for (const id of e.assetIds) {
        ;(usage[id] ??= []).push(e.title)
      }
    }
    return { ...report, usage }
  })

  ipcMain.handle('dup:compare', (_e, a: string, b: string) => {
    const aa = ctx.lib.getAsset(a)
    const bb = ctx.lib.getAsset(b)
    if (!aa?.phash || !bb?.phash) return 64
    return hammingHex(aa.phash, bb.phash)
  })

  /** 清理重复媒体：保留 keepAssetId，删除 restAssetIds */
  ipcMain.handle('dup:resolve', (_e, keepAssetId: string, restAssetIds: string[]) => {
    const r = ctx.lib.deleteAssets(restAssetIds)
    ctx.lib.flush()
    return r
  })

  /* ───────────── 分享包 ───────────── */

  ipcMain.handle('pack:export', async (_e, opts: { entryIds: string[]; includeMedia: boolean; suggestedName?: string }) => {
    const collName = opts.suggestedName

    // 自动化验收钩子：设置 PP_EXPORT_TO 时跳过保存对话框直接写指定路径
    let out = process.env.PP_EXPORT_TO || ''
    if (!out) {
      const save = await saveDialog(ctx, {
        title: '导出分享包',
        defaultPath: path.join(
          app.getPath('downloads'),
          defaultPackName(ctx.lib, collName)
        ),
        filters: [{ name: 'PromptPair 分享包', extensions: ['promptpack'] }]
      })
      if (save.canceled || !save.filePath) return null
      out = save.filePath.toLowerCase().endsWith('.promptpack')
        ? save.filePath
        : save.filePath + '.promptpack'
    }

    const exportOpts: ExportOptions = {
      entryIds: opts.entryIds,
      outPath: out,
      includeMedia: opts.includeMedia
    }

    const r = await exportPack(ctx.lib, exportOpts, { appVersion: APP_VERSION }, (p) => {
      send(ctx, 'pack:progress', p)
    })
    send(ctx, 'pack:done', r)
    return r
  })

  ipcMain.handle(
    'pack:exportHtml',
    async (_e, opts: { entryIds: string[]; embed: 'thumb' | 'full'; suggestedName?: string }) => {
      // 自动化验收钩子
      let out = process.env.PP_EXPORT_HTML_TO || ''
      if (!out) {
        const base = defaultPackName(ctx.lib, opts.suggestedName).replace(/\.promptpack$/i, '.html')
        const save = await saveDialog(ctx, {
          title: '导出单页 HTML',
          defaultPath: path.join(app.getPath('downloads'), base),
          filters: [{ name: 'HTML', extensions: ['html'] }]
        })
        if (save.canceled || !save.filePath) return null
        out = save.filePath.toLowerCase().endsWith('.html')
          ? save.filePath
          : save.filePath + '.html'
      }
      return exportSingleHtml(
        ctx.lib,
        { entryIds: opts.entryIds, outPath: out, embed: opts.embed },
        { appVersion: APP_VERSION }
      )
    }
  )

  ipcMain.handle('pack:import', async () => {
    const open = await openDialog(ctx, {
      title: '导入 PromptPair 分享包',
      properties: ['openFile'],
      filters: [{ name: 'PromptPair 分享包', extensions: ['promptpack', 'zip'] }]
    })
    if (open.canceled || !open.filePaths[0]) return null

    const mode = await messageBox(ctx, {
      type: 'question',
      title: '导入方式',
      message: '要把这个分享包合并到当前库，还是作为一个全新的库打开？',
      detail:
        '合并到当前库：内容并入现有素材库（同名标签/集合自动对齐，媒体按内容去重）。\n' +
        '作为新库打开：在「文档/PromptPair」下新建一个独立库，只包含这个分享包的内容。',
      buttons: ['合并到当前库', '作为新库打开', '取消'],
      defaultId: 0,
      cancelId: 2
    })
    if (mode.response === 2) return null

    if (mode.response === 1) {
      const target = await openDialog(ctx, {
        title: '选择新库要放在哪个文件夹',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: app.getPath('documents')
      })
      if (target.canceled || !target.filePaths[0]) return null
      const packBase = path.basename(open.filePaths[0]).replace(/\.promptpack$/i, '').replace(/\.zip$/i, '')
      const dir = path.join(target.filePaths[0], packBase)
      fs.mkdirSync(dir, { recursive: true })
      ctx.lib.flush()
      const next = ctx.setLib(new Library(dir))
      const r = await mergePack(next, open.filePaths[0])
      next.data.name = packBase
      next.flush()
      return { mode: 'new' as const, result: r, snapshot: snapshot(ctx) }
    }

    const r = await mergePack(ctx.lib, open.filePaths[0])
    ctx.lib.flush()
    return { mode: 'merge' as const, result: r }
  })

  ipcMain.handle('data:exportJson', async () => {
    const save = await saveDialog(ctx, {
      title: '导出全部数据为 JSON（备份用）',
      defaultPath: path.join(app.getPath('downloads'), `promptpair-backup-${Date.now()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (save.canceled || !save.filePath) return null
    exportJson(ctx.lib, save.filePath)
    return save.filePath
  })

  ipcMain.handle('data:exportCsv', async () => {
    const save = await saveDialog(ctx, {
      title: '导出提示词清单为 CSV（Excel 可打开）',
      defaultPath: path.join(app.getPath('downloads'), `promptpair-prompts-${Date.now()}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (save.canceled || !save.filePath) return null

    const tagName = (id: string): string => ctx.lib.data.tags.find((t) => t.id === id)?.name ?? ''
    const head = [
      '标题',
      '正向提示词',
      '负向提示词',
      '标签',
      '集合',
      '评分',
      '模型',
      '尺寸',
      'seed',
      '步数',
      'CFG',
      '采样器',
      '平台',
      '产物数',
      '创建时间'
    ]
    const esc = (v: unknown): string => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    const lines = [head.join(',')]
    for (const e of ctx.lib.data.entries) {
      lines.push(
        [
          e.title,
          e.positive,
          e.negative,
          e.tagIds.map(tagName).filter(Boolean).join(' '),
          e.collectionIds
            .map((c) => ctx.lib.data.collections.find((x) => x.id === c)?.name ?? '')
            .filter(Boolean)
            .join(' '),
          e.rating || '',
          e.params?.model ?? '',
          e.params?.width && e.params?.height ? `${e.params.width}x${e.params.height}` : '',
          e.params?.seed ?? '',
          e.params?.steps ?? '',
          e.params?.cfg ?? '',
          e.params?.sampler ?? '',
          e.source?.platform ?? '',
          e.assetIds.length,
          e.createdAt
        ]
          .map(esc)
          .join(',')
      )
    }
    // BOM 让 Excel 正确识别 UTF-8
    fs.writeFileSync(save.filePath, '\ufeff' + lines.join('\r\n'), 'utf8')
    return save.filePath
  })

  /* ───────────── 浏览器插件采集 ───────────── */

  const handleCapture = async (payload: CapturePayload) => {
    if (!payload) return { ok: false, message: '空请求' }

    let buffer: Buffer
    let ext = '.png'
    if (payload.dataUrl) {
      const r = dataUrlToBuffer(payload.dataUrl)
      buffer = r.buffer
      ext = r.ext
    } else if (payload.imageUrl) {
      const r = await fetchToBuffer(payload.imageUrl, payload.pageUrl)
      buffer = r.buffer
      ext = r.ext
    } else {
      return { ok: false, message: '没有拿到图片数据' }
    }

    const { entry } = await importCaptured(ctx.lib, ctx.cfg.data, {
      buffer,
      ext,
      fileName: `capture-${Date.now()}${ext}`,
      positive: payload.promptText ?? '',
      negative: payload.negativeText ?? '',
      platform: payload.platform,
      pageUrl: payload.pageUrl ?? '',
      pageTitle: payload.pageTitle ?? ''
    })
    ctx.lib.flush()
    send(ctx, 'capture:received', { entryId: entry.id, title: entry.title })
    return { ok: true, entryId: entry.id }
  }

  ipcMain.handle('capture:info', () => ({ port: getCapturePort() }))

  ipcMain.handle('capture:test', async () => {
    const port = getCapturePort()
    if (!port) return { ok: false, message: '采集服务未启动' }
    try {
      const res = await net.fetch(`http://127.0.0.1:${port}/ping`)
      return { ok: res.ok, port }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  })

  startCaptureServer(handleCapture).catch((e) => console.error('[capture] 启动失败', e))

  /* ───────────── 更新 ───────────── */

  ipcMain.handle('updater:status', () => getUpdateStatus())
  ipcMain.handle('updater:check', () => checkForUpdatesManually())
  ipcMain.handle('updater:install', () => quitAndInstall())

  /* ───────────── 系统 ───────────── */

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (/^https?:\/\//.test(url)) await shell.openExternal(url)
  })

  /** 打开浏览器插件所在目录（打包后位于 resources/extension） */
  ipcMain.handle('app:openExtensionFolder', async () => {
    const dir = app.isPackaged
      ? path.join(process.resourcesPath, 'extension')
      : path.join(app.getAppPath(), 'extension')
    if (!fs.existsSync(dir)) return { ok: false, path: dir, message: '找不到插件目录' }
    await shell.openPath(dir)
    return { ok: true, path: dir }
  })

  ipcMain.handle('shell:showItem', (_e, p: string) => {
    if (fs.existsSync(p)) shell.showItemInFolder(p)
  })

  ipcMain.handle('window:minimize', () => ctx.win?.minimize())
  ipcMain.handle('window:toggleMaximize', () => {
    if (!ctx.win) return
    if (ctx.win.isMaximized()) ctx.win.unmaximize()
    else ctx.win.maximize()
  })
  ipcMain.handle('window:close', () => ctx.win?.close())
  ipcMain.handle('window:isMaximized', () => ctx.win?.isMaximized() ?? false)
}
