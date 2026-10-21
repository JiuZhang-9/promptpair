import { create } from 'zustand'
import type {
  AppConfig,
  Asset,
  BatchPatch,
  Collection,
  EntryDraft,
  ImportResult,
  LibraryData,
  PromptEntry,
  Tag,
  TagGroup,
  UpdateStatus
} from '../../shared/types'
import type { DupReport, ImportOptions, LibrarySnapshot } from '../../preload/index.d'

export type SortKey = 'newest' | 'oldest' | 'rating' | 'title' | 'assets'
export type KindFilter = 'all' | 'image' | 'video'
export type PanelKind = 'none' | 'settings' | 'dups' | 'tags'
export type BatchTagModal = 'none' | 'add' | 'remove'

export interface Toast {
  id: string
  text: string
  kind: 'info' | 'ok' | 'err'
}

interface ImportUiState {
  active: boolean
  done: number
  total: number
  current: string
}

export interface StoreState {
  ready: boolean
  fatal: string | null
  data: LibraryData
  root: string
  config: AppConfig
  version: string
  capturePort: number

  /* 筛选 */
  q: string
  collectionId: string | null
  tagIds: string[]
  tagMode: 'or' | 'and'
  ratingMin: number
  onlyFavorite: boolean
  kind: KindFilter
  platform: string | null

  /* 展示 */
  sort: SortKey
  thumbSize: number
  panel: PanelKind
  batchTagModal: BatchTagModal
  shortcutsOpen: boolean
  sidebarCollapsed: boolean
  rightPanelCollapsed: boolean

  /* 交互 */
  selectedIds: string[]
  anchorId: string | null
  /** 键盘焦点：与 selectedIds 分开，J/K 只移动它，Space 才切换选中 */
  focusIndex: number | null
  detailId: string | null
  editorOpen: boolean
  draft: EntryDraft | null
  dupReport: DupReport | null

  toasts: Toast[]
  importing: ImportUiState
  update: UpdateStatus
  systemDark: boolean

  /* actions */
  init: () => Promise<void>
  refresh: (snap?: LibrarySnapshot) => Promise<void>
  applyConfig: (patch: Partial<AppConfig>) => Promise<void>

  setQ: (v: string) => void
  setCollection: (id: string | null) => void
  toggleTag: (id: string) => void
  clearTags: () => void
  setTagMode: (m: 'or' | 'and') => void
  setRatingMin: (n: number) => void
  toggleFavorite: () => void
  setKind: (k: KindFilter) => void
  setPlatform: (p: string | null) => void
  setSort: (s: SortKey) => void
  setThumbSize: (n: number) => void
  resetFilters: () => void
  setPanel: (p: PanelKind) => void
  setBatchTagModal: (m: BatchTagModal) => void
  setShortcutsOpen: (v: boolean) => void
  setSidebarCollapsed: (v: boolean) => void
  setRightPanelCollapsed: (v: boolean) => void
  toggleSidebar: () => void
  toggleRightPanel: () => void

  select: (id: string | null, opts?: { additive?: boolean; range?: boolean }) => void
  selectMany: (ids: string[]) => void
  clearSelection: () => void
  setFocusIndex: (i: number | null) => void
  moveFocus: (delta: number) => void
  toggleFocusSelection: () => void
  selectAllFiltered: () => void
  openDetail: (id: string | null) => void

  startCreate: (assetIds?: string[]) => void
  startEdit: (id: string) => void
  closeEditor: () => void
  setDraft: (d: EntryDraft | null) => void
  saveDraft: () => Promise<boolean>
  removeEntries: (ids: string[]) => Promise<void>
  patchEntries: (ids: string[], patch: BatchPatch) => Promise<void>

  doImport: (paths: string[], opts?: ImportOptions) => Promise<ImportResult | null>
  importDialog: (mode: 'files' | 'folder') => Promise<void>
  exportPack: (ids: string[], includeMedia: boolean, name?: string) => Promise<void>
  importPackDialog: () => Promise<void>
  scanDups: () => Promise<void>
  checkUpdate: () => Promise<void>
  installUpdate: () => Promise<void>

  toast: (text: string, kind?: Toast['kind']) => void
  dropToast: (id: string) => void
}

const EMPTY_LIB: LibraryData = {
  schemaVersion: 1,
  id: '',
  name: '',
  createdAt: '',
  updatedAt: '',
  entries: [],
  assets: [],
  tagGroups: [],
  tags: [],
  collections: []
}

const EMPTY_CFG: AppConfig = {
  libraryPath: '',
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
  aiBaseUrl: '',
  aiApiKey: '',
  aiModel: ''
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

let thumbPersistTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<StoreState>((set, get) => ({
  ready: false,
  fatal: null,
  data: EMPTY_LIB,
  root: '',
  config: EMPTY_CFG,
  version: '',
  capturePort: 0,

  q: '',
  collectionId: null,
  tagIds: [],
  tagMode: 'or',
  ratingMin: 0,
  onlyFavorite: false,
  kind: 'all',
  platform: null,

  sort: 'newest',
  thumbSize: 220,
  panel: 'none',
  batchTagModal: 'none',
  shortcutsOpen: false,
  sidebarCollapsed: false,
  rightPanelCollapsed: false,

  selectedIds: [],
  anchorId: null,
  focusIndex: null,
  detailId: null,
  editorOpen: false,
  draft: null,
  dupReport: null,

  toasts: [],
  importing: { active: false, done: 0, total: 0, current: '' },
  update: { state: 'idle' },
  systemDark: true,

  async init() {
    try {
      const snap = (await window.pp.getState()) as LibrarySnapshot
      set({
        ready: true,
        data: snap.data,
        root: snap.root,
        config: snap.config,
        version: snap.version,
        capturePort: snap.capturePort,
        thumbSize: snap.config.thumbSize || 220,
        sidebarCollapsed: snap.config.sidebarCollapsed ?? false,
        rightPanelCollapsed: snap.config.rightPanelCollapsed ?? false
      })

      // 主题：跟随系统
      const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
      set({ systemDark: dark })
      applyTheme(snap.config.theme, dark)

      window.pp.on('import:progress', (p: any) =>
        set((s) => ({
          importing: { active: true, done: p.done, total: p.total, current: p.current ?? '' }
        }))
      )
      window.pp.on('import:done', (r: ImportResult) => {
        set({ importing: { active: false, done: 0, total: 0, current: '' } })
        const parts = [`新增 ${r.createdEntries} 条记录`, `入库 ${r.importedAssets} 个文件`]
        if (r.reusedAssets) parts.push(`跳过重复 ${r.reusedAssets}`)
        if (r.createdTags.length) parts.push(`新建标签 ${r.createdTags.length}`)
        get().toast(parts.join(' · '), 'ok')
        if (r.failed.length) get().toast(`${r.failed.length} 个文件导入失败`, 'err')
        void get().refresh()
      })
      window.pp.on('capture:received', (p: any) => {
        get().toast(`已采集：${p.title}`, 'ok')
        void get().refresh()
      })
      window.pp.on('updater:status', (s: UpdateStatus) => set({ update: s }))
      window.pp.on('theme:changed', ({ dark }: any) => {
        set({ systemDark: dark })
        applyTheme(get().config.theme, dark)
      })
      window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
        set({ systemDark: e.matches })
        applyTheme(get().config.theme, e.matches)
      })

      const us = (await window.pp.updaterStatus()) as UpdateStatus
      set({ update: us })
    } catch (e) {
      set({ ready: true, fatal: (e as Error).message })
    }
  },

  async refresh(snap) {
    const s = snap ?? ((await window.pp.getState()) as LibrarySnapshot)
    set((st) => ({
      data: s.data,
      root: s.root,
      config: s.config,
      version: s.version,
      capturePort: s.capturePort,
      sidebarCollapsed: s.config.sidebarCollapsed ?? st.sidebarCollapsed,
      rightPanelCollapsed: s.config.rightPanelCollapsed ?? st.rightPanelCollapsed,
      // 清理已不存在的选中项
      selectedIds: st.selectedIds.filter((id) => s.data.entries.some((e) => e.id === id)),
      detailId: st.detailId && s.data.entries.some((e) => e.id === st.detailId) ? st.detailId : null
    }))
  },

  async applyConfig(patch) {
    const cfg = (await window.pp.patchConfig(patch as Record<string, unknown>)) as AppConfig
    set({ config: cfg })
    if (patch.theme) applyTheme(cfg.theme, get().systemDark)
    if (typeof patch.thumbSize === 'number') set({ thumbSize: patch.thumbSize })
    if (typeof patch.sidebarCollapsed === 'boolean') set({ sidebarCollapsed: patch.sidebarCollapsed })
    if (typeof patch.rightPanelCollapsed === 'boolean')
      set({ rightPanelCollapsed: patch.rightPanelCollapsed })
  },

  setQ: (v) => set({ q: v }),
  setCollection: (id) => set({ collectionId: id }),
  toggleTag: (id) =>
    set((s) => ({
      tagIds: s.tagIds.includes(id) ? s.tagIds.filter((t) => t !== id) : [...s.tagIds, id]
    })),
  clearTags: () => set({ tagIds: [] }),
  setTagMode: (m) => set({ tagMode: m }),
  setRatingMin: (n) => set({ ratingMin: n }),
  toggleFavorite: () => set((s) => ({ onlyFavorite: !s.onlyFavorite })),
  setKind: (k) => set({ kind: k }),
  setPlatform: (p) => set({ platform: p }),
  setSort: (s) => set({ sort: s }),
  setThumbSize: (n) => {
    const next = Math.max(120, Math.min(380, Math.round(n)))
    set({ thumbSize: next })
    // 连续 Ctrl+滚轮时不要每一格都写盘
    if (thumbPersistTimer) clearTimeout(thumbPersistTimer)
    thumbPersistTimer = setTimeout(() => {
      thumbPersistTimer = null
      void window.pp.patchConfig({ thumbSize: next })
    }, 220)
  },
  resetFilters: () =>
    set({
      q: '',
      collectionId: null,
      tagIds: [],
      ratingMin: 0,
      onlyFavorite: false,
      kind: 'all',
      platform: null
    }),
  setPanel: (p) => {
    if (p === 'settings' || p === 'none') {
      set({ panel: p })
      return
    }
    const wasCollapsed = get().rightPanelCollapsed
    set({ panel: p, detailId: null, rightPanelCollapsed: false })
    if (wasCollapsed) void window.pp.patchConfig({ rightPanelCollapsed: false })
  },
  setBatchTagModal: (m) => set({ batchTagModal: m }),
  setShortcutsOpen: (v) => set({ shortcutsOpen: v }),
  setSidebarCollapsed: (v) => {
    set({ sidebarCollapsed: v })
    void window.pp.patchConfig({ sidebarCollapsed: v })
  },
  setRightPanelCollapsed: (v) => {
    set({ rightPanelCollapsed: v })
    void window.pp.patchConfig({ rightPanelCollapsed: v })
  },
  toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),
  toggleRightPanel: () => {
    const s = get()
    const hasRight = !!s.detailId || s.panel === 'dups' || s.panel === 'tags'
    if (hasRight) {
      get().setRightPanelCollapsed(!s.rightPanelCollapsed)
      return
    }
    // 右栏没内容：直接打开当前焦点/选中项的详情
    const list = selectEntries(s)
    const id = s.focusIndex != null ? list[s.focusIndex]?.id : s.selectedIds[0]
    if (id) {
      set({ detailId: id, panel: 'none', rightPanelCollapsed: false })
      if (s.rightPanelCollapsed) void window.pp.patchConfig({ rightPanelCollapsed: false })
    } else {
      s.toast('先选中一条记录，再展开右栏', 'info')
    }
  },

  select: (id, opts) => {
    const { selectedIds } = get()
    if (!id) {
      set({ selectedIds: [], anchorId: null, focusIndex: null })
      return
    }
    const list = selectEntries(get()).map((e) => e.id)
    const idx = list.indexOf(id)
    const anchor = get().anchorId

    if (opts?.range && anchor) {
      const a = list.indexOf(anchor)
      const b = idx
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        set({ selectedIds: list.slice(lo, hi + 1), focusIndex: idx })
        return
      }
    }
    if (opts?.additive) {
      set({
        selectedIds: selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id],
        anchorId: id,
        focusIndex: idx >= 0 ? idx : get().focusIndex
      })
      return
    }
    set({ selectedIds: [id], anchorId: id, focusIndex: idx >= 0 ? idx : null })
  },
  selectMany: (ids) => set({ selectedIds: ids, anchorId: ids[0] ?? null }),
  clearSelection: () =>
    set({ selectedIds: [], anchorId: null, focusIndex: null, batchTagModal: 'none' }),
  setFocusIndex: (i) => set({ focusIndex: i }),
  moveFocus: (delta) => {
    const list = selectEntries(get())
    if (!list.length) return
    const cur = get().focusIndex
    const next =
      cur == null
        ? delta > 0
          ? 0
          : list.length - 1
        : Math.max(0, Math.min(list.length - 1, cur + delta))
    set({ focusIndex: next })
  },
  toggleFocusSelection: () => {
    const s = get()
    const list = selectEntries(s)
    if (!list.length) return
    const idx = s.focusIndex == null ? 0 : Math.max(0, Math.min(list.length - 1, s.focusIndex))
    const id = list[idx].id
    set({
      focusIndex: idx,
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
      anchorId: id
    })
  },
  selectAllFiltered: () => {
    const ids = selectEntries(get()).map((e) => e.id)
    set({ selectedIds: ids, anchorId: ids[0] ?? null })
  },
  openDetail: (id) => {
    if (!id) {
      set({ detailId: null })
      return
    }
    const wasCollapsed = get().rightPanelCollapsed
    set({ detailId: id, panel: 'none', rightPanelCollapsed: false })
    if (wasCollapsed) void window.pp.patchConfig({ rightPanelCollapsed: false })
  },

  startCreate: (assetIds) =>
    set({
      editorOpen: true,
      draft: {
        title: '',
        positive: '',
        negative: '',
        note: '',
        rating: 0,
        favorite: false,
        collectionIds: get().collectionId ? [get().collectionId!] : [],
        tagIds: get().tagIds.slice(),
        assetIds: assetIds ?? [],
        params: {},
        source: {}
      }
    }),

  startEdit: (id) => {
    const e = get().data.entries.find((x) => x.id === id)
    if (!e) return
    set({
      editorOpen: true,
      detailId: null,
      draft: {
        id: e.id,
        title: e.title,
        positive: e.positive,
        negative: e.negative,
        note: e.note,
        rating: e.rating,
        favorite: e.favorite,
        collectionIds: [...e.collectionIds],
        tagIds: [...e.tagIds],
        assetIds: [...e.assetIds],
        params: { ...e.params },
        source: { ...e.source }
      }
    })
  },

  closeEditor: () => set({ editorOpen: false, draft: null }),

  setDraft: (d) => set({ draft: d }),

  async saveDraft() {
    const d = get().draft
    if (!d) return false
    if (!d.positive.trim() && !d.title.trim() && !d.assetIds.length) {
      get().toast('至少填一个标题、提示词，或拖入一个文件', 'err')
      return false
    }
    const payload: EntryDraft = {
      ...d,
      title: d.title.trim() || d.positive.trim().slice(0, 24) || '未命名'
    }
    try {
      await window.pp.saveEntry(payload)
      set({ editorOpen: false, draft: null })
      await get().refresh()
      get().toast('已保存', 'ok')
      return true
    } catch (e) {
      get().toast('保存失败：' + (e as Error).message, 'err')
      return false
    }
  },

  async removeEntries(ids) {
    if (!ids.length) return
    try {
      await window.pp.deleteEntries(ids)
      set((s) => ({
        selectedIds: s.selectedIds.filter((x) => !ids.includes(x)),
        detailId: ids.includes(s.detailId ?? '') ? null : s.detailId
      }))
      await get().refresh()
      get().toast(`已删除 ${ids.length} 条记录`, 'ok')
    } catch (e) {
      get().toast('删除失败：' + (e as Error).message, 'err')
    }
  },

  async patchEntries(ids, patch) {
    if (!ids.length) return
    try {
      const r = await window.pp.batchPatch(ids, patch)
      await get().refresh()
      get().toast(`已更新 ${r.updated} 条`, 'ok')
    } catch (e) {
      get().toast('批量修改失败：' + (e as Error).message, 'err')
    }
  },

  async doImport(paths, opts) {
    if (!paths.length) return null
    set({ importing: { active: true, done: 0, total: paths.length, current: '正在扫描…' } })
    try {
      const r = (await window.pp.importPaths(paths, opts)) as ImportResult
      return r
    } catch (e) {
      set({ importing: { active: false, done: 0, total: 0, current: '' } })
      get().toast('导入失败：' + (e as Error).message, 'err')
      return null
    }
  },

  async importDialog(mode) {
    const paths = mode === 'files' ? await window.pp.pickFiles() : await window.pp.pickFolder()
    if (!paths?.length) return
    await get().doImport(paths, { roots: paths })
  },

  async exportPack(ids, includeMedia, name) {
    try {
      const r = await window.pp.exportPack({ entryIds: ids, includeMedia, suggestedName: name })
      if (r) get().toast(`已导出 ${r.entries} 条记录（${(r.bytes / 1024 / 1024).toFixed(1)} MB）`, 'ok')
    } catch (e) {
      get().toast('导出失败：' + (e as Error).message, 'err')
    }
  },

  async importPackDialog() {
    try {
      const r = await window.pp.importPack()
      if (!r) return
      if (r.mode === 'new') {
        set({
          data: r.snapshot.data,
          root: r.snapshot.root,
          config: r.snapshot.config,
          selectedIds: [],
          detailId: null
        })
        get().toast(`已作为新库打开，导入 ${r.result.entries} 条`, 'ok')
      } else {
        await get().refresh()
        get().toast(`合并完成：${r.result.entries} 条记录`, 'ok')
      }
    } catch (e) {
      get().toast('导入分享包失败：' + (e as Error).message, 'err')
    }
  },

  async scanDups() {
    try {
      const r = (await window.pp.scanDuplicates()) as DupReport
      set({ dupReport: r, panel: 'dups' })
    } catch (e) {
      get().toast('检测失败：' + (e as Error).message, 'err')
    }
  },

  async checkUpdate() {
    const s = (await window.pp.checkUpdate()) as UpdateStatus
    set({ update: s })
    if (s.state === 'not-available') get().toast('已是最新版本', 'ok')
    else if (s.state === 'error') get().toast('检查更新失败：' + (s.message ?? ''), 'err')
    else if (s.message) get().toast(s.message, 'info')
  },

  async installUpdate() {
    await window.pp.installUpdate()
  },

  toast: (text, kind = 'info') => {
    const id = uid()
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
    setTimeout(() => get().dropToast(id), kind === 'err' ? 5200 : 2600)
  },
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

export function applyTheme(mode: AppConfig['theme'], systemDark: boolean): void {
  const dark = mode === 'dark' || (mode === 'system' && systemDark)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

/* ───────────── 派生数据 ───────────── */

export function assetMap(data: LibraryData): Map<string, Asset> {
  const m = new Map<string, Asset>()
  for (const a of data.assets) m.set(a.id, a)
  return m
}

export function tagMap(data: LibraryData): Map<string, Tag> {
  const m = new Map<string, Tag>()
  for (const t of data.tags) m.set(t.id, t)
  return m
}

export function groupMap(data: LibraryData): Map<string, TagGroup> {
  const m = new Map<string, TagGroup>()
  for (const g of data.tagGroups) m.set(g.id, g)
  return m
}

export function collMap(data: LibraryData): Map<string, Collection> {
  const m = new Map<string, Collection>()
  for (const c of data.collections) m.set(c.id, c)
  return m
}

/** 当前筛选与排序后的条目列表 —— 单一真相，侧栏计数与画廊共用 */
export function selectEntries(s: StoreState): PromptEntry[] {
  const { data, q, collectionId, tagIds, tagMode, ratingMin, onlyFavorite, kind, platform, sort } = s
  const assets = assetMap(data)
  const tags = tagMap(data)
  const query = q.trim().toLowerCase()

  const out: PromptEntry[] = []
  for (const e of data.entries) {
    if (collectionId && !e.collectionIds.includes(collectionId)) continue
    if (onlyFavorite && !e.favorite) continue
    if (ratingMin > 0 && e.rating < ratingMin) continue
    if (platform && (e.source?.platform ?? '') !== platform) continue

    if (kind !== 'all') {
      const has = e.assetIds.some((id) => assets.get(id)?.kind === kind)
      if (!has) continue
    }

    if (tagIds.length) {
      if (tagMode === 'and') {
        if (!tagIds.every((t) => e.tagIds.includes(t))) continue
      } else if (!tagIds.some((t) => e.tagIds.includes(t))) continue
    }

    if (query) {
      const names = e.tagIds.map((t) => tags.get(t)?.name ?? '').join(' ')
      const hay = [
        e.title,
        e.positive,
        e.negative,
        e.note,
        names,
        e.params?.model ?? '',
        e.params?.sampler ?? '',
        e.params?.seed ?? '',
        e.source?.platform ?? '',
        e.source?.originalName ?? ''
      ]
        .join(' \n ')
        .toLowerCase()
      if (!hay.includes(query)) continue
    }

    out.push(e)
  }

  switch (sort) {
    case 'oldest':
      out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      break
    case 'rating':
      out.sort((a, b) => b.rating - a.rating || b.createdAt.localeCompare(a.createdAt))
      break
    case 'title':
      out.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
      break
    case 'assets':
      out.sort((a, b) => b.assetIds.length - a.assetIds.length)
      break
    default:
      out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  return out
}

export function thumbUrl(a: Asset | undefined): string {
  if (!a) return ''
  return a.thumbRel ? `ppmedia://thumb/${a.id}` : `ppmedia://media/${a.id}`
}

export function mediaUrl(a: Asset | undefined): string {
  if (!a) return ''
  return `ppmedia://media/${a.id}`
}
