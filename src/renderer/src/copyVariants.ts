/**
 * 复制变体（2026-11-16 用户确认的四档）：
 * - 仅复制提示词：正文
 * - 复制提示词+MJ参数：正文 + 完整参数段（可直接粘进 MJ）
 * - 仅复制MJ参数：只要参数段
 * - 复制风格码+MJ参数：风格码（--sref / --profile）在前，其余参数在后；没有风格码时禁用
 *
 * 参数段来源：
 * 1. 优先 extra.mjCodeparam —— 采集/录入时保留的原始参数串（顺序、写法都不动）
 * 2. 没有时由结构化字段重建（aspect / version / style / chaos / stylize / weird / sw /
 *    raw / hd / tile / sref / profile + negative），兼容各条导入路径
 *
 * MJ 条目判定：params.model 为 Midjourney，或带有上述 MJ 专有字段。
 * 普通条目的 note 是用户笔记，不参与拼接。
 */
import type { PromptEntry } from '../../shared/types'

export type CopyVariantId = 'prompt' | 'promptParams' | 'mjParams' | 'codeParams'

export interface CopyVariant {
  id: CopyVariantId
  label: string
  text: string
  disabled: boolean
}

type Copyable = Pick<PromptEntry, 'positive' | 'negative' | 'note' | 'params'>

const MJ_KEYS = [
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
  'raw'
]

export function isMjEntry(entry: Copyable): boolean {
  if ((entry.params?.model ?? '').toLowerCase() === 'midjourney') return true
  const extra = entry.params?.extra ?? {}
  if (MJ_KEYS.some((k) => !!(extra[k] && String(extra[k]).trim()))) return true
  // 只剩 --ar 与 --v 的极简 MJ 条目（如「--ar 9:16 --v 8.2」）
  return !!(extra['aspect'] && extra['version'])
}

/** 结构化字段 → MJ 参数串（不含风格码与 --no） */
function buildBody(extra: Record<string, string>): string {
  const out: string[] = []
  const add = (flag: string, key: string, prefix = ''): void => {
    const v = (extra[key] ?? '').trim()
    if (v) out.push(`${flag} ${prefix}${v}`)
  }
  add('--ar', 'aspect')
  add('--v', 'version')
  add('--style', 'style')
  add('--chaos', 'chaos')
  add('--stylize', 'stylize')
  add('--weird', 'weird')
  add('--sw', 'styleWeight')
  if (extra['raw']) out.push('--raw')
  if (extra['hd']) out.push('--hd')
  if (extra['tile']) out.push('--tile')
  return out.join(' ')
}

/** 风格码段：--sref / --profile */
function buildCodes(extra: Record<string, string>): string {
  const stored = (extra['mjCodes'] ?? '').trim()
  if (stored) return stored
  const out: string[] = []
  const sref = (extra['sref'] ?? '').trim()
  const profile = (extra['profile'] ?? '').trim()
  if (sref) out.push('--sref ' + sref)
  if (profile) out.push('--profile ' + profile)
  return out.join(' ')
}

/** 完整参数段（含风格码与 --no）；优先用原始串 */
function buildParams(entry: Copyable): string {
  const extra = (entry.params?.extra ?? {}) as Record<string, string>
  const raw = (extra['mjCodeparam'] ?? '').trim()
  if (raw) return raw
  const body = buildBody(extra)
  const codes = buildCodes(extra)
  const neg = (entry.negative ?? '').trim()
  return [body, codes, neg ? '--no ' + neg : ''].filter(Boolean).join(' ')
}

export function copyVariants(entry: Copyable): CopyVariant[] {
  const extra = (entry.params?.extra ?? {}) as Record<string, string>
  const positive = (entry.positive ?? '').trim()
  const mj = isMjEntry(entry)
  const params = mj ? buildParams(entry) : ''
  const codes = mj ? buildCodes(extra) : ''
  // 「风格码+参数」= 风格码在前，其余参数在后（去掉参数段里重复的风格码）
  const rest = codes ? params.split(codes).join(' ').replace(/\s+/g, ' ').trim() : params
  const codeParams = codes ? [codes, rest].filter(Boolean).join(' ') : ''

  return [
    {
      id: 'prompt',
      label: '仅复制提示词',
      text: positive,
      disabled: !positive
    },
    {
      id: 'promptParams',
      label: '复制提示词+MJ参数',
      text: positive && params ? `${positive} ${params}` : positive,
      disabled: !positive || !params
    },
    {
      id: 'mjParams',
      label: '仅复制MJ参数',
      text: params,
      disabled: !params
    },
    {
      id: 'codeParams',
      label: '复制风格码+MJ参数',
      text: codeParams,
      disabled: !codeParams
    }
  ]
}

/** 按变体 id 取文本；disabled 变体回退到提示词 */
export function variantText(entry: Copyable, id: CopyVariantId): string {
  const all = copyVariants(entry)
  const v = all.find((x) => x.id === id)
  if (!v || (v.disabled && id !== 'prompt')) return all[0].text
  return v.text
}
