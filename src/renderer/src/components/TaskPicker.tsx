import React from 'react'
import type { TaskMode } from '../../../shared/types'
import { taskLabel } from '../../../shared/modes'
import { Icon } from './ui'

/** 生成方式选择器：文生图 / 图生图（视频记录显示文生视频 / 图生视频） */
export default function TaskPicker({
  value,
  kind = 'image',
  onChange,
  compact = false
}: {
  value: TaskMode
  kind?: 'image' | 'video' | 'other' | string
  onChange: (v: TaskMode) => void
  compact?: boolean
}): React.ReactElement {
  const options: { id: TaskMode; label: string; icon: string }[] = [
    { id: 't2i', label: taskLabel('t2i', kind), icon: 'sparkles' },
    { id: 'i2i', label: taskLabel('i2i', kind), icon: 'image' }
  ]
  return (
    <div className={'task-picker' + (compact ? ' compact' : '')} role="radiogroup" aria-label="生成方式">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          data-task={o.id}
          aria-checked={value === o.id}
          className={'task-opt' + (value === o.id ? ' on' : '')}
          onClick={() => onChange(o.id)}
          title={o.id === 'i2i' ? '有参考图 / 改图 / 保持人物等输入图' : '只输入提示词生成'}
        >
          <Icon name={o.icon} size={12} />
          {o.label}
        </button>
      ))}
    </div>
  )
}
