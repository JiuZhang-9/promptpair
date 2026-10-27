import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type {
  Asset,
  Collection,
  LibraryData,
  ModelKind,
  ModelPreset,
  PromptEntry,
  Tag,
  TagGroup,
  TagCandidateAssignment,
  TagMergeResult,
  EntryDraft,
  BatchPatch
} from '../shared/types'
import { DEFAULT_MODELS, DEFAULT_TAG_GROUPS, SCHEMA_VERSION } from '../shared/types'

function seedModels(): ModelPreset[] {
  return DEFAULT_MODELS.map((m) => ({ id: newId(), name: m.name, kind: m.kind, builtin: true }))
}

const LIB_FILE = 'library.json'
const LIB_BAK = 'library.json.bak'

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** 安全化文件名（导出/集合命名用） */
export function safeName(input: string, fallback = 'untitled'): string {
  const s = (input || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return s || fallback
}

function emptyLibrary(name: string): LibraryData {
  const t = nowIso()
  const tagGroups: TagGroup[] = DEFAULT_TAG_GROUPS.map((g, i) => ({
    id: newId(),
    name: g.name,
    color: g.color,
    order: i
  }))
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name,
    createdAt: t,
    updatedAt: t,
    entries: [],
    assets: [],
    tagGroups,
    tags: [],
    collections: [],
    models: seedModels()
  }
}

/* ────────────────────────── 迁移 ────────────────────────── */

type Migration = (d: any) => any

/** key = 目标版本。从 d.schemaVersion 逐级升到 SCHEMA_VERSION */
const MIGRATIONS: Record<number, Migration> = {
  // 示例：2: (d) => ({ ...d, newField: [] })
}

function migrate(raw: any): LibraryData {
  let d = raw
  let v = Number(d.schemaVersion) || 1
  while (v < SCHEMA_VERSION) {
    const next = v + 1
    const fn = MIGRATIONS[next]
    d = fn ? fn(d) : d
    d.schemaVersion = next
    v = next
  }
  // 补齐可能缺失的集合，避免运行时 undefined
  d.entries ??= []
  d.assets ??= []
  d.tagGroups ??= []
  d.tags ??= []
  d.collections ??= []
  // 老库没有模型词表：种入默认值；已有词表则补齐字段
  if (!Array.isArray(d.models) || d.models.length === 0) {
    d.models = seedModels()
  } else {
    d.models = d.models
      .filter((m: any) => m && typeof m.name === 'string' && m.name.trim())
      .map((m: any) => ({
        id: typeof m.id === 'string' && m.id ? m.id : newId(),
        name: String(m.name).trim(),
        kind: m.kind === 'image' || m.kind === 'video' ? m.kind : 'other',
        builtin: !!m.builtin
      }))
  }
  for (const e of d.entries) {
    e.tagIds ??= []
    e.collectionIds ??= []
    e.assetIds ??= []
    e.params ??= {}
    e.source ??= {}
    e.rating ??= 0
    e.favorite ??= false
  }
  return d as LibraryData
}

/* ────────────────────────── 库 ────────────────────────── */

export class Library {
  root: string
  data: LibraryData
  private saveTimer: NodeJS.Timeout | null = null
  private dirty = false

  constructor(root: string) {
    this.root = path.resolve(root)
    ensureDirs(this.root)
    this.data = this.load()
  }

  get filePath(): string {
    return path.join(this.root, LIB_FILE)
  }

  mediaDir(): string {
    return path.join(this.root, 'media')
  }

  thumbDir(): string {
    return path.join(this.root, 'thumbs')
  }

  abs(rel: string): string {
    return path.join(this.root, rel.replace(/\//g, path.sep))
  }

  private load(): LibraryData {
    if (!fs.existsSync(this.filePath)) {
      const lib = emptyLibrary(path.basename(this.root))
      fs.writeFileSync(this.filePath, JSON.stringify(lib, null, 2), 'utf8')
      return lib
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      return migrate(raw)
    } catch (err) {
      // 主文件损坏 → 尝试备份
      if (fs.existsSync(path.join(this.root, LIB_BAK))) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(this.root, LIB_BAK), 'utf8'))
          const d = migrate(raw)
          fs.writeFileSync(this.filePath, JSON.stringify(d, null, 2), 'utf8')
          return d
        } catch {
          /* ignore */
        }
      }
      throw new Error(
        `库文件无法读取：${this.filePath}\n${(err as Error).message}\n请检查文件是否为合法 JSON，或从备份恢复。`
      )
    }
  }

  /** 立即落盘（原子写 + 一份 .bak） */
  flush(): void {
    if (!this.dirty) return
    this.data.updatedAt = nowIso()
    const json = JSON.stringify(this.data, null, 2)
    const tmp = this.filePath + '.tmp'
    fs.writeFileSync(tmp, json, 'utf8')
    try {
      if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, path.join(this.root, LIB_BAK))
    } catch {
      /* 备份失败不阻塞主流程 */
    }
    fs.renameSync(tmp, this.filePath)
    this.dirty = false
  }

  /** 延迟落盘，避免高频写盘 */
  touch(): void {
    this.dirty = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      try {
        this.flush()
      } catch (e) {
        console.error('[library] 保存失败', e)
      }
    }, 250)
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.dirty = true
    try {
      this.flush()
    } catch {
      /* ignore */
    }
  }

  /* ── 查询 ── */
  getEntry(id: string): PromptEntry | undefined {
    return this.data.entries.find((e) => e.id === id)
  }

  getAsset(id: string): Asset | undefined {
    return this.data.assets.find((a) => a.id === id)
  }

  findAssetBySha(sha: string): Asset | undefined {
    return this.data.assets.find((a) => a.sha256 === sha)
  }

  /* ── 条目 ── */
  upsertEntry(draft: EntryDraft): PromptEntry {
    const t = nowIso()
    if (draft.id) {
      const cur = this.getEntry(draft.id)
      if (!cur) throw new Error('条目不存在：' + draft.id)
      Object.assign(cur, {
        title: draft.title,
        positive: draft.positive,
        negative: draft.negative,
        note: draft.note,
        rating: draft.rating,
        favorite: draft.favorite,
        collectionIds: [...new Set(draft.collectionIds)],
        tagIds: [...new Set(draft.tagIds)],
        assetIds: [...new Set(draft.assetIds)],
        params: draft.params,
        source: { ...cur.source, ...draft.source },
        updatedAt: t
      })
      this.touch()
      return cur
    }
    const entry: PromptEntry = {
      id: newId(),
      title: draft.title || '未命名',
      positive: draft.positive || '',
      negative: draft.negative || '',
      note: draft.note || '',
      rating: draft.rating || 0,
      favorite: !!draft.favorite,
      collectionIds: [...new Set(draft.collectionIds || [])],
      tagIds: [...new Set(draft.tagIds || [])],
      assetIds: [...new Set(draft.assetIds || [])],
      params: draft.params || {},
      source: draft.source || {},
      createdAt: t,
      updatedAt: t
    }
    this.data.entries.unshift(entry)
    this.touch()
    return entry
  }

  deleteEntries(ids: string[]): number {
    const set = new Set(ids)
    const before = this.data.entries.length
    this.data.entries = this.data.entries.filter((e) => !set.has(e.id))
    this.touch()
    this.gcOrphanAssets()
    return before - this.data.entries.length
  }

  batchPatch(ids: string[], patch: BatchPatch): number {
    const set = new Set(ids)
    const now = nowIso()
    let n = 0
    for (const e of this.data.entries) {
      if (!set.has(e.id)) continue
      n++
      if (patch.rating !== undefined) e.rating = patch.rating
      if (patch.favorite !== undefined) e.favorite = patch.favorite
      if (patch.addTagIds?.length) e.tagIds = [...new Set([...e.tagIds, ...patch.addTagIds])]
      if (patch.removeTagIds?.length) {
        const rm = new Set(patch.removeTagIds)
        e.tagIds = e.tagIds.filter((t) => !rm.has(t))
      }
      if (patch.addCollectionIds?.length)
        e.collectionIds = [...new Set([...e.collectionIds, ...patch.addCollectionIds])]
      if (patch.removeCollectionIds?.length) {
        const rm = new Set(patch.removeCollectionIds)
        e.collectionIds = e.collectionIds.filter((c) => !rm.has(c))
      }
      e.updatedAt = now
    }
    this.touch()
    return n
  }

  /* ── 资源 ── */
  addAsset(a: Asset): Asset {
    const exist = this.findAssetBySha(a.sha256)
    if (exist) return exist
    this.data.assets.push(a)
    this.touch()
    return a
  }

  /** 删除指定资源：从所有条目上摘掉引用 + 删文件 + 删元数据 */
  deleteAssets(ids: string[]): { removed: number; affectedEntries: number } {
    const set = new Set(ids)
    let affectedEntries = 0
    for (const e of this.data.entries) {
      if (!e.assetIds.some((id) => set.has(id))) continue
      const before = e.assetIds.length
      e.assetIds = e.assetIds.filter((id) => !set.has(id))
      if (e.assetIds.length !== before) {
        e.updatedAt = nowIso()
        affectedEntries++
      }
    }
    let removed = 0
    const keep: Asset[] = []
    for (const a of this.data.assets) {
      if (!set.has(a.id)) {
        keep.push(a)
        continue
      }
      try {
        const p = this.abs(a.relPath)
        if (fs.existsSync(p)) fs.rmSync(p, { force: true })
        if (a.thumbRel) {
          const tp = this.abs(a.thumbRel)
          if (fs.existsSync(tp)) fs.rmSync(tp, { force: true })
        }
      } catch {
        /* ignore */
      }
      removed++
    }
    if (removed) {
      this.data.assets = keep
      this.touch()
    }
    return { removed, affectedEntries }
  }

  /** 删除未被任何条目引用的资源文件 */
  gcOrphanAssets(): number {
    const used = new Set<string>()
    for (const e of this.data.entries) for (const id of e.assetIds) used.add(id)
    const keep: Asset[] = []
    let removed = 0
    for (const a of this.data.assets) {
      if (used.has(a.id)) {
        keep.push(a)
        continue
      }
      try {
        const p = this.abs(a.relPath)
        if (fs.existsSync(p)) fs.rmSync(p, { force: true })
        if (a.thumbRel) {
          const tp = this.abs(a.thumbRel)
          if (fs.existsSync(tp)) fs.rmSync(tp, { force: true })
        }
      } catch {
        /* 文件删不掉不影响元数据清理 */
      }
      removed++
    }
    if (removed) {
      this.data.assets = keep
      this.touch()
    }
    return removed
  }

  /* ── 标签 ── */
  findTagByName(name: string): Tag | undefined {
    const n = name.trim().toLowerCase()
    return this.data.tags.find((t) => t.name.trim().toLowerCase() === n)
  }

  ensureTag(name: string, groupId = ''): Tag {
    const exist = this.findTagByName(name)
    if (exist) return exist
    const tag: Tag = { id: newId(), name: name.trim(), groupId }
    this.data.tags.push(tag)
    this.touch()
    return tag
  }

  createTag(name: string, groupId = ''): Tag {
    const clean = name.trim()
    if (!clean) throw new Error('标签名不能为空')
    if (this.findTagByName(clean)) throw new Error(`标签「${clean}」已存在`)
    const tag: Tag = { id: newId(), name: clean, groupId }
    this.data.tags.push(tag)
    this.touch()
    return tag
  }

  updateTag(id: string, patch: Partial<Pick<Tag, 'name' | 'groupId'>>): Tag {
    const t = this.data.tags.find((x) => x.id === id)
    if (!t) throw new Error('标签不存在')
    if (patch.name !== undefined) {
      const clean = patch.name.trim()
      if (!clean) throw new Error('标签名不能为空')
      const dup = this.findTagByName(clean)
      if (dup && dup.id !== id) throw new Error(`标签「${clean}」已存在`)
      t.name = clean
    }
    if (patch.groupId !== undefined) t.groupId = patch.groupId
    this.touch()
    return t
  }

  /** 批量删除标签（会从所有记录上摘掉引用） */
  deleteTags(ids: string[]): number {
    const set = new Set(ids)
    if (!set.size) return 0
    const before = this.data.tags.length
    this.data.tags = this.data.tags.filter((t) => !set.has(t.id))
    const now = nowIso()
    for (const e of this.data.entries) {
      if (!e.tagIds.some((id) => set.has(id))) continue
      e.tagIds = e.tagIds.filter((id) => !set.has(id))
      e.updatedAt = now
    }
    this.touch()
    return before - this.data.tags.length
  }

  deleteTag(id: string): void {
    this.deleteTags([id])
  }

  /**
   * 把 fromIds 里的标签全部合并到 toId：替换条目引用、去重，再删除来源标签。
   * 这是标签治理的核心操作，也用于清理 AI 打标产生的同义标签。
   */
  mergeTags(fromIds: string[], toId: string): TagMergeResult {
    const target = this.data.tags.find((t) => t.id === toId)
    if (!target) throw new Error('目标标签不存在')
    const from = new Set(fromIds.filter((id) => id && id !== toId))
    if (!from.size) throw new Error('没有要合并的标签')
    for (const id of from) {
      if (!this.data.tags.some((t) => t.id === id)) {
        throw new Error('部分标签不存在，可能已被删除')
      }
    }

    let affectedEntries = 0
    for (const e of this.data.entries) {
      if (!e.tagIds.some((id) => from.has(id))) continue
      const next: string[] = []
      const seen = new Set<string>()
      for (const id of e.tagIds) {
        const mapped = from.has(id) ? toId : id
        if (seen.has(mapped)) continue
        seen.add(mapped)
        next.push(mapped)
      }
      e.tagIds = next
      e.updatedAt = nowIso()
      affectedEntries++
    }

    this.data.tags = this.data.tags.filter((t) => !from.has(t.id))
    this.touch()
    return { merged: from.size, affectedEntries, target }
  }


  /* ── 模型词表 ── */

  private modelEq(a: string, b: string): boolean {
    const norm = (v: string): string => v.trim().toLowerCase().replace(/s+/g, ' ')
    return norm(a) === norm(b)
  }

  findModelByName(name: string): ModelPreset | undefined {
    return (this.data.models ?? []).find((m) => this.modelEq(m.name, name))
  }

  createModel(name: string, kind: ModelKind = 'other'): ModelPreset {
    const clean = name.trim().replace(/s+/g, ' ')
    if (!clean) throw new Error('模型名不能为空')
    if (this.findModelByName(clean)) throw new Error(`模型「${clean}」已在词表中`)
    const m: ModelPreset = { id: newId(), name: clean, kind, builtin: false }
    this.data.models ??= []
    this.data.models.push(m)
    this.touch()
    return m
  }

  /** 重命名 / 改类型；syncEntries 时把条目里的旧名字一并替换 */
  updateModel(
    id: string,
    patch: { name?: string; kind?: ModelKind },
    opts: { syncEntries?: boolean } = {}
  ): { model: ModelPreset; affectedEntries: number } {
    const m = (this.data.models ?? []).find((x) => x.id === id)
    if (!m) throw new Error('模型不存在')
    const oldName = m.name
    if (patch.name !== undefined) {
      const clean = patch.name.trim().replace(/s+/g, ' ')
      if (!clean) throw new Error('模型名不能为空')
      const dup = this.findModelByName(clean)
      if (dup && dup.id !== id) throw new Error(`模型「${clean}」已在词表中`)
      m.name = clean
    }
    if (patch.kind !== undefined) m.kind = patch.kind

    let affectedEntries = 0
    if (opts.syncEntries && m.name !== oldName) {
      const now = nowIso()
      for (const e of this.data.entries) {
        const cur = (e.params?.model ?? '').trim()
        if (!cur || !this.modelEq(cur, oldName)) continue
        e.params.model = m.name
        e.updatedAt = now
        affectedEntries++
      }
    }
    this.touch()
    return { model: m, affectedEntries }
  }

  deleteModel(id: string): ModelPreset {
    const m = (this.data.models ?? []).find((x) => x.id === id)
    if (!m) throw new Error('模型不存在')
    this.data.models = (this.data.models ?? []).filter((x) => x.id !== id)
    this.touch()
    return m
  }

  /** 合并模型：来源模型的名称在条目里统一替换为目标名称，然后删除来源条目 */
  mergeModels(
    fromIds: string[],
    toId: string,
    syncEntries = true
  ): { merged: number; affectedEntries: number; target: ModelPreset } {
    const target = (this.data.models ?? []).find((m) => m.id === toId)
    if (!target) throw new Error('目标模型不存在')
    const from = new Set(fromIds.filter((id) => id && id !== toId))
    if (!from.size) throw new Error('没有要合并的模型')
    const sources = (this.data.models ?? []).filter((m) => from.has(m.id))
    if (sources.length !== from.size) throw new Error('部分模型不存在，可能已被删除')

    let affectedEntries = 0
    if (syncEntries) {
      const names = sources.map((m) => m.name)
      const now = nowIso()
      for (const e of this.data.entries) {
        const cur = (e.params?.model ?? '').trim()
        if (!cur) continue
        if (!names.some((n) => this.modelEq(cur, n))) continue
        e.params.model = target.name
        e.updatedAt = now
        affectedEntries++
      }
    }
    this.data.models = (this.data.models ?? []).filter((m) => !from.has(m.id))
    this.touch()
    return { merged: from.size, affectedEntries, target }
  }

  /** 重置为内置默认词表（自定义模型会被移除，条目上的字符串保持不变） */
  resetModels(): ModelPreset[] {
    this.data.models = seedModels()
    this.touch()
    return this.data.models
  }

  /** 把用户确认过的标签名写入记录：已存在的复用，不存在的新建 */
  applyTagCandidates(assignments: TagCandidateAssignment[]): {
    updatedEntries: number
    createdTags: string[]
  } {
    const created: string[] = []
    let updatedEntries = 0

    for (const a of assignments) {
      const e = this.getEntry(a.entryId)
      if (!e) continue
      const ids: string[] = []
      for (const raw of a.tags ?? []) {
        const name = raw.trim()
        if (!name) continue
        const exist = this.findTagByName(name)
        if (exist) {
          ids.push(exist.id)
          continue
        }
        const t = this.ensureTag(name)
        ids.push(t.id)
        created.push(t.name)
      }
      if (!ids.length) continue
      const before = e.tagIds.length
      e.tagIds = [...new Set([...e.tagIds, ...ids])]
      if (e.tagIds.length !== before) {
        e.updatedAt = nowIso()
        updatedEntries++
      }
    }

    if (updatedEntries || created.length) this.touch()
    return { updatedEntries, createdTags: [...new Set(created)] }
  }

  /* ── 标签组 ── */
  createTagGroup(name: string, color = '#7c9cff'): TagGroup {
    const g: TagGroup = {
      id: newId(),
      name: name.trim() || '未命名分组',
      color,
      order: this.data.tagGroups.length
    }
    this.data.tagGroups.push(g)
    this.touch()
    return g
  }

  updateTagGroup(id: string, patch: Partial<Pick<TagGroup, 'name' | 'color' | 'order'>>): TagGroup {
    const g = this.data.tagGroups.find((x) => x.id === id)
    if (!g) throw new Error('标签组不存在')
    Object.assign(g, patch)
    this.touch()
    return g
  }

  deleteTagGroup(id: string): void {
    this.data.tagGroups = this.data.tagGroups.filter((g) => g.id !== id)
    // 组内标签降级为「未分组」，不删标签本身
    for (const t of this.data.tags) if (t.groupId === id) t.groupId = ''
    this.touch()
  }

  /* ── 集合 ── */
  createCollection(name: string, color = '#7c9cff'): Collection {
    const c: Collection = {
      id: newId(),
      name: name.trim() || '未命名集合',
      color,
      createdAt: nowIso()
    }
    this.data.collections.push(c)
    this.touch()
    return c
  }

  updateCollection(id: string, patch: Partial<Pick<Collection, 'name' | 'color'>>): Collection {
    const c = this.data.collections.find((x) => x.id === id)
    if (!c) throw new Error('集合不存在')
    Object.assign(c, patch)
    this.touch()
    return c
  }

  deleteCollection(id: string): void {
    this.data.collections = this.data.collections.filter((c) => c.id !== id)
    for (const e of this.data.entries) e.collectionIds = e.collectionIds.filter((c) => c !== id)
    this.touch()
  }
}

export function ensureDirs(root: string): void {
  for (const d of ['', 'media', 'thumbs']) {
    const p = d ? path.join(root, d) : root
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
  }
}

/** 内容寻址存储路径：分两级目录，避免单目录文件过多 */
export function shardPath(baseNoExt: string, sha: string, ext: string): string {
  return `${baseNoExt}/${sha.slice(0, 2)}/${sha}${ext}`
}
