import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  nativeTheme,
  protocol,
  screen,
  shell,
  Tray
} from 'electron'
import type { AppConfig, WindowBounds } from '../shared/types'
import { Library } from './library'
import { Config, defaultLibraryPath } from './config'
import { registerIpc, type AppCtx } from './ipc'
import { isCliRequest, runCli, handleForwardedAdd, queueForwarded, drainForwarded } from './cli'
import { initUpdater, onUpdateStatus } from './updater'
import { startCaptureServer, stopCaptureServer } from './capture'
import { applyTitleBarOverlay, applyUiScale, clampUiScale, TITLEBAR_HEIGHT } from './appearance'

// 自动化验收：CLI 使用隔离的 userData，避免和正在运行的 GUI 抢单实例锁
if (process.env.PP_CLI_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.PP_CLI_USER_DATA))
}

// ── CLI 模式：`--cli` 走无头命令行（复用库核心逻辑），不建窗口不装协议
const CLI_MODE = isCliRequest()
// 只有写操作（add 且非 dry-run）需要独占库；list / dry-run 只读，可与 GUI 并存
const CLI_WRITE = CLI_MODE && process.argv.includes('add') && !process.argv.includes('--dry-run')

// ── 单实例：第二次启动直接把已有窗口拉到前台，避免两个进程抢同一个库文件。
// 只读 CLI 不参与抢锁（避免把用户正开着的窗口拉到前台）
const gotLock = CLI_MODE && !CLI_WRITE ? true : app.requestSingleInstanceLock()
if (CLI_MODE) {
  // CLI 主实例（正在导入中）也可能收到后续转发：先排队，当前命令结束后顺次执行
  app.on('second-instance', (_e, argv) => {
    if (isCliRequest(argv)) queueForwarded(argv.slice(1))
  })
  if (CLI_WRITE && !gotLock) {
    // 抢锁失败 = 运行中的 PromptPair 持有库。Electron 已把本次 argv 通过
    // second-instance 转交给主实例，由它在自己进程内完成导入并刷新界面
    console.error('[cli] 检测到 PromptPair 正在运行，批次已转发给运行中的软件（导入完成后界面自动刷新）')
    setTimeout(() => app.exit(0), 400)
  } else {
    void runCli(process.argv.slice(2)).then(async (code) => {
      const failed = await drainForwarded()
      app.exit(failed > 0 ? 1 : code)
    })
  }
} else {
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
let tray: Tray | null = null
let quitting = false
let boundsTimer: NodeJS.Timeout | null = null

/** 开机自启由 `--hidden` 参数触发；普通双击启动不受 startMinimized 影响 */
const HIDDEN_START = process.argv.includes('--hidden')
const DEFAULT_WINDOW = { width: 1440, height: 900 }
const MIN_WINDOW = { width: 1040, height: 640 }

function displayForBounds(b: WindowBounds): Electron.Display | undefined {
  return screen.getAllDisplays().find((d) => {
    const a = d.workArea
    const ox = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x)
    const oy = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y)
    return ox >= 100 && oy >= 80
  })
}

/** 恢复上次窗口大小；显示器拔掉/分辨率变了就回到默认尺寸并居中 */
function restoreBounds(saved?: WindowBounds): {
  x?: number
  y?: number
  width: number
  height: number
} {
  const displays = screen.getAllDisplays()
  const fallbackW = Math.max(DEFAULT_WINDOW.width, ...displays.map((d) => d.workArea.width))
  const fallbackH = Math.max(DEFAULT_WINDOW.height, ...displays.map((d) => d.workArea.height))
  const target = saved ? displayForBounds(saved) : undefined
  const maxW = target?.workArea.width ?? fallbackW
  const maxH = target?.workArea.height ?? fallbackH
  const width = Math.max(MIN_WINDOW.width, Math.min(Math.round(saved?.width ?? DEFAULT_WINDOW.width), maxW))
  const height = Math.max(
    MIN_WINDOW.height,
    Math.min(Math.round(saved?.height ?? DEFAULT_WINDOW.height), maxH)
  )
  if (!saved || !target) return { width, height }
  return { x: Math.round(saved.x), y: Math.round(saved.y), width, height }
}

function persistWindowState(): void {
  if (!win || win.isDestroyed() || !ctx || win.isMinimized()) return
  const maximized = win.isMaximized()
  const b = maximized ? win.getNormalBounds() : win.getBounds()
  if (!b.width || !b.height) return
  ctx.cfg.patch({
    winBounds: { x: b.x, y: b.y, width: b.width, height: b.height },
    winMaximized: maximized
  })
}

function schedulePersistWindowState(): void {
  if (boundsTimer) clearTimeout(boundsTimer)
  boundsTimer = setTimeout(() => {
    boundsTimer = null
    persistWindowState()
  }, 500)
}

function trayIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../build/icon.png')
}

function ensureTray(): boolean {
  if (tray) return true
  try {
    let img = nativeImage.createFromPath(trayIconPath())
    if (img.isEmpty()) img = nativeImage.createFromPath(process.execPath)
    if (img.isEmpty()) return false
    tray = new Tray(img.resize({ width: 16, height: 16 }))
    tray.setToolTip('PromptPair')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => showMainWindow() },
        { type: 'separator' },
        {
          label: '退出 PromptPair',
          click: () => {
            quitting = true
            app.quit()
          }
        }
      ])
    )
    tray.on('click', () => showMainWindow())
    tray.on('double-click', () => showMainWindow())
    return true
  } catch (e) {
    console.error('[desktop] 托盘创建失败', e)
    return false
  }
}

function destroyTray(): void {
  if (!tray) return
  try {
    tray.destroy()
  } catch {
    /* ignore */
  }
  tray = null
}

function showMainWindow(): void {
  if (!win || win.isDestroyed()) {
    if (ctx) createWindow(ctx.cfg.data.uiScale ?? 1, false)
  } else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  syncDesktopPrefs()
}

function applyLoginItem(cfg: AppConfig): void {
  try {
    const extra = cfg.startMinimized ? ['--hidden'] : []
    if (process.defaultApp) {
      const appPath = path.resolve(process.argv[1] ?? '')
      app.setLoginItemSettings({
        openAtLogin: cfg.launchAtLogin,
        path: process.execPath,
        args: appPath ? [appPath, ...extra] : extra
      })
    } else {
      app.setLoginItemSettings({ openAtLogin: cfg.launchAtLogin, args: extra })
    }
  } catch (e) {
    console.error('[desktop] 开机自启设置失败', e)
  }
}

function syncDesktopPrefs(): void {
  if (!ctx) return
  applyLoginItem(ctx.cfg.data)
  const needTray =
    ctx.cfg.data.minimizeToTray || (!!win && !win.isVisible()) || HIDDEN_START
  if (needTray) ensureTray()
  else destroyTray()
}

function createWindow(uiScale = 1, startHidden = false): void {
  const isDark = nativeTheme.shouldUseDarkColors
  const bounds = restoreBounds(ctx?.cfg.data.winBounds)
  const wantMax = !!ctx?.cfg.data.winMaximized

  const winOpts: Electron.BrowserWindowConstructorOptions = {
    width: bounds.width,
    height: bounds.height,
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
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
  }
  if (bounds.x != null && bounds.y != null) {
    winOpts.x = bounds.x
    winOpts.y = bounds.y
  }
  win = new BrowserWindow(winOpts)

  // 页面缩放要在 load 之前应用，避免启动时先闪一下 100%。
  applyUiScale(win, clampUiScale(uiScale))

  win.once('ready-to-show', () => {
    if (wantMax) win?.maximize()
    if (startHidden) {
      // 托盘图标起不来时不要留一个看不见也点不到的进程
      if (!ensureTray()) win?.show()
    } else {
      win?.show()
    }
  })

  // 某些远程桌面 / 无 GPU 环境不会触发 ready-to-show，窗口会一直藏着。
  // 页面加载完成或 2 秒后仍不可见就强制显示，避免“启动了但没窗口”。
  const reveal = (): void => {
    if (!win || win.isDestroyed() || startHidden) return
    if (wantMax) win.maximize()
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

  win.on('resize', schedulePersistWindowState)
  win.on('move', schedulePersistWindowState)
  win.on('maximize', () => {
    schedulePersistWindowState()
    win?.webContents.send('window:state', { maximized: true })
  })
  win.on('unmaximize', () => {
    schedulePersistWindowState()
    win?.webContents.send('window:state', { maximized: false })
  })
  win.on('show', () => syncDesktopPrefs())
  win.on('hide', () => {
    if (!quitting) ensureTray()
  })

  win.on('close', (e) => {
    persistWindowState()
    if (!quitting && ctx?.cfg.data.minimizeToTray) {
      e.preventDefault()
      win?.hide()
      ensureTray()
    }
  })

  win.on('closed', () => {
    win = null
  })
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
    cfg,
    syncDesktop: syncDesktopPrefs
  }

  applyLoginItem(cfg.data)
  registerMediaProtocol(() => lib)
  createWindow(ctx.cfg.data.uiScale ?? 1, HIDDEN_START)
  registerIpc(ctx)

  nativeTheme.on('updated', () => {
    applyTitleBarOverlay(win, ctx?.cfg.data.uiScale ?? 1)
    win?.webContents.send('theme:changed', { dark: nativeTheme.shouldUseDarkColors })
  })

  onUpdateStatus((s) => win?.webContents.send('updater:status', s))
  initUpdater(win)

  // 退出前确保库落盘
  const flush = (): void => {
    quitting = true
    persistWindowState()
    destroyTray()
    try {
      lib?.dispose()
    } catch {
      /* ignore */
    }
    stopCaptureServer()
  }
  app.on('before-quit', flush)
  process.on('exit', flush)

  app.on('second-instance', (_e, argv) => {
    // 运行中的软件接管 CLI 写命令：自己进程内导入，完成后界面自动刷新
    if (isCliRequest(argv)) {
      void handleForwardedAdd(argv, { lib, win })
      return
    }
    showMainWindow()
  })

  app.on('activate', () => {
    showMainWindow()
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
} // end: GUI 模式分支（CLI 模式在 runCli 里自行退出）

// 供 ipc.ts 使用的路径工具（避免循环依赖）
export function fileUrl(p: string): string {
  return pathToFileURL(p).toString()
}
