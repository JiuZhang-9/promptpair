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
import { buildCodes, buildParamString, hasMjParams } from './mjParams'

export type CopyVariantId = 'prompt' | 'promptParams' | 'mjParams' | 'codeParams'

export interface CopyVariant {
  id: CopyVariantId
  label: string
  text: string
  disabled: boolean
}

type Copyable = Pick<PromptEntry, 'positive' | 'negative' | 'note' | 'params'>

export function isMjEntry(entry: Copyable): boolean {
  if ((entry.params?.model ?? '').toLowerCase() === 'midjourney') return true
  return hasMjParams(entry.params)
}

/** 完整参数段（含风格码与 --no）；优先用原始串 */
function buildParams(entry: Copyable): string {
  const extra = (entry.params?.extra ?? {}) as Record<string, string>
  const raw = (extra['mjCodeparam'] ?? '').trim()
  if (raw) return raw
  const body = buildParamString(extra)
  const neg = (entry.negative ?? '').trim()
  return [body, neg ? '--no ' + neg : ''].filter(Boolean).join(' ')
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
