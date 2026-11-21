/**
 * MJ / 通用参数的纯函数：解析、重建、风格码。
 *
 * 约定：
 * - 结构化字段仍存 params.extra（aspect / version / profile / sref / stylize / chaos / p / raw / hd …）；
 * - 原始参数串存 extra.mjCodeparam（粘贴时逐字保留，字段改动后按规范顺序重建）；
 * - 风格码段存 extra.mjCodes（--sref / --profile），复制变体优先用它；
 * - 元数据键（mjCodeMode / mjCodeCount / mjReuse / mjVibe）不参与参数串，也不在「其它参数」里显示。
 */

export interface ParamField {
  key: string
  label: string
  flag: string
  placeholder: string
}

/** 编辑器 / 查看器里单独成行的常用字段（顺序即展示顺序） */
export const PARAM_FIELDS: ParamField[] = [
  { key: 'aspect', label: '比例', flag: 'ar', placeholder: '7:10' },
  { key: 'version', label: '版本', flag: 'v', placeholder: '8.2' },
  { key: 'profile', label: 'Profile', flag: 'profile', placeholder: 'ox27gsk' },
  { key: 'sref', label: 'Sref', flag: 'sref', placeholder: '613512513' },
  { key: 'stylize', label: 'Stylize', flag: 'stylize', placeholder: '150' },
  { key: 'chaos', label: 'Chaos', flag: 'chaos', placeholder: '5' },
  { key: 'p', label: 'P 值', flag: 'p', placeholder: '60' }
]

/** 只用于内部、不显示成「参数」的键 */
export const META_KEYS = new Set([
  'mjCodeparam',
  'mjCodes',
  'mjCodeMode',
  'mjCodeCount',
  'mjReuse',
  'mjVibe'
])

/** 布尔开关：有值就输出 --flag（不输出 true / 1） */
const BOOLEAN_KEYS = new Set(['raw', 'hd', 'tile', 'relax', 'niji'])

/**
 * 强 MJ 信号：出现任意一个就按 MJ 条目处理。
 * aspect / version 单独不算（Seedream 等模型也用比例），
 * 只有两者同时存在才视为极简 MJ 条目。
 */
const STRONG_MJ_KEYS = [
  'mjCodeparam',
  'mjCodes',
  'stylize',
  'chaos',
  'weird',
  'styleWeight',
  'sref',
  'profile',
  'tile',
  'hd',
  'raw',
  'p',
  'exp',
  'niji'
]

function hasStrongMj(extra: Record<string, string> | undefined): boolean {
  const e = extra ?? {}
  return STRONG_MJ_KEYS.some((k) => !!(e[k] ?? '').trim())
}

/** 字段 → MJ 旗标 */
export const FLAG_BY_KEY: Record<string, string> = {
  aspect: 'ar',
  version: 'v',
  profile: 'profile',
  sref: 'sref',
  style: 'style',
  stylize: 'stylize',
  chaos: 'chaos',
  weird: 'weird',
  styleWeight: 'sw',
  p: 'p',
  raw: 'raw',
  hd: 'hd',
  tile: 'tile',
  relax: 'relax',
  niji: 'niji'
}

/** MJ 旗标 → 字段 */
const KEY_BY_FLAG: Record<string, string> = {
  ar: 'aspect',
  v: 'version',
  s: 'stylize',
  c: 'chaos',
  w: 'weird',
  q: 'quality',
  sw: 'styleWeight',
  style: 'style'
}

/** 重建顺序：尽量贴近 MJ 常见写法，--v 放最后 */
const BUILD_ORDER = [
  'aspect',
  'raw',
  'hd',
  'tile',
  'relax',
  'niji',
  'profile',
  'sref',
  'style',
  'stylize',
  'chaos',
  'weird',
  'styleWeight',
  'p',
  'version'
]

function flagForKey(key: string): string {
  return FLAG_BY_KEY[key] ?? key.replace(/^--/, '')
}

function keyForFlag(flag: string): string {
  return KEY_BY_FLAG[flag] ?? flag
}

/** 结构化字段 → 参数串（不含 --no；不含元数据） */
export function buildParamString(
  extra: Record<string, string> | undefined,
  negative = ''
): string {
  const e = extra ?? {}
  const keys = BUILD_ORDER.filter((k) => e[k] !== undefined && e[k] !== '')
  const rest = Object.keys(e).filter(
    (k) => !BUILD_ORDER.includes(k) && !META_KEYS.has(k) && e[k] !== undefined && e[k] !== ''
  )
  const out: string[] = []
  for (const key of keys.concat(rest)) {
    const value = String(e[key] ?? '').trim()
    if (!value || value === 'false') continue
    const flag = flagForKey(key)
    if (BOOLEAN_KEYS.has(key) || value === 'true') {
      out.push('--' + flag)
    } else {
      out.push('--' + flag + ' ' + value)
    }
  }
  const neg = negative.trim()
  if (neg) out.push('--no ' + neg)
  return out.join(' ')
}

export interface ParsedParams {
  extra: Record<string, string>
  negative: string
}

/**
 * 参数串 → 结构化字段。
 * 例：--ar 7:10 --raw --profile 8ks9epn p3mma3l --hd --v 8.2 --no cat
 *  → { aspect:'7:10', raw:'true', profile:'8ks9epn p3mma3l', hd:'true', version:'8.2' }, 'cat'
 */
export function parseParamString(input: string): ParsedParams {
  const extra: Record<string, string> = {}
  const no: string[] = []
  const str = String(input || '').trim()
  if (!str) return { extra, negative: '' }

  const parts = str.split(/\s+--/)
  for (let part of parts) {
    part = part.trim().replace(/^--/, '')
    if (!part) continue
    const sp = part.search(/\s/)
    const flag = (sp === -1 ? part : part.slice(0, sp)).trim().toLowerCase()
    const value = (sp === -1 ? '' : part.slice(sp + 1).trim()) || 'true'
    if (!flag) continue
    if (flag === 'no') {
      if (value && value !== 'true') no.push(value)
      continue
    }
    const key = keyForFlag(flag)
    // 重复的 --no 合并；其它重复键后者覆盖
    extra[key] = BOOLEAN_KEYS.has(key) ? 'true' : value
  }
  return { extra, negative: no.join(' ') }
}

/** --sref / --profile 段；preferStored=true 时优先保留原始 mjCodes */
export function buildCodes(extra: Record<string, string> | undefined, preferStored = true): string {
  const e = extra ?? {}
  if (preferStored) {
    const stored = (e.mjCodes ?? '').trim()
    if (stored) return stored
  }
  const out: string[] = []
  const sref = (e.sref ?? '').trim()
  const profile = (e.profile ?? '').trim()
  if (sref) out.push('--sref ' + sref)
  if (profile) out.push('--profile ' + profile)
  return out.join(' ')
}

/**
 * 字段改动后同步 mjCodeparam / mjCodes。
 * 不修改传入对象；mjCodeMode / mjCodeCount / mjReuse / mjVibe 原样保留。
 */
export function withSyncedCodes(
  extra: Record<string, string> | undefined,
  negative: string
): Record<string, string> {
  const next: Record<string, string> = { ...(extra ?? {}) }
  // 只有已经带 MJ 信号（原始串 / 强字段）时才写 mjCodeparam，
  // 避免给只有 aspect 的 Seedream 条目“染上” MJ 身份。
  if ((next.mjCodeparam ?? '').trim() || hasStrongMj(next)) {
    const raw = buildParamString(next, negative)
    if (raw) next.mjCodeparam = raw
    else delete next.mjCodeparam
  }
  const codes = buildCodes(next, false)
  if (codes && ((next.mjCodes ?? '').trim() || hasStrongMj(next))) next.mjCodes = codes
  else if (!codes) delete next.mjCodes
  return next
}

/** 是否像 MJ 参数（用于决定是否显示「MJ 参数串」区域 / 复制 MJ 变体） */
export function hasMjParams(params: { extra?: Record<string, string> } | undefined): boolean {
  const e = params?.extra ?? {}
  if (hasStrongMj(e)) return true
  // 只剩 --ar 与 --v 的极简 MJ 条目
  return !!(e.aspect ?? '').trim() && !!(e.version ?? '').trim()
}

/** 「其它参数」的显示顺序 + 中文标签 */
export function paramLabel(key: string): string {
  const map: Record<string, string> = {
    aspect: '比例',
    version: '版本',
    profile: 'Profile',
    sref: 'Sref',
    style: '风格',
    stylize: 'Stylize',
    chaos: 'Chaos',
    weird: 'Weird',
    styleWeight: '风格权重',
    p: 'P 值',
    raw: 'Raw',
    hd: 'HD',
    tile: 'Tile',
    relax: 'Relax',
    niji: 'Niji',
    exp: 'Exp',
    quality: 'Quality',
    seed: 'Seed',
    no: '负向'
  }
  return map[key] ?? key
}
