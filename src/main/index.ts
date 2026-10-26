import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import electron, { app, BrowserWindow, nativeTheme, protocol, shell } from 'electron'
import { Library } from './library'
import { Config, defaultLibraryPath } from './config'
import { registerIpc, type AppCtx } from './ipc'
import { initUpdater, onUpdateStatus } from './updater'
import { startCaptureServer, stopCaptureServer } from './capture'
import { applyTitleBarOverlay, applyUiScale, clampUiScale, TITLEBAR_HEIGHT } from './appearance'

// ── 单实例：第二次启动直接把已有窗口拉到前台，避免两个进程抢同一个库文件
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ppmedia',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska'
}

let win: BrowserWindow | null = null
let ctx: AppCtx | null = null

function createWindow(uiScale = 1): void {
  const isDark = nativeTheme.shouldUseDarkColors

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 640,
    show: false,
    backgroundColor: isDark ? '#131315' : '#f7f7f8',
    title: 'PromptPair',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: isDark ? '#131315' : '#f7f7f8',
      symbolColor: isDark ? '#8a8b91' : '#6f7077',
      height: TITLEBAR_HEIGHT
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  // 页面缩放要在 load 之前应用，避免启动时先闪一下 100%。
  applyUiScale(win, clampUiScale(uiScale))

  win.once('ready-to-show', () => win?.show())

  // 某些远程桌面 / 无 GPU 环境不会触发 ready-to-show，窗口会一直藏着。
  // 页面加载完成或 2 秒后仍不可见就强制显示，避免“启动了但没窗口”。
  const reveal = (): void => {
    if (!win || win.isDestroyed()) return
    if (!win.isVisible()) win.show()
  }
  win.webContents.once('did-finish-load', () => {
    applyUiScale(win, ctx?.cfg.data.uiScale ?? 1)
    reveal()
  })
  setTimeout(reveal, 2000)

  // 外链走系统浏览器，不在应用内开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 禁止应用内导航到外部站点
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (dev && url.startsWith(dev)) return
    if (url.startsWith('file://')) return
    e.preventDefault()
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    win = null
  })

  win.on('maximize', () => win?.webContents.send('window:state', { maximized: true }))
  win.on('unmaximize', () => win?.webContents.send('window:state', { maximized: false }))
}

/** 自定义协议：ppmedia://media/<assetId> 与 ppmedia://thumb/<assetId> */
function registerMediaProtocol(getLib: () => Library | null): void {
  protocol.handle('ppmedia', async (request) => {
    try {
      const lib = getLib()
      if (!lib) return new Response('no library', { status: 503 })

      const u = new URL(request.url)
      const kind = u.hostname // media | thumb | abs
      const id = decodeURIComponent(u.pathname.replace(/^\//, ''))

      let absPath: string
      if (kind === 'abs') {
        // 仅用于渲染层预览「尚未入库」的临时文件，限制在系统临时目录与用户选择的路径内
        absPath = decodeURIComponent(u.searchParams.get('p') ?? '')
        if (!absPath || !fs.existsSync(absPath)) return new Response('not found', { status: 404 })
      } else {
        const asset = lib.getAsset(id)
        if (!asset) return new Response('asset not found', { status: 404 })
        const rel = kind === 'thumb' ? asset.thumbRel || asset.relPath : asset.relPath
        absPath = lib.abs(rel)
      }

      if (!fs.existsSync(absPath)) return new Response('file missing', { status: 404 })

      const stat = fs.statSync(absPath)
      const ext = path.extname(absPath).toLowerCase()
      const type = MIME[ext] ?? 'application/octet-stream'
      const range = request.headers.get('Range')

      // 视频拖动进度需要 Range 支持
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        if (m) {
          const start = m[1] ? parseInt(m[1], 10) : 0
          const end = m[2] ? parseInt(m[2], 10) : stat.size - 1
          if (start >= stat.size) {
            return new Response('range not satisfiable', {
              status: 416,
              headers: { 'Content-Range': `bytes */${stat.size}` }
            })
          }
          const safeEnd = Math.min(end, stat.size - 1)
          const stream = fs.createReadStream(absPath, { start, end: safeEnd })
          return new Response(Readable.toWeb(stream) as ReadableStream, {
            status: 206,
            headers: {
              'Content-Type': type,
              'Content-Length': String(safeEnd - start + 1),
              'Content-Range': `bytes ${start}-${safeEnd}/${stat.size}`,
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'no-cache'
            }
          })
        }
      }

      const stream = fs.createReadStream(absPath)
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      })
    } catch (e) {
      return new Response('error: ' + (e as Error).message, { status: 500 })
    }
  })
}

function openLibrary(p: string): Library {
  return new Library(p)
}

app.whenReady().then(async () => {
  const cfg = new Config()

  // 库目录可能被用户删掉/移动 → 兜底重建默认库
  let libPath = cfg.data.libraryPath
  try {
    fs.mkdirSync(libPath, { recursive: true })
  } catch {
    libPath = defaultLibraryPath()
    fs.mkdirSync(libPath, { recursive: true })
    cfg.patch({ libraryPath: libPath })
  }

  let lib: Library
  try {
    lib = openLibrary(libPath)
  } catch (e) {
    // 库损坏且无法恢复：退到默认库，把损坏信息抛给界面
    console.error('[main] 库加载失败', e)
    lib = openLibrary(defaultLibraryPath())
    cfg.patch({ libraryPath: defaultLibraryPath() })
  }

  nativeTheme.themeSource = cfg.data.theme

  ctx = {
    get win() {
      return win
    },
    get lib() {
      return lib
    },
    setLib(next: Library) {
      lib?.dispose()
      lib = next
      cfg.patch({ libraryPath: next.root })
      return lib
    },
    cfg
  }

  registerMediaProtocol(() => lib)
  createWindow(ctx.cfg.data.uiScale ?? 1)
  registerIpc(ctx)

  nativeTheme.on('updated', () => {
    applyTitleBarOverlay(win, ctx?.cfg.data.uiScale ?? 1)
    win?.webContents.send('theme:changed', { dark: nativeTheme.shouldUseDarkColors })
  })

  onUpdateStatus((s) => win?.webContents.send('updater:status', s))
  initUpdater(win)

  // 退出前确保库落盘
  const flush = (): void => {
    try {
      lib?.dispose()
    } catch {
      /* ignore */
    }
    stopCaptureServer()
  }
  app.on('before-quit', flush)
  process.on('exit', flush)

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  try {
    ctx?.lib?.dispose()
  } catch {
    /* ignore */
  }
  if (process.platform !== 'darwin') app.quit()
})

// 供 ipc.ts 使用的路径工具（避免循环依赖）
export function fileUrl(p: string): string {
  return pathToFileURL(p).toString()
}
