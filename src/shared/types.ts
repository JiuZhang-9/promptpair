/**
 * PromptPair 数据模型（唯一事实来源 / Single Source of Truth）
 *
 * 设计原则：
 * 1. 一个「提示词」= 一条 PromptEntry；一条 PromptEntry 挂 N 个 Asset（一对多）。
 * 2. Asset 以 sha256 内容寻址，全局唯一 → 同文件重复导入自动复用，天然去重。
 * 3. 媒体文件一律复制进库（media/），库内只存相对路径 → 整个库文件夹可整体搬迁/分享。
 * 4. 库是纯 JSON（library.json）+ 扁平文件夹，无数据库依赖 → 用户可自行备份、可被任何工具读取。
 * 5. schemaVersion 单调递增，迁移函数集中在 library.ts 的 MIGRATIONS 中。
 */

export type Id = string

/** 库结构版本，与 App 版本无关；每次破坏性改动 +1 并补迁移 */
export const SCHEMA_VERSION = 1

/** 支持的媒体类型 */
export type AssetKind = 'image' | 'video'

export interface Asset {
  /** 主键 = sha256 前 24 位，稳定且可读 */
  id: Id
  sha256: string
  kind: AssetKind
  /** 含点小写，如 .png / .mp4 */
  ext: string
  bytes: number
  width?: number
  height?: number
  /** 相对库根的路径，正斜杠，如 media/ab/abcd….png */
  relPath: string
  /** 缩略图相对路径；视频为抽帧结果 */
  thumbRel?: string
  /** 感知哈希（dHash，16 位十六进制 = 64 bit），用于近似重复检测 */
  phash?: string
  addedAt: string
}

/** 生成参数：想「复现同一张图」时必需 */
export interface PromptParams {
  model?: string
  seed?: string
  width?: number
  height?: number
  steps?: number
  cfg?: number
  sampler?: string
  /** 参考图 / 垫图说明（文字记法，避免再挂一层资源树） */
  reference?: string
  /** 其它键值对，自由扩展，如 style_raw / lora / version */
  extra?: Record<string, string>
}

/** 来源信息：由导入规则自动派生，默认不要求用户手填 */
export interface SourceInfo {
  /** 平台名，如 即梦 / 可灵 / Midjourney / 本地导入 / 浏览器采集 */
  platform?: string
  /** 原始页面地址（浏览器插件采集时写入） */
  url?: string
  /** 原始文件名 */
  originalName?: string
  /** 原始绝对路径（仅记录，不用于读取） */
  originalPath?: string
}

export interface PromptEntry {
  id: Id
  title: string
  /** 正向提示词正文 —— 这是整个工具的主角 */
  positive: string
  negative: string
  note: string
  /** 0–5 星，0 = 未评分 */
  rating: number
  favorite: boolean
  collectionIds: Id[]
  tagIds: Id[]
  /** 一对多的「多」；顺序即展示顺序 */
  assetIds: Id[]
  params: PromptParams
  source: SourceInfo
  createdAt: string
  updatedAt: string
}

export interface TagGroup {
  id: Id
  name: string
  /** 十六进制色值，标签继承所属组的颜色 */
  color: string
  order: number
}

export interface Tag {
  id: Id
  name: string
  /** 空字符串 = 未分组 */
  groupId: Id | ''
}

export interface Collection {
  id: Id
  name: string
  color: string
  createdAt: string
}

export interface LibraryData {
  schemaVersion: number
  /** 库唯一 ID，用于导入合并时判断是否同源 */
  id: string
  name: string
  createdAt: string
  updatedAt: string
  entries: PromptEntry[]
  assets: Asset[]
  tagGroups: TagGroup[]
  tags: Tag[]
  collections: Collection[]
}

/* ────────────────────────── 应用配置（存 userData，不进库） ────────────────────────── */

export type ThemeMode = 'system' | 'dark' | 'light'

export interface AppConfig {
  /** 当前库根目录绝对路径 */
  libraryPath: string
  theme: ThemeMode
  /** 画廊缩略图边长 px */
  thumbSize: number
  /** 近似重复判定阈值（汉明距离 0–64，越小越严格） */
  duplicateThreshold: number
  /** 导入时是否按父文件夹名自动打标 */
  autoTagFromFolder: boolean
  /** 自动打标时若标签不存在，是否自动创建 */
  autoCreateTags: boolean
  /** 导入后自动尝试读取同名 .txt / .json 旁车文件作为提示词 */
  autoReadSidecar: boolean
  /**
   * 同批次连号文件合并成一条记录。
   * 规则：`xxx_1.png / xxx_2.png / xxx_3.png`、`xxx (1).jpg`、`xxx-02.jpg`
   * 会归为一条「一对多」记录，共用同一个提示词。
   */
  autoGroupByStem: boolean
  /** 关闭窗口时最小化到托盘 */
  minimizeToTray: boolean
  /** 最后选中的集合（仅记忆，非业务数据） */
  lastCollectionId?: string

  /* ── AI 辅助打标（可选）── */
  /** 总开关。关闭或没有 Key 时，相关入口整体隐藏 */
  aiEnabled: boolean
  /** OpenAI 兼容接口，例如 https://api.openai.com/v1 */
  aiBaseUrl: string
  /** API Key。只保存在本机 config.json（明文），不进入素材库 */
  aiApiKey: string
  /** 模型名，例如 gpt-4o-mini */
  aiModel: string
}

/* ────────────────────────── 操作载荷 ────────────────────────── */

/** 新建/编辑条目时提交的草稿 */
export interface EntryDraft {
  id?: Id
  title: string
  positive: string
  negative: string
  note: string
  rating: number
  favorite: boolean
  collectionIds: Id[]
  tagIds: Id[]
  assetIds: Id[]
  params: PromptParams
  source: SourceInfo
}

/** 批量修改：多选后统一处理 */
export interface BatchPatch {
  addTagIds?: Id[]
  removeTagIds?: Id[]
  addCollectionIds?: Id[]
  removeCollectionIds?: Id[]
  rating?: number
  favorite?: boolean
}

/** 导入结果回执 */
export interface ImportResult {
  /** 新入库媒体数 */
  importedAssets: number
  /** 因已存在而跳过的媒体数 */
  reusedAssets: number
  /** 新建的条目数 */
  createdEntries: number
  /** 新建的标签名 */
  createdTags: string[]
  /** 失败文件 */
  failed: { path: string; reason: string }[]
}

/** 浏览器插件送来的采集数据 */
export interface CapturePayload {
  imageUrl?: string
  /** 插件直接给的 dataURL（跨域图走这条路） */
  dataUrl?: string
  pageUrl: string
  pageTitle: string
  promptText: string
  negativeText?: string
  platform?: string
}

export interface DuplicateGroup {
  /** 组内 assetId */
  assetIds: Id[]
  /** 组内最大汉明距离 */
  maxDistance: number
  /** 是否有完全相同（sha256 相同不可能出现在两个 asset，故此项仅表示近乎相同） */
  exact: boolean
}

export interface ExportOptions {
  entryIds: Id[]
  /** 目标 .promptpack 路径 */
  outPath: string
  includeMedia: boolean
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

/* ────────────────────────── 标签治理 / AI 打标 ────────────────────────── */

/** 标签合并结果 */
export interface TagMergeResult {
  /** 被合并掉的标签数（不含目标标签） */
  merged: number
  /** 受影响的记录数 */
  affectedEntries: number
  /** 合并后的目标标签 */
  target: Tag
}

/** 一条记录的 AI 候选标签 */
export interface AiTagSuggestion {
  entryId: Id
  tags: string[]
  /** 单条失败原因；成功时为空 */
  error?: string
}

export interface AiSuggestResult {
  results: AiTagSuggestion[]
  model: string
  /** 失败的记录数 */
  failed: number
}

export interface AiTestResult {
  ok: boolean
  message: string
  model?: string
}

/** 用户确认后要写入的标签：按记录分组，标签用名字表达（可新建） */
export interface TagCandidateAssignment {
  entryId: Id
  tags: string[]
}

/** 默认标签组：给出可用的初始分类法，用户可自由改名/删改。
 *  单色设计：组色是灰阶而非彩色，只用来区分相邻分组，不制造"调色盘" */
export const DEFAULT_TAG_GROUPS: { name: string; color: string }[] = [
  { name: '风格', color: '#c7c7cc' },
  { name: '题材', color: '#a1a1aa' },
  { name: '镜头', color: '#8e8e93' },
  { name: '画质', color: '#71717a' },
  { name: '用途', color: '#5a5a60' }
]

export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']
export const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']

export function kindOfExt(ext: string): AssetKind | null {
  const e = ext.toLowerCase()
  if (IMAGE_EXTS.includes(e)) return 'image'
  if (VIDEO_EXTS.includes(e)) return 'video'
  return null
}
