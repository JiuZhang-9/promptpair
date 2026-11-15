/**
 * 复制变体（学习 MJ码图对照 工具的复制方法，2026-11-15 用户确认）：
 * - 提示词 = 正文（vibe 已并入正文，见 build-batch v3）
 * - 提示词+参数 = 正文 + MJ 参数段（可直接粘进 MJ）
 * - 风格码 = vibe + 码段（--profile/--sref；原工具「复制码」行为，vibe 取 extra.mjVibe）
 * - 风格码+参数 = vibe + 参数段
 * 仅当条目带 MJ 码数据（mjCodes / mjCodeparam）时才视为 MJ 条目；
 * 普通条目的 note 是用户笔记，不参与拼接。
 */
import type { PromptEntry } from '../../shared/types'

export interface CopyVariant {
  id: 'prompt' | 'promptParams' | 'codes' | 'codeParams'
  label: string
  text: string
  disabled: boolean
}

/** 条目或草稿都可用（只读 positive / note / params） */
export function copyVariants(entry: Pick<PromptEntry, 'positive' | 'note' | 'params'>): CopyVariant[] {
  const extra = entry.params?.extra ?? {}
  const codes = (extra['mjCodes'] ?? '').trim()
  const codeparam = (extra['mjCodeparam'] ?? '').trim()
  const vibe = (extra['mjVibe'] ?? '').trim()
  const head = vibe ? vibe + ' ' : ''
  const positive = (entry.positive ?? '').trim()

  return [
    {
      id: 'prompt',
      label: '复制提示词',
      text: positive,
      disabled: !positive
    },
    {
      id: 'promptParams',
      label: '复制提示词+参数',
      text: positive + (codeparam ? ' ' + codeparam : ''),
      disabled: !positive || !codeparam
    },
    {
      id: 'codes',
      label: '复制风格码',
      text: head + codes,
      disabled: !codes
    },
    {
      id: 'codeParams',
      label: '复制风格码+参数',
      text: head + codeparam,
      disabled: !codeparam
    }
  ]
}

/** 按变体 id 取文本；disabled 变体回退到提示词 */
export function variantText(
  entry: Pick<PromptEntry, 'positive' | 'note' | 'params'>,
  id: CopyVariant['id']
): string {
  const v = copyVariants(entry).find((x) => x.id === id)
  if (!v || (v.disabled && id !== 'prompt')) return copyVariants(entry)[0].text
  return v.text
}
