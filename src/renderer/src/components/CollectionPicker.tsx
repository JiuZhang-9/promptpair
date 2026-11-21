import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { collMap, useStore } from '../store'
import { Icon } from './ui'

/**
 * 集合选择器（0.14.0）：
 * 只显示这条记录当前所属的集合；点「加入集合」才弹出全部集合勾选。
 */
export default function CollectionPicker({
  selected,
  onChange,
  compact = false
}: {
  selected: string[]
  onChange: (ids: string[]) => void
  compact?: boolean
}): React.ReactElement {
  const data = useStore((s) => s.data)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState({ left: 0, top: 0, width: 300 })
  const anchorRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const colls = useMemo(() => collMap(data), [data.collections])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of data.entries) for (const id of e.collectionIds) m.set(id, (m.get(id) ?? 0) + 1)
    return m
  }, [data.entries])
  const current = selected.map((id) => colls.get(id)).filter(Boolean)

  const needle = q.trim().toLowerCase()
  const list = data.collections.filter((c) => (needle ? c.name.toLowerCase().includes(needle) : true))

  useLayoutEffect(() => {
    if (!open) return
    const tr = anchorRef.current
    const el = popRef.current
    if (!tr || !el) return
    const r = tr.getBoundingClientRect()
    const width = Math.min(300, window.innerWidth - 24)
    const h = el.offsetHeight || 280
    const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12))
    let top = r.bottom + 6
    if (top + h > window.innerHeight - 12 && r.top > h + 12) top = r.top - h - 6
    setPos({ left, top: Math.max(12, top), width })
  }, [open, q, list.length])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // 捕获阶段挡住编辑器 / 查看器的 Esc，避免“关弹层顺手把整页也关了”
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

  const toggle = (id: string): void => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  return (
    <div className={'cp-wrap' + (compact ? ' compact' : '')}>
      <div className="cp-chips">
        {current.length === 0 && <span className="cp-empty">未归集合</span>}
        {current.map((c) => (
          <span key={c!.id} className="cp-chip">
            <span className="coll-dot" style={{ background: c!.color }} />
            <span className="ellipsis">{c!.name}</span>
            <button
              type="button"
              className="cp-x"
              title="移出集合"
              onClick={() => onChange(selected.filter((x) => x !== c!.id))}
            >
              <Icon name="close" size={9} strokeWidth={2.6} />
            </button>
          </span>
        ))}
        <button
          ref={anchorRef}
          type="button"
          className="cp-add"
          onClick={() => {
            setOpen((v) => !v)
            setQ('')
          }}
          title="把这条记录加入其它集合"
        >
          <Icon name="plus" size={10} strokeWidth={2.4} /> 加入集合
        </button>
      </div>

      {open &&
        createPortal(
          <div ref={popRef} className="cp-pop" style={{ left: pos.left, top: pos.top, width: pos.width }}>
            <div className="cp-pop-head">
              <Icon name="search" size={12} />
              <input
                autoFocus
                value={q}
                placeholder="搜索集合…"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false)
                }}
              />
            </div>
            <div className="cp-list">
              {list.map((c) => {
                const on = selected.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={'cp-row' + (on ? ' on' : '')}
                    data-collection={c.name}
                    onClick={() => toggle(c.id)}
                  >
                    <span className="coll-dot" style={{ background: c.color }} />
                    <span className="ellipsis">{c.name}</span>
                    <em>{counts.get(c.id) ?? 0}</em>
                    {on && <Icon name="check" size={12} strokeWidth={2.4} />}
                  </button>
                )
              })}
              {list.length === 0 && <div className="cp-note">没有匹配的集合</div>}
            </div>
            <div className="cp-foot">在左侧栏可以新建集合</div>
          </div>,
          document.body
        )}
    </div>
  )
}
