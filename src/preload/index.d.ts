import type {
  AiSuggestResult,
  AiTestResult,
  AppConfig,
  Asset,
  BatchPatch,
  Collection,
  DuplicateGroup,
  EntryDraft,
  ImportResult,
  LibraryData,
  ModelKind,
  ModelPreset,
  PromptEntry,
  Tag,
  TagCandidateAssignment,
  TagGroup,
  TagMergeResult,
  UpdateStatus
} from '../shared/types'

export interface LibrarySnapshot {
  data: LibraryData
  root: string
  config: AppConfig
  version: string
  capturePort: number
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  userData: string
  isPackaged: boolean
}

export interface ImportOptions {
  platformOverride?: string
  collectionId?: string
  presetTags?: string[]
  roots?: string[]
  groupByStem?: boolean
  titleFrom?: 'filename' | 'prompt' | 'date'
}

export interface DupReport {
  groups: DuplicateGroup[]
  scanned: number
  skipped: number
  reclaimableBytes: number
  usage: Record<string, string[]>
}

export interface PpApi {
  info(): Promise<AppInfo>
  getState(): Promise<LibrarySnapshot>
  revealLibrary(): Promise<void>
  chooseLibraryRoot(): Promise<string | null>
  switchLibrary(dir: string): Promise<LibrarySnapshot>
  resetLibrary(): Promise<LibrarySnapshot>

  getConfig(): Promise<AppConfig>
  patchConfig(patch: Partial<AppConfig>): Promise<AppConfig>

  saveEntry(draft: EntryDraft): Promise<PromptEntry>
  deleteEntries(ids: string[]): Promise<{ deleted: number }>
  batchPatch(ids: string[], patch: BatchPatch): Promise<{ updated: number }>

  createTag(name: string, groupId: string): Promise<Tag>
  updateTag(id: string, patch: { name?: string; groupId?: string }): Promise<Tag>
  deleteTag(id: string): Promise<boolean>
  deleteTags(ids: string[]): Promise<{ deleted: number }>
  mergeTags(fromIds: string[], toId: string): Promise<TagMergeResult>
  createModel(name: string, kind: ModelKind): Promise<ModelPreset>
  updateModel(
    id: string,
    patch: { name?: string; kind?: ModelKind },
    syncEntries?: boolean
  ): Promise<{ model: ModelPreset; affectedEntries: number }>
  deleteModel(id: string): Promise<ModelPreset>
  mergeModels(
    fromIds: string[],
    toId: string,
    syncEntries?: boolean
  ): Promise<{ merged: number; affectedEntries: number; target: ModelPreset }>
  resetModels(): Promise<ModelPreset[]>
  createTagGroup(name: string, color: string): Promise<TagGroup>
  updateTagGroup(id: string, patch: { name?: string; color?: string }): Promise<TagGroup>
  deleteTagGroup(id: string): Promise<boolean>
  createCollection(name: string, color: string): Promise<Collection>
  updateCollection(id: string, patch: { name?: string; color?: string }): Promise<Collection>
  deleteCollection(id: string): Promise<boolean>

  pickFiles(): Promise<string[]>
  pickFolder(): Promise<string[]>
  importPaths(paths: string[], opts?: ImportOptions): Promise<ImportResult>

  addAssets(paths: string[]): Promise<Asset[]>
  addFromClipboard(): Promise<Asset | null>
  revealAsset(assetId: string): Promise<boolean>
  repairAssets(): Promise<{ fixed: number }>

  scanDuplicates(threshold?: number): Promise<DupReport>
  compareAssets(a: string, b: string): Promise<number>
  resolveDuplicates(
    keepAssetId: string,
    restAssetIds: string[]
  ): Promise<{ removed: number; affectedEntries: number }>

  exportPack(opts: {
    entryIds: string[]
    includeMedia: boolean
    suggestedName?: string
  }): Promise<{ path: string; entries: number; assets: number; bytes: number } | null>
  exportHtml(opts: {
    entryIds: string[]
    embed: 'thumb' | 'full'
    suggestedName?: string
  }): Promise<{ path: string; entries: number; assets: number; bytes: number } | null>
  importPack(): Promise<
    | { mode: 'merge'; result: { entries: number; assets: number; createdTags: string[] } }
    | { mode: 'new'; result: { entries: number; assets: number }; snapshot: LibrarySnapshot }
    | null
  >
  exportJson(): Promise<string | null>
  exportCsv(): Promise<string | null>

  captureInfo(): Promise<{ port: number }>
  captureTest(): Promise<{ ok: boolean; port?: number; message?: string }>

  aiSuggestTags(entryIds: string[]): Promise<AiSuggestResult>
  aiTest(): Promise<AiTestResult>
  aiApplyTags(
    assignments: TagCandidateAssignment[]
  ): Promise<{ updatedEntries: number; createdTags: string[] }>

  updaterStatus(): Promise<UpdateStatus>
  checkUpdate(): Promise<UpdateStatus>
  installUpdate(): Promise<void>

  openExternal(url: string): Promise<void>
  openExtensionFolder(): Promise<{ ok: boolean; path: string; message?: string }>
  showItem(p: string): Promise<void>

  winMinimize(): Promise<void>
  winToggleMaximize(): Promise<void>
  winClose(): Promise<void>
  winIsMaximized(): Promise<boolean>

  pathForFile(file: File): string

  on(channel: string, cb: (payload: any) => void): () => void
}

declare global {
  interface Window {
    pp: PpApi
  }
}

export type { Asset, PromptEntry, Tag, TagGroup, Collection, LibraryData, AppConfig }
