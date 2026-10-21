import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { AppConfig } from '../shared/types'

const DEFAULTS: Omit<AppConfig, 'libraryPath'> = {
  theme: 'system',
  thumbSize: 220,
  duplicateThreshold: 6,
  autoTagFromFolder: true,
  autoCreateTags: true,
  autoReadSidecar: true,
  autoGroupByStem: true,
  minimizeToTray: false,
  sidebarCollapsed: false,
  rightPanelCollapsed: false,
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
    Object.assign(this.data, p)
    this.save()
    return this.data
  }
}
