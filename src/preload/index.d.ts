import type {
  AiSuggestResult,
  AiTestResult,
  AppConfig,
  Asset,
  AssetTransform,
  BatchPatch,
  Collection,
  CollectionMergeResult,
  CollectionMoveResult,
  DuplicateGroup,
  EntryDraft,
  EntryPatch,
  ImportResult,
  LibraryData,
  ModelCapabilities,
  ModelKind,
  ModelPreset,
  PromptEntry,
  Tag,
  TagCandidateAssignment,
  TagGroup,
  TagMergeResult,
  SavedView,
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

export interface CompareGifResult {
  path: string
  bytes: number
  frames: number
  width: number
  height: number
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
  patchEntry(id: string, patch: EntryPatch): Promise<PromptEntry>

  createTag(name: string, groupId: string): Promise<Tag>
  updateTag(id: string, patch: { name?: string; groupId?: string }): Promise<Tag>
  deleteTag(id: string): Promise<boolean>
  deleteTags(ids: string[]): Promise<{ deleted: number }>
  mergeTags(fromIds: string[], toId: string): Promise<TagMergeResult>
  createModel(name: string, kind: ModelKind): Promise<ModelPreset>
  updateModel(
    id: string,
    patch: { name?: string; kind?: ModelKind; capabilities?: Partial<ModelCapabilities> },
    syncEntries?: boolean
  ): Promise<{ model: ModelPreset; affectedEntries: number }>
  deleteModel(id: string): Promise<ModelPreset>
  createView(input: Omit<SavedView, 'id' | 'createdAt' | 'updatedAt'>): Promise<SavedView>
  deleteView(id: string): Promise<void>
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
  moveCollectionContents(fromId: string, toId: string): Promise<CollectionMoveResult>
  mergeCollections(fromIds: string[], toId: string): Promise<CollectionMergeResult>

  pickFiles(): Promise<string[]>
  pickFolder(): Promise<string[]>
  importPaths(paths: string[], opts?: ImportOptions): Promise<ImportResult>

  addAssets(paths: string[]): Promise<Asset[]>
  addFromClipboard(): Promise<Asset | null>
  transformAsset(assetId: string, opts: AssetTransform): Promise<Asset>
  copyAssetImage(assetId: string): Promise<boolean>
  exportCompareGif(
    aId: string,
    bId: string,
    suggestedName?: string,
    outPath?: string
  ): Promise<CompareGifResult | null>
  exportAssetWithPrompt(
    assetId: string,
    text: string,
    suggestedName?: string,
    outPath?: string
  ): Promise<string | null>
  exportCompressedAsset(
    assetId: string,
    quality: number,
    suggestedName?: string,
    outPath?: string
  ): Promise<{ path: string; bytes: number } | null>
  revealAsset(assetId: string): Promise<boolean>
  saveAssetAs(assetId: string, suggestedName?: string): Promise<string | null>
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
    outPath?: string
    mode?: 'full' | 'incremental'
  }): Promise<{
    path: string
    entries: number
    assets: number
    bytes: number
    packId: string
    exportedAt: string
    mode: 'full' | 'incremental'
  } | null>
  exportSite(opts: {
    entryIds: string[]
    suggestedName?: string
    outPath?: string
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
  openLogs(): Promise<{ ok: boolean; path: string; message?: string }>
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
