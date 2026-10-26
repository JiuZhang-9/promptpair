import { BrowserWindow, nativeTheme } from 'electron'

/** 与 styles.css 的 .titlebar 高度保持一致 */
export const TITLEBAR_HEIGHT = 50

export function clampUiScale(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0.9, Math.min(1.1, n)) : 1
}

/**
 * 界面比例统一用页面缩放实现：它缩放所有 CSS px，不会破坏固定浮层、
 * 虚拟滚动和指针坐标；原生标题栏覆盖层要单独按比例调高。
 */
export function applyTitleBarOverlay(win: BrowserWindow | null, scale: number): void {
  if (!win || win.isDestroyed()) return
  const dark = nativeTheme.shouldUseDarkColors
  try {
    win.setTitleBarOverlay({
      color: dark ? '#131315' : '#f7f7f8',
      symbolColor: dark ? '#8a8b91' : '#6f7077',
      height: Math.round(TITLEBAR_HEIGHT * clampUiScale(scale))
    })
  } catch {
    /* 老系统不支持覆盖层时忽略 */
  }
}

export function applyUiScale(win: BrowserWindow | null, scale: number): void {
  if (!win || win.isDestroyed()) return
  const s = clampUiScale(scale)
  try {
    win.webContents.setZoomFactor(s)
  } catch {
    /* 页面还没 ready 时忽略，did-finish-load 还会再应用一次 */
  }
  applyTitleBarOverlay(win, s)
}
