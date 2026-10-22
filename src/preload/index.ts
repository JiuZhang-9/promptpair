import { contextBridge, ipcRenderer, webUtils } from 'electron'

/**
 * 渲染层唯一的对外通道。
 * 规则：渲染层拿不到 Node，所有文件系统/系统能力都必须经这里显式列出。
 * 新增能力时：① 这里加一个方法；② index.d.ts 补类型；③ main/ipc.ts 加 handle。
 */

const api = {
  /* 基础 */
  info: () => ipcRenderer.invoke('app:info'),
  getState: () => ipcRenderer.invoke('lib:get'),
  revealLibrary: () => ipcRenderer.invoke('lib:reveal'),
  chooseLibraryRoot: () => ipcRenderer.invoke('lib:chooseRoot') as Promise<string | null>,
  switchLibrary: (dir: string) => ipcRenderer.invoke('lib:switch', dir),
  resetLibrary: () => ipcRenderer.invoke('lib:resetToDefault'),

  /* 配置 */
  getConfig: () => ipcRenderer.invoke('config:get'),
  patchConfig: (patch: Record<string, unknown>) => ipcRenderer.invoke('config:patch', patch),

  /* 条目 */
  saveEntry: (draft: unknown) => ipcRenderer.invoke('entry:save', draft),
  deleteEntries: (ids: string[]) => ipcRenderer.invoke('entry:delete', ids) as Promise<{ deleted: number }>,
  batchPatch: (ids: string[], patch: unknown) =>
    ipcRenderer.invoke('entry:batch', ids, patch) as Promise<{ updated: number }>,

  /* 标签 / 集合 */
  createTag: (name: string, groupId: string) => ipcRenderer.invoke('tag:create', name, groupId),
  updateTag: (id: string, patch: unknown) => ipcRenderer.invoke('tag:update', id, patch),
  deleteTag: (id: string) => ipcRenderer.invoke('tag:delete', id),
  deleteTags: (ids: string[]) => ipcRenderer.invoke('tag:deleteMany', ids),
  mergeTags: (fromIds: string[], toId: string) =>
    ipcRenderer.invoke('tag:merge', fromIds, toId),
  createTagGroup: (name: string, color: string) => ipcRenderer.invoke('tagGroup:create', name, color),
  updateTagGroup: (id: string, patch: unknown) => ipcRenderer.invoke('tagGroup:update', id, patch),
  deleteTagGroup: (id: string) => ipcRenderer.invoke('tagGroup:delete', id),
  createCollection: (name: string, color: string) =>
    ipcRenderer.invoke('collection:create', name, color),
  updateCollection: (id: string, patch: unknown) => ipcRenderer.invoke('collection:update', id, patch),
  deleteCollection: (id: string) => ipcRenderer.invoke('collection:delete', id),

  /* 导入 */
  pickFiles: () => ipcRenderer.invoke('import:pickFiles') as Promise<string[]>,
  pickFolder: () => ipcRenderer.invoke('import:pickFolder') as Promise<string[]>,
  importPaths: (paths: string[], opts?: unknown) => ipcRenderer.invoke('import:paths', paths, opts),

  /* 媒体 */
  addAssets: (paths: string[]) => ipcRenderer.invoke('asset:add', paths),
  addFromClipboard: () => ipcRenderer.invoke('asset:fromClipboard'),
  revealAsset: (assetId: string) => ipcRenderer.invoke('asset:reveal', assetId),
  repairAssets: () => ipcRenderer.invoke('asset:repairAll') as Promise<{ fixed: number }>,

  /* 重复检测 */
  scanDuplicates: (threshold?: number) => ipcRenderer.invoke('dup:scan', threshold),
  compareAssets: (a: string, b: string) => ipcRenderer.invoke('dup:compare', a, b) as Promise<number>,
  resolveDuplicates: (keepAssetId: string, restAssetIds: string[]) =>
    ipcRenderer.invoke('dup:resolve', keepAssetId, restAssetIds) as Promise<{
      removed: number
      affectedEntries: number
    }>,

  /* 分享包 */
  exportPack: (opts: unknown) => ipcRenderer.invoke('pack:export', opts),
  exportHtml: (opts: unknown) => ipcRenderer.invoke('pack:exportHtml', opts),
  importPack: () => ipcRenderer.invoke('pack:import'),
  exportJson: () => ipcRenderer.invoke('data:exportJson') as Promise<string | null>,
  exportCsv: () => ipcRenderer.invoke('data:exportCsv') as Promise<string | null>,

  /* 采集 */
  captureInfo: () => ipcRenderer.invoke('capture:info') as Promise<{ port: number }>,
  captureTest: () => ipcRenderer.invoke('capture:test'),

  /* AI 辅助打标（可选） */
  aiSuggestTags: (entryIds: string[]) => ipcRenderer.invoke('ai:suggestTags', entryIds),
  aiTest: () => ipcRenderer.invoke('ai:test'),
  aiApplyTags: (assignments: unknown) => ipcRenderer.invoke('ai:applyTags', assignments),

  /* 更新 */
  updaterStatus: () => ipcRenderer.invoke('updater:status'),
  checkUpdate: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  /* 系统 */
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openExtensionFolder: () =>
    ipcRenderer.invoke('app:openExtensionFolder') as Promise<{
      ok: boolean
      path: string
      message?: string
    }>,
  showItem: (p: string) => ipcRenderer.invoke('shell:showItem', p),

  /* 窗口 */
  winMinimize: () => ipcRenderer.invoke('window:minimize'),
  winToggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  winClose: () => ipcRenderer.invoke('window:close'),
  winIsMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>,

  /** 拖拽进来的 File 对象 → 真实磁盘路径（Electron 32+ 必须走 webUtils） */
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  /* 事件订阅 —— 返回取消订阅函数 */
  on: (channel: string, cb: (payload: any) => void): (() => void) => {
    const allowed = new Set([
      'import:start',
      'import:progress',
      'import:done',
      'pack:progress',
      'pack:done',
      'updater:status',
      'capture:received',
      'theme:changed',
      'window:state'
    ])
    if (!allowed.has(channel)) throw new Error('非法事件：' + channel)
    const listener = (_e: unknown, payload: any): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('pp', api)

export type PpApi = typeof api
