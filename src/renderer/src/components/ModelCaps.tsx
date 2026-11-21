import React from 'react'
import type { ModelCapabilities, ModelKind } from '../../../shared/types'
import { CAPABILITY_LABEL, capabilitiesOf } from '../../../shared/modes'
import { useStore } from '../store'

const ORDER: (keyof ModelCapabilities)[] = ['t2i', 'i2i', 'edit', 'imagePrompt', 'styleRef']

/** 词表模型的能力标注；内置模型有默认值，自定义模型按 kind 兜底 */
export default function ModelCaps({
  name,
  kind = 'other',
  compact = false,
  only
}: {
  name: string
  kind?: ModelKind
  compact?: boolean
  only?: (keyof ModelCapabilities)[]
}): React.ReactElement | null {
  const models = useStore((s) => s.data.models ?? [])
  if (!name.trim()) return null
  const preset = models.find(
    (m) => m.name.trim().toLowerCase().replace(/\s+/g, ' ') === name.trim().toLowerCase().replace(/\s+/g, ' ')
  )
  const caps = capabilitiesOf(preset, name, kind)
  const keys = ORDER.filter((k) => caps[k] && (!only || only.includes(k)))
  if (!keys.length) return null
  return (
    <div className={'model-caps' + (compact ? ' compact' : '')} title={keys.map((k) => CAPABILITY_LABEL[k]).join(' · ')}>
      {keys.map((k) => (
        <span key={k} className={'cap-chip ' + k}>
          {CAPABILITY_LABEL[k]}
        </span>
      ))}
    </div>
  )
}
