import { app, BrowserWindow, dialog } from 'electron'
import type { UpdateStatus } from '../shared/types'

let autoUpdaterRef: any = null
let current: UpdateStatus = { state: 'idle' }
let emitter: ((s: UpdateStatus) => void) | null = null

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
    autoUpdater.on('error', (err: any) =>
      push({ state: 'error', message: String(err?.message ?? err) })
    )

    const check = (): void => {
      autoUpdater.checkForUpdates().catch((e: any) => {
        push({ state: 'error', message: String(e?.message ?? e) })
      })
    }

    setTimeout(check, 8000)
    setInterval(check, 4 * 60 * 60 * 1000)
  } catch (e) {
    push({ state: 'error', message: '更新模块加载失败：' + (e as Error).message })
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
    push({ state: 'error', message: String((e as Error)?.message ?? e) })
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
