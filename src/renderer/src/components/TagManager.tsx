import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Tag } from '../../../shared/types'
import { groupMap, useStore } from '../store'
import { Empty, Icon, Modal } from './ui'

function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** 编辑距离（按字符而不是 UTF-16 码元，中文/emoji 都按一个字算） */
function levenshtein(a: string, b: string): number {
  const A = Array.from(a)
  const B = Array.from(b)
  if (!A.length) return B.length
  if (!B.length) return A.length
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i)
  for (let i = 1; i <= A.length; i++) {
    const cur = [i]
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1)
      )
    }
    prev = cur
  }
  return prev[B.length]
}

interface Suggestion {
  a: Tag
  b: Tag
  reason: string
}

export default function TagManager(): React.ReactElement {
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const data = useStore((s) => s.data)
  const refresh = useStore((s) => s.refresh)
  const toast = useStore((s) => s.toast)

  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [mergeOpen, setMergeOpen] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const renameDone = useRef(false)

  const groups = useMemo(() => groupMap(data), [data])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of data.entries) for (const id of e.tagIds) m.set(id, (m.get(id) ?? 0) + 1)
    return m
  }, [data.entries])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return data.tags
      .filter((t) => (needle ? t.name.toLowerCase().includes(needle) : true))
      .sort(
        (a, b) =>
          (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) ||
          a.name.localeCompare(b.name, 'zh-Hans-CN')
      )
  }, [data.tags, counts, q])

  const suggestions = useMemo<Suggestion[]>(() => {
    const out: Suggestion[] = []
    const seen = new Set<string>()
    const tags = data.tags
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const A = normalize(tags[i].name)
        const B = normalize(tags[j].name)
        if (!A || !B) continue

        let reason = ''
        if (A === B) {
          reason = '名称相同'
        } else {
          const d = levenshtein(A, B)
          const limit = Math.min(Array.from(A).length, Array.from(B).length) <= 3 ? 1 : 2
          if (d <= limit) {
            reason = `编辑距离 ${d}`
          } else if (Array.from(A).length >= 2 && Array.from(B).length >= 2) {
            const [short, long] = A.length <= B.length ? [A, B] : [B, A]
            if (long.includes(short) && Array.from(short).length / Array.from(long).length >= 0.5) {
              reason = '名称包含'
            }
          }
        }
        if (!reason) continue

        const key = [tags[i].id, tags[j].id].sort().join(':')
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ a: tags[i], b: tags[j], reason })
      }
    }
    return out
      .sort(
        (x, y) =>
          (counts.get(y.a.id) ?? 0) +
          (counts.get(y.b.id) ?? 0) -
          ((counts.get(x.a.id) ?? 0) + (counts.get(x.b.id) ?? 0))
      )
      .slice(0, 20)
  }, [data.tags, counts])

  // 标签被删/合并后，清掉已不存在的选中项
  useEffect(() => {
    setSelected((prev) => {
      const next = prev.filter((id) => data.tags.some((t) => t.id === id))
      return next.length === prev.length ? prev : next
    })
  }, [data.tags])

  if (panel !== 'tags') return <></>

  const toggle = (id: string): void =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const startRename = (t: Tag): void => {
    renameDone.current = false
    setRenaming({ id: t.id, value: t.name })
  }

  const commitRename = async (): Promise<void> => {
    if (!renaming || renameDone.current) return
    const name = renaming.value.trim()
    const cur = data.tags.find((t) => t.id === renaming.id)
    if (!name || !cur || name === cur.name) {
      renameDone.current = true
      setRenaming(null)
      return
    }
    renameDone.current = true
    try {
      await window.pp.updateTag(renaming.id, { name })
      await refresh()
      setRenaming(null)
      toast('已重命名', 'ok')
    } catch (e) {
      // 失败时保留输入框，允许改名后重试
      renameDone.current = false
      toast(cleanError(e), 'err')
    }
  }

  const removeOne = async (t: Tag): Promise<void> => {
    const n = counts.get(t.id) ?? 0
    if (!window.confirm(`删除标签「${t.name}」？\n将从 ${n} 条记录上移除，不可撤销。`)) return
    try {
      await window.pp.deleteTag(t.id)
      await refresh()
      toast('已删除', 'ok')
    } catch (e) {
      toast(cleanError(e), 'err')
    }
  }

  const removeSelected = async (): Promise<void> => {
    if (!selected.length) return
    const names = selected
      .map((id) => data.tags.find((t) => t.id === id)?.name)
      .filter(Boolean)
      .slice(0, 5)
      .join('、')
    const affected = data.entries.filter((e) => e.tagIds.some((id) => selected.includes(id))).length
    if (
      !window.confirm(
        `删除选中的 ${selected.length} 个标签（${names}${selected.length > 5 ? '…' : ''}）？\n将影响 ${affected} 条记录，不可撤销。`
      )
    )
      return
    try {
      const r = await window.pp.deleteTags(selected)
      await refresh()
      setSelected([])
      toast(`已删除 ${r.deleted} 个标签`, 'ok')
    } catch (e) {
      toast(cleanError(e), 'err')
    }
  }

  const mergeInto = async (targetId: string): Promise<void> => {
    const target = data.tags.find((t) => t.id === targetId)
    if (!target) return
    const sources = selected.filter((id) => id !== targetId)
    if (!sources.length) return
    const affected = data.entries.filter((e) => e.tagIds.some((id) => sources.includes(id))).length
    if (
      !window.confirm(
        `把选中的另外 ${sources.length} 个标签合并到「${target.name}」？\n\n会影响 ${affected} 条记录；合并后这些标签会被删除。`
      )
    )
      return
    try {
      const r = await window.pp.mergeTags(sources, targetId)
      await refresh()
      setSelected([])
      setMergeOpen(false)
      toast(`已合并 ${r.merged} 个标签，影响 ${r.affectedEntries} 条记录`, 'ok')
    } catch (e) {
      toast(cleanError(e), 'err')
    }
  }

  const mergePair = async (a: Tag, b: Tag): Promise<void> => {
    const ca = counts.get(a.id) ?? 0
    const cb = counts.get(b.id) ?? 0
    const target = ca >= cb ? a : b
    const source = target.id === a.id ? b : a
    const affected = data.entries.filter((e) => e.tagIds.includes(source.id)).length
    if (
      !window.confirm(
        `把「${source.name}」合并到「${target.name}」？\n\n会影响 ${affected} 条记录，合并后「${source.name}」会被删除。`
      )
    )
      return
    try {
      const r = await window.pp.mergeTags([source.id], target.id)
      await refresh()
      toast(`已合并，影响 ${r.affectedEntries} 条记录`, 'ok')
    } catch (e) {
      toast(cleanError(e), 'err')
    }
  }

  return (
    <aside className="detail">
      <div className="detail-head">
        <div className="dh-text">
          <div className="dh-title">标签管理</div>
          <div className="dh-sub">
            {data.tags.length} 个标签 · 选中 {selected.length}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={() => setPanel('none')} title="关闭">
          <Icon name="close" size={15} strokeWidth={2.2} />
        </button>
      </div>

      <div className="tm-toolbar">
        <div className="tp-input tm-search">
          <Icon name="search" size={13} />
          <input
            value={q}
            placeholder="搜索标签…"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button type="button" className="link-btn" onClick={() => setSelected(visible.map((t) => t.id))}>
          全选
        </button>
        <button type="button" className="link-btn" onClick={() => setSelected([])}>
          清空
        </button>
      </div>

      <div className="detail-scroll">
        {data.tags.length === 0 ? (
          <Empty
            icon="tag"
            title="还没有标签"
            desc="标签会在导入或编辑记录时创建；也可以先在批量栏里新建。"
          />
        ) : visible.length === 0 ? (
          <div className="muted pad">没有匹配的标签</div>
        ) : (
          <div className="tm-list">
            {visible.map((t) => {
              const on = selected.includes(t.id)
              const count = counts.get(t.id) ?? 0
              return (
                <div
                  key={t.id}
                  className={'tm-row' + (on ? ' sel' : '')}
                  onClick={() => toggle(t.id)}
                  role="button"
                  tabIndex={0}
                >
                  <span className={'tm-check' + (on ? ' on' : '')}>
                    <Icon name="check" size={10} strokeWidth={3} />
                  </span>

                  {renaming?.id === t.id ? (
                    <input
                      className="tm-rename"
                      autoFocus
                      value={renaming.value}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenaming({ id: t.id, value: e.target.value })}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') void commitRename()
                        if (e.key === 'Escape') {
                          renameDone.current = true
                          setRenaming(null)
                        }
                      }}
                      onBlur={() => {
                        if (!renameDone.current) void commitRename()
                      }}
                    />
                  ) : (
                    <span className="tm-name ellipsis">{t.name}</span>
                  )}

                  <span className="tm-group">{groups.get(t.groupId)?.name ?? '未分组'}</span>
                  <span className="tm-count">{count} 条</span>

                  <button
                    type="button"
                    className="icon-btn xs"
                    title="重命名"
                    onClick={(e) => {
                      e.stopPropagation()
                      startRename(t)
                    }}
                  >
                    <Icon name="edit" size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn xs"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation()
                      void removeOne(t)
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="tm-suggest">
            <div className="tm-suggest-head">
              <span>近似重复建议</span>
              <span className="tm-suggest-count">{suggestions.length}</span>
            </div>
            {suggestions.map(({ a, b, reason }) => {
              const ca = counts.get(a.id) ?? 0
              const cb = counts.get(b.id) ?? 0
              const target = ca >= cb ? a : b
              return (
                <div className="tm-sug" key={a.id + ':' + b.id}>
                  <div className="tm-sug-text">
                    <div className="tm-sug-names">
                      <b>{a.name}</b>
                      <span className="tm-sug-arrow">↔</span>
                      <b>{b.name}</b>
                    </div>
                    <div className="tm-sug-reason">
                      {reason} · {ca} / {cb} 条 · 保留「{target.name}」
                    </div>
                  </div>
                  <button type="button" className="link-btn" onClick={() => void mergePair(a, b)}>
                    合并
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="tm-actions">
          <span className="tm-actions-count">{selected.length} 个已选</span>
          <button
            type="button"
            className="btn small"
            disabled={selected.length < 2}
            onClick={() => setMergeOpen(true)}
          >
            合并到…
          </button>
          <button
            type="button"
            className="btn small"
            disabled={selected.length !== 1}
            onClick={() => {
              const t = data.tags.find((x) => x.id === selected[0])
              if (t) startRename(t)
            }}
          >
            重命名
          </button>
          <button type="button" className="btn small danger" onClick={() => void removeSelected()}>
            删除
          </button>
        </div>
      )}

      <Modal open={mergeOpen} onClose={() => setMergeOpen(false)} width={420} label="选择合并目标">
        <div className="mini-modal-head">
          <div className="mm-title">合并到哪个标签？</div>
          <div className="mm-sub">
            其余 {Math.max(0, selected.length - 1)} 个标签会被删除，引用转到目标标签
          </div>
        </div>
        <div className="mini-modal-body">
          {selected.map((id) => {
            const t = data.tags.find((x) => x.id === id)
            if (!t) return null
            return (
              <button
                key={id}
                type="button"
                className="tag-pick-row"
                onClick={() => void mergeInto(id)}
              >
                <Icon name="tag" size={13} />
                <span className="ellipsis">{t.name}</span>
                <em>{counts.get(id) ?? 0} 条</em>
                <Icon name="swap" size={12} />
              </button>
            )
          })}
        </div>
      </Modal>
    </aside>
  )
}
