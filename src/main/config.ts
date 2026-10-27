import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { AppConfig } from '../shared/types'

const DEFAULTS: Omit<AppConfig, 'libraryPath'> = {
  theme: 'system',
  thumbSize: 200,
  uiScale: 1,
  duplicateThreshold: 6,
  autoTagFromFolder: true,
  autoCreateTags: true,
  autoReadSidecar: true,
  autoGroupByStem: true,
  minimizeToTray: false,
  sidebarCollapsed: false,
  rightPanelCollapsed: false,
  packBaseExportedAt: '',
  packBasePackId: '',
  packBaseLibraryId: '',
  aiEnabled: false,
  aiBaseUrl: 'https://api.openai.com/v1',
  aiApiKey: '',
  aiModel: 'gpt-4o-mini'
}

export function defaultLibraryPath(): string {
  return path.join(app.getPath('documents'), 'PromptPair')
}

export class Config {
  private file: string
  data: AppConfig

  constructor() {
    this.file = path.join(app.getPath('userData'), 'config.json')
    this.data = this.load()
  }

  private load(): AppConfig {
    let raw: Partial<AppConfig> = {}
    try {
      if (fs.existsSync(this.file)) raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      raw = {}
    }
    const cfg: AppConfig = {
      ...DEFAULTS,
      ...raw,
      libraryPath: raw.libraryPath && raw.libraryPath.trim() ? raw.libraryPath : defaultLibraryPath()
    }
    // 0.6.0 把默认卡片宽度从 220 调到 200；只迁移还没保存过 uiScale 的旧配置，
    // 之后用户自己调过的值不再覆盖。
    if (raw.uiScale == null && raw.thumbSize === 220) cfg.thumbSize = 200
    const scale = Number(cfg.uiScale)
    cfg.uiScale = Number.isFinite(scale) ? Math.max(0.9, Math.min(1.1, scale)) : 1
    return cfg
  }

  save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
    } catch (e) {
      console.error('[config] 保存失败', e)
    }
  }

  patch(p: Partial<AppConfig>): AppConfig {
    const next = { ...p }
    if (next.uiScale != null) {
      const n = Number(next.uiScale)
      next.uiScale = Number.isFinite(n) ? Math.max(0.9, Math.min(1.1, n)) : 1
    }
    Object.assign(this.data, next)
    this.save()
    return this.data
  }
}
