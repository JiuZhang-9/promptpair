import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { PromptParams } from '../../../shared/types'
import {
  META_KEYS,
  PARAM_FIELDS,
  buildCodes,
  buildParamString,
  paramLabel,
  parseParamString,
  withSyncedCodes
} from '../mjParams'
import { useStore } from '../store'
import { Icon } from './ui'

/**
 * 生成参数编辑器（0.14.0）。
 * 同一套组件给「新建/编辑记录」和「大图查看器」用：
 * - 顶部整串参数（直接粘贴 MJ 命令尾巴）
 * - 解析成字段（比例 / 版本 / Profile / Sref / Stylize / Chaos / P 值）
 * - 其它参数 chips + 自定义追加
 *
 * 约定：extra 是唯一数据源；字段改动后用 withSyncedCodes 重建 mjCodeparam / mjCodes。
 */
export default function ParamEditor({
  params,
  negative,
  onChange,
  positive,
  onPositiveChange,
  hint = true
}: {
  params: PromptParams
  negative: string
  onChange: (params: PromptParams, negative: string) => void
  /** 传入正向提示词后显示「从提示词拆参数」 */
  positive?: string
  onPositiveChange?: (text: string) => void
  hint?: boolean
}): React.ReactElement {
  const toast = useStore((s) => s.toast)
  const extra = useMemo(() => params.extra ?? {}, [params.extra])
  const rawFromProps = useMemo(
    () => (extra.mjCodeparam ?? '').trim() || buildParamString(extra, negative),
    [extra, negative]
  )
  const [raw, setRaw] = useState(rawFromProps)
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')
  const rawRef = useRef<HTMLTextAreaElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)

  // 外部参数变化（字段编辑 / 打开另一条记录）时同步整串；用户正在输入整串时不覆盖
  useEffect(() => {
    if (document.activeElement === rawRef.current) return
    setRaw(rawFromProps)
  }, [rawFromProps])

  useEffect(() => {
    if (adding) keyRef.current?.focus()
  }, [adding])

  const customKeys = useMemo(
    () =>
      Object.keys(extra).filter(
        (k) => !META_KEYS.has(k) && !PARAM_FIELDS.some((f) => f.key === k)
      ),
    [extra]
  )

  const parsedCount = useMemo(() => {
    const p = parseParamString(raw)
    return Object.keys(p.extra).length + (p.negative ? 1 : 0)
  }, [raw])

  /** 整串 → 字段：逐字保留原始串，同时拆出结构化字段与 --no */
  const applyRaw = (text: string, notify = true): void => {
    const parsed = parseParamString(text)
    const nextExtra: Record<string, string> = {}
    // 元数据原样保留（码型 / 复用 / vibe 等）
    for (const k of META_KEYS) {
      if (extra[k] !== undefined) nextExtra[k] = extra[k]
    }
    Object.assign(nextExtra, parsed.extra)
    const trimmed = text.trim()
    if (trimmed) nextExtra.mjCodeparam = trimmed
    else delete nextExtra.mjCodeparam
    const codes = buildCodes(nextExtra, false)
    if (codes) nextExtra.mjCodes = codes
    else delete nextExtra.mjCodes
    onChange({ ...params, extra: nextExtra }, parsed.negative)
    if (notify) {
      const n = Object.keys(parsed.extra).length + (parsed.negative ? 1 : 0)
      toast(n ? `已解析 ${n} 项参数` : '参数已清空', 'ok')
    }
  }

  /** 字段 → 整串 */
  const setField = (key: string, value: string): void => {
    const nextExtra = { ...extra }
    const v = value.trim()
    if (v) nextExtra[key] = v
    else delete nextExtra[key]
    const synced = withSyncedCodes(nextExtra, negative)
    onChange({ ...params, extra: synced }, negative)
  }

  const delExtra = (key: string): void => {
    const nextExtra = { ...extra }
    delete nextExtra[key]
    const synced = withSyncedCodes(nextExtra, negative)
    onChange({ ...params, extra: synced }, negative)
  }

  const addExtra = (): void => {
    const key = newKey.trim().replace(/^--/, '')
    if (!key) {
      toast('先填参数键，比如 p', 'err')
      return
    }
    if (META_KEYS.has(key)) {
      toast(`「${key}」是内部字段，不能手动加`, 'err')
      return
    }
    setField(key, newVal.trim() || 'true')
    setNewKey('')
    setNewVal('')
    setAdding(false)
  }

  const extractFromPrompt = (): void => {
    if (positive == null || !onPositiveChange) return
    const m = positive.match(/\s(--[a-zA-Z].*)$/s)
    if (!m) {
      toast('提示词结尾没有 -- 参数尾巴', 'err')
      return
    }
    const tail = m[1].trim()
    onPositiveChange(positive.slice(0, m.index).trimEnd())
    setRaw(tail)
    applyRaw(tail)
  }

  return (
    <div className="pe">
      <div className="pe-raw-wrap">
        <textarea
          ref={rawRef}
          className="textarea pe-raw"
          rows={2}
          value={raw}
          spellCheck={false}
          placeholder="粘贴 MJ 参数尾巴，如 --ar 7:10 --v 8.2 --profile ox27gsk --p 60"
          onChange={(e) => setRaw(e.target.value)}
          onBlur={() => {
            if (raw.trim() !== rawFromProps.trim()) applyRaw(raw, false)
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              applyRaw(raw)
            }
          }}
        />
      </div>
      <div className="pe-tools">
        <button type="button" className="link-btn" onClick={() => applyRaw(raw)}>
          <Icon name="refresh" size={11} /> 解析为字段
        </button>
        {positive != null && onPositiveChange && (
          <button type="button" className="link-btn" onClick={extractFromPrompt}>
            从提示词拆参数
          </button>
        )}
        <span className="pe-count">{parsedCount} 项</span>
      </div>

      <div className="pe-grid">
        {PARAM_FIELDS.map((f, i) => (
          <label
            key={f.key}
            className={'pe-field' + (i === PARAM_FIELDS.length - 1 ? ' wide' : '')}
          >
            <span>
              {f.label} <code>--{f.flag}</code>
            </span>
            <input
              className="input"
              value={extra[f.key] ?? ''}
              placeholder={f.placeholder}
              onChange={(e) => setField(f.key, e.target.value)}
              aria-label={f.label}
            />
          </label>
        ))}
      </div>

      <div className="pe-other-head">
        <span>其它参数</span>
        <button type="button" className="link-btn" onClick={() => setAdding((v) => !v)}>
          <Icon name="plus" size={11} strokeWidth={2.4} /> 参数
        </button>
      </div>
      <div className="pe-chips">
        {customKeys.length === 0 && (
          <span className="pe-empty">没有其它参数；P 值可以在上面单独填，也可以在这里加 --p 60。</span>
        )}
        {customKeys.map((k) => {
          const v = extra[k]
          const label = v === 'true' ? `--${k}` : `--${k} ${v}`
          return (
            <span className="pchip" key={k} title={`${paramLabel(k)}：${label}`}>
              {label}
              <button type="button" onClick={() => delExtra(k)} title="删除">
                <Icon name="close" size={9} strokeWidth={2.6} />
              </button>
            </span>
          )
        })}
      </div>
      {adding && (
        <div className="pe-add">
          <input
            ref={keyRef}
            className="input"
            value={newKey}
            placeholder="键，如 p"
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addExtra()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
          <input
            className="input"
            value={newVal}
            placeholder="值，如 60"
            onChange={(e) => setNewVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addExtra()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
          <button type="button" className="btn small" onClick={addExtra}>
            加入
          </button>
        </div>
      )}
      {hint && (
        <div className="pe-hint">
          <code>--p</code> 是个性化强度；任何 MJ 参数都可以在「其它参数」里加，或直接改上面的整串。
        </div>
      )}
    </div>
  )
}
