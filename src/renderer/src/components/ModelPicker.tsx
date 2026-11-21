import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ModelKind } from '../../../shared/types'
import { MODEL_KIND_LABEL } from '../../../shared/types'
import { useStore } from '../store'
import { Icon } from './ui'

function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

/**
 * 紧凑模型选择器（0.14.0）：
 * 触发器只占一行，弹层固定 320px、两列，不再把整张表单铺满。
 */
export default function ModelPicker({
  value,
  defaultKind,
  onChange,
  compact = false,
  placeholder = '选择模型'
}: {
  value: string
  defaultKind: ModelKind
  onChange: (name: string) => void
  compact?: boolean
  placeholder?: string
}): React.ReactElement {
  const data = useStore((s) => s.data)
  const refresh = useStore((s) => s.refresh)
  const toast = useStore((s) => s.toast)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState({ left: 0, top: 0, width: 320 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const models = useMemo(() => data.models ?? [], [data.models])
  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of data.entries) {
      const n = (e.params?.model ?? '').trim().toLowerCase()
      if (n) m.set(n, (m.get(n) ?? 0) + 1)
    }
    return m
  }, [data.entries])

  const needle = q.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      models.filter((m) => (needle ? m.name.toLowerCase().includes(needle) : true)).slice(0, 80),
    [models, needle]
  )
  const grouped = useMemo(() => {
    const g: Record<ModelKind, typeof filtered> = { video: [], image: [], other: [] }
    for (const m of filtered) g[m.kind].push(m)
    return g
  }, [filtered])
  const exact = models.some((m) => m.name.trim().toLowerCase() === needle)
  const canCreate = !!needle && !exact

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(t)
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const tr = triggerRef.current
    const el = popRef.current
    if (!tr || !el) return
    const r = tr.getBoundingClientRect()
    const width = Math.min(320, window.innerWidth - 24)
    const h = el.offsetHeight || 320
    const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12))
    let top = r.bottom + 6
    if (top + h > window.innerHeight - 12 && r.top > h + 12) top = r.top - h - 6
    setPos({ left, top: Math.max(12, top), width })
  }, [open, q, filtered.length])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    const onScroll = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const choose = (name: string): void => {
    onChange(name)
    setOpen(false)
    setQ('')
  }

  const create = async (name: string): Promise<void> => {
    const clean = name.trim()
    if (!clean) return
    try {
      const m = await window.pp.createModel(clean, defaultKind)
      await refresh()
      onChange(m.name)
      setOpen(false)
      setQ('')
      toast(`已加入词表「${m.name}」`, 'ok')
    } catch (e) {
      toast(cleanError(e), 'err')
    }
  }

  return (
    <div className="mp-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={'mp-trigger' + (compact ? ' compact' : '')}
        onClick={() => {
          setOpen((v) => !v)
          setQ('')
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value || placeholder}
      >
        <Icon name="layers" size={13} />
        <span className="ellipsis">{value || placeholder}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {value && (
        <button
          type="button"
          className="mp-clear"
          title="清除模型"
          onClick={() => {
            onChange('')
            setOpen(false)
          }}
        >
          <Icon name="close" size={10} strokeWidth={2.4} />
        </button>
      )}

      {open &&
        createPortal(
          <div
            ref={popRef}
            className="mp-pop"
            style={{ left: pos.left, top: pos.top, width: pos.width }}
            role="listbox"
          >
            <div className="mp-search">
              <Icon name="search" size={13} />
              <input
                ref={inputRef}
                value={q}
                placeholder="搜索模型，或输入新名字回车新建…"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (canCreate) void create(q)
                    else if (filtered[0]) choose(filtered[0].name)
                  }
                }}
              />
            </div>
            <div className="mp-body">
              {(['image', 'video', 'other'] as ModelKind[]).map((kind) =>
                grouped[kind].length ? (
                  <React.Fragment key={kind}>
                    <div className="mp-group-label">{MODEL_KIND_LABEL[kind]}模型</div>
                    <div className="mp-grid">
                      {grouped[kind].map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={'mp-item' + (m.name === value ? ' on' : '')}
                          data-model={m.name}
                          onClick={() => choose(m.name)}
                          role="option"
                          aria-selected={m.name === value}
                        >
                          <span className="ellipsis">{m.name}</span>
                          <em>{usage.get(m.name.toLowerCase()) ?? 0}</em>
                          {m.name === value && <Icon name="check" size={11} strokeWidth={2.4} />}
                        </button>
                      ))}
                    </div>
                  </React.Fragment>
                ) : null
              )}
              {canCreate && (
                <button type="button" className="mp-create" onClick={() => void create(q)}>
                  <Icon name="plus" size={11} strokeWidth={2.4} /> 新建「{q.trim()}」
                </button>
              )}
              {!filtered.length && !canCreate && <div className="mp-empty">没有匹配的模型</div>}
            </div>
            <div className="mp-foot">
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setOpen(false)
                  toast('关闭编辑器后，可在设置 → 模型管理里整理词表', 'info')
                }}
              >
                模型管理…
              </button>
              <span>{models.length} 个</span>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
