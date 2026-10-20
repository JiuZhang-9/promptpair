import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import type { UpdateStatus } from '../shared/types'

let autoUpdaterRef: any = null
let current: UpdateStatus = { state: 'idle' }
let emitter: ((s: UpdateStatus) => void) | null = null


/* ────────────── 诊断与容错 ────────────── */

/** 读打包时写进 resources/app-update.yml 的发布配置 */
function readUpdateConfig(): { owner?: string; repo?: string; provider?: string } | null {
  try {
    const p = path.join(process.resourcesPath, 'app-update.yml')
    if (!fs.existsSync(p)) return null
    const txt = fs.readFileSync(p, 'utf8')
    const pick = (k: string): string | undefined => {
      const m = new RegExp('^' + k + ':\\s*(.+)$', 'm').exec(txt)
      return m ? m[1].trim() : undefined
    }
    return { owner: pick('owner'), repo: pick('repo'), provider: pick('provider') }
  } catch {
    return null
  }
}

/** 占位符或明显没填的仓库地址 */
function isPlaceholderOwner(owner?: string): boolean {
  if (!owner) return true
  return /^(your_|YOUR_|xxx|<)/.test(owner) || /GITHUB_NAME|example|changeme/i.test(owner)
}

function logError(raw: string): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, 'updater.log')
    const line = `[${new Date().toISOString()}] ${raw}\n`
    // 超过 256KB 就重开，避免无限增长
    if (fs.existsSync(f) && fs.statSync(f).size > 256 * 1024) fs.writeFileSync(f, '')
    fs.appendFileSync(f, line, 'utf8')
  } catch {
    /* 写日志失败不影响主流程 */
  }
}

/**
 * 把 electron-updater 抛出的原始错误翻译成人话。
 * 它的 message 里往往裹着整页 HTML / 响应头，直接显示给用户既看不懂又毁界面。
 * 原始内容写入 userData/logs/updater.log 备查。
 */
export function humanizeError(err: unknown): string {
  const raw = String((err as any)?.message ?? err ?? '')
  logError(raw)

  if (/404/.test(raw) && /releases(\.atom|\/download)?/.test(raw))
    return '更新源地址不存在（这个安装包打包时的仓库配置不对），请到 Releases 页面下载正式安装包覆盖安装。'
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|ERR_NAME_NOT_RESOLVED/i.test(raw))
    return '域名解析失败，检查网络或代理设置。'
  if (/ETIMEDOUT|ERR_CONNECTION_TIMED_OUT|timeout/i.test(raw)) return '连接更新服务器超时。'
  if (/ECONNREFUSED|ECONNRESET|ERR_CONNECTION_(REFUSED|RESET)/i.test(raw)) return '连接被拒绝或中断。'
  if (/ERR_INTERNET_DISCONNECTED|offline/i.test(raw)) return '当前没有网络连接。'
  if (/net::ERR_/i.test(raw)) return '网络请求失败（' + (raw.match(/net::ERR_[A-Z_]+/)?.[0] ?? '未知') + '）。'

  // 兜底：只取第一行、去掉 HTML 标签、截断
  const first = raw
    .split('\n')[0]
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!first) return '未知错误'
  return first.length > 140 ? first.slice(0, 140) + '…' : first
}

function push(patch: Partial<UpdateStatus>): void {
  current = { ...current, ...patch }
  emitter?.(current)
}

export function onUpdateStatus(cb: (s: UpdateStatus) => void): void {
  emitter = cb
  cb(current)
}

export function getUpdateStatus(): UpdateStatus {
  return current
}

/**
 * 自动更新：基于 electron-updater + GitHub Releases。
 * 规则（与 docs/发布规范.md 一致）：
 *  - 只有「已打包」的版本才检查更新（开发态直接跳过）
 *  - 启动 8 秒后静默检查一次，之后每 4 小时一次
 *  - 有新版自动下载，下载完成后再由用户确认是否重启安装
 */
export function initUpdater(win: BrowserWindow | null): void {
  if (!app.isPackaged) {
    push({ state: 'idle', message: '开发模式不检查更新' })
    return
  }

  // 先看这个包到底被配成了哪个仓库。占位符地址会让检查永远 404，
  // 与其让用户看到一屏 HTML，不如直接说清楚。
  const cfg = readUpdateConfig()
  if (cfg && isPlaceholderOwner(cfg.owner)) {
    console.warn('[updater] 发布配置是占位符，跳过自动检查：owner=' + cfg.owner)
    push({
      state: 'error',
      message: '这个安装包没有配置更新源（打包时仓库地址还是占位符），请到 Releases 页面下载正式安装包覆盖安装一次。'
    })
    return
  }

  try {
    // 延迟引入，避免开发态缺少依赖时报错
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { autoUpdater } = require('electron-updater')
    autoUpdaterRef = autoUpdater
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = {
      info: (...a: any[]) => console.log('[updater]', ...a),
      warn: (...a: any[]) => console.warn('[updater]', ...a),
      error: (...a: any[]) => console.error('[updater]', ...a),
      debug: () => undefined
    } as any

    autoUpdater.on('checking-for-update', () => push({ state: 'checking', message: '正在检查更新…' }))
    autoUpdater.on('update-available', (info: any) =>
      push({ state: 'available', version: info?.version, message: `发现新版本 ${info?.version}` })
    )
    autoUpdater.on('update-not-available', () =>
      push({ state: 'not-available', message: '已是最新版本' })
    )
    autoUpdater.on('download-progress', (p: any) =>
      push({
        state: 'downloading',
        percent: Math.round(p?.percent ?? 0),
        message: `正在下载更新 ${Math.round(p?.percent ?? 0)}%`
      })
    )
    autoUpdater.on('update-downloaded', async (info: any) => {
      push({ state: 'downloaded', version: info?.version, message: `新版本 ${info?.version} 已就绪` })
      const parent = win ?? BrowserWindow.getAllWindows()[0]
      const r = await dialog.showMessageBox(parent, {
        type: 'info',
        title: '更新已就绪',
        message: `PromptPair ${info?.version} 已下载完成`,
        detail: '重启即可完成安装。你的素材库不会受任何影响。',
        buttons: ['立即重启', '稍后'],
        defaultId: 0,
        cancelId: 1
      })
      if (r.response === 0) {
        try {
          autoUpdater.quitAndInstall(false, true)
        } catch (e) {
          push({ state: 'error', message: (e as Error).message })
        }
      }
    })
    autoUpdater.on('error', (err: any) => push({ state: 'error', message: humanizeError(err) }))

    const check = (): void => {
      autoUpdater.checkForUpdates().catch((e: any) => {
        push({ state: 'error', message: humanizeError(e) })
      })
    }

    setTimeout(check, 8000)
    setInterval(check, 4 * 60 * 60 * 1000)
  } catch (e) {
    push({ state: 'error', message: '更新模块加载失败：' + humanizeError(e) })
  }
}

export async function checkForUpdatesManually(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    push({ state: 'not-available', message: '开发模式不检查更新' })
    return current
  }
  if (!autoUpdaterRef) {
    push({ state: 'error', message: '更新模块未初始化' })
    return current
  }
  try {
    push({ state: 'checking', message: '正在检查更新…' })
    const r = await autoUpdaterRef.checkForUpdates()
    if (!r) push({ state: 'not-available', message: '已是最新版本' })
  } catch (e) {
    push({ state: 'error', message: humanizeError(e) })
  }
  return current
}

export function quitAndInstall(): void {
  try {
    autoUpdaterRef?.quitAndInstall(false, true)
  } catch {
    /* ignore */
  }
}
