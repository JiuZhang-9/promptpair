import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelKind, ModelPreset } from '../../../shared/types'
import { MODEL_KIND_LABEL } from '../../../shared/types'
import { useStore } from '../store'
import { levenshtein, normalizeName, versionKey } from '../similar'
import { Empty, Icon, Modal } from './ui'

function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

interface Suggestion {
  a: ModelPreset
  b: ModelPreset
  reason: string
}

/**
 * 模型词表管理：按使用数排序、重命名（可选同步历史）、合并疑似重复、删除、恢复默认。
 * 词表存在 library.json 里，随库搬迁；条目上的 params.model 仍是字符串快照。
 */
export default function ModelManager(): React.ReactElement {
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const data = useStore((s) => s.data)
  const refresh = useStore((s) => s.refresh)
  const toast = useStore((s) => s.toast)

  const [q, setQ] = useState('')
  const [adding, setAdding] = useState<{ name: string; kind: ModelKind } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; value: string; sync: boolean } | null>(null)
  const renameDone = useRef(false)
  const addRef = useRef<HTMLInputElement>(null)

  const models = useMemo(() => data.models ?? [], [data.models])

  /** 词表使用数：按名称（归一化）统计条目 */
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of data.entries) {
      const n = normalizeName(e.params?.model ?? '')
      if (n) m.set(n, (m.get(n) ?? 0) + 1)
    }
    return m
  }, [data.entries])

  const countOf = (name: string): number => counts.get(normalizeName(name)) ?? 0

  /** 条目里出现、但词表里没有的模型名（老库散装值） */
  const unlisted = useMemo(() => {
    const known = new Set(models.map((m) => normalizeName(m.name)))
    const out = new Map<string, { name: string; count: number; kind: ModelKind }>()
    for (const e of data.entries) {
      const raw = (e.params?.model ?? '').trim()
      if (!raw) continue
      const key = normalizeName(raw)
      if (known.has(key)) continue
      const kinds = e.assetIds.map((id) => data.assets.find((a) => a.id === id)?.kind)
      const kind: ModelKind = kinds.includes('video') ? 'video' : kinds.includes('image') ? 'image' : 'other'
      const cur = out.get(key)
      if (cur) cur.count++
      else out.set(key, { name: raw, count: 1, kind })
    }
    return Array.from(out.values()).sort((a, b) => b.count - a.count)
  }, [data.entries, data.assets, models])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return models
      .filter((m) => (needle ? m.name.toLowerCase().includes(needle) : true))
      .sort(
        (a, b) =>
          countOf(b.name) - countOf(a.name) || a.name.localeCompare(b.name, 'zh-Hans-CN')
      )
  }, [models, counts, q])

  const suggestions = useMemo<Suggestion[]>(() => {
    const out: Suggestion[] = []
    for (let i = 0; i < models.length; i++) {
      for (let j = i + 1; j < models.length; j++) {
        const A = normalizeName(models[i].name)
        const B = normalizeName(models[j].name)
        if (!A || !B) continue
        // 即梦 3.0 / 即梦 4.0 只差一个字符，但它们是不同版本，不能提示重复。
        const va = versionKey(A)
        const vb = versionKey(B)
        if (va && vb && va !== vb) continue
        let reason = ''
        if (A === B) reason = '名称相同'
        else {
          const d = levenshtein(A, B)
          const limit = Math.min(Array.from(A).length, Array.from(B).length) <= 3 ? 1 : 2
          if (d <= limit) reason = `编辑距离 ${d}`
          else if (Array.from(A).length >= 2 && Array.from(B).length >= 2) {
            const [short, long] = A.length <= B.length ? [A, B] : [B, A]
            if (long.includes(short) && Array.from(short).length / Array.from(long).length >= 0.5)
              reason = '名称包含'
          }
        }
        if (reason) out.push({ a: models[i], b: models[j], reason })
      }
    }
    return out
      .sort(
        (x, y) =>
          countOf(y.a.name) + countOf(y.b.name) - (countOf(x.a.name) + countOf(x.b.name))
      )
      .slice(0, 20)
  }, [models, counts])

  useEffect(() => {
    if (adding) setTimeout(() => addRef.current?.focus(), 40)
  }, [adding])

  if (panel !== 'models') return <></>

  const startRename = (m: ModelPreset): void => {
    renameDone.current = false
    setRenaming({ id: m.id, value: m.name, sync: countOf(m.name) > 0 })
  }

  const commitRename = async (): Promise<void> => {
    if (!renaming || renameDone.current) return
    const name = renaming.value.trim()
    const cur = models.find((m) => m.id === renaming.id)
    if (!cur) {
      renameDone.current = true
      setRenaming(null)
      return
    }
    if (!name || name === cur.name) {
      if (name === cur.name) {
        renameDone.current = true
        setRenaming(null)
      }
      return
    }
    renameDone.current = true
    try {
      const r = await window.pp.updateModel(cur.id, { name }, renaming.sync)
      await refresh()
      setRenaming(null)
      toast(
        r.affectedEntries > 0
          ? `已重命名，${r.affectedEntries} 条历史记录同步`
          : '已重命名',
        'ok'
      )
    } catch (e) {
      renameDone.current = false
      toast(cleanError(e), 'err')
    }
  }

  const addModel = async (): Promise<void> => {
    if (!adding) return
    const name = adding.name.trim()
    if (!name) {
      setAdding(null)
      return
    }
    try {
      await window.pp.createModel(name, adding.kind)
      await refresh()
      setAdding(null)
      toast(`已加入词表「${name}」`, 'ok')
    } catch (e) {
      toast(cleanError(e), 'err')
    }
  }

  const removeOne = async (m: ModelPreset): Promise<void> => {
    const n = countOf(m.name)
    const extra = n > 0 ? `\n${n} 条记录保留原文，可稍后手动归并。` : ''
    if (!window.confirm(`从词表删除「${m.name}」？${extra}`)) return
    try {
      await window.pp.deleteModel(m.id)
      await refresh()
      toast('已从词表删除', 'ok')
    } catch (e) {
      toast(cleanError(e), 'err')
    }
  }

  const mergePair = async (a: ModelPreset, b: ModelPreset): Promise<void> => {
    const target = countOf(a.name) >= countOf(b.name) ? a : b
    const source = target.id === a.id ? b : a
    if (
      !window.confirm(
        `把「${source.name}」合并到「${target.name}」？\n\n条目里的「${source.name}」会统一改成「${target.name}」，然后从词表删除来源。`
      )
    )
      return
    try {
      const r = await window.pp.mergeModels([source.id], target.id, true)
      await refresh()
      toast(`已合并，同步 ${r.affectedEntries} 条记录`, 'ok')
    } catch (e) {
      toast(cleanError(e), 'err')
    }
  }

  const adopt = async (name: string, kind: ModelKind): Promise<void> => {
    try {
      await window.pp.createModel(name, kind)
      await refresh()
      toast(`已加入词表「${name}」`, 'ok')
    } catch (e) {
      toast(cleanError(e), 'err')
    }
  }

  const reset = async (): Promise<void> => {
    if (!window.confirm('恢复默认模型词表？\n自定义模型会从词表移除；条目里的模型名保留原文。'))
      return
    try {
      await window.pp.resetModels()
      await refresh()
      toast('已恢复默认词表', 'ok')
    } catch (e) {
      toast(cleanError(e), 'err')
    }
  }

  return (
    <aside className="detail">
      <div className="detail-head">
        <div className="dh-text">
          <div className="dh-title">模型管理</div>
          <div className="dh-sub">
            {models.length} 个模型 · 词表随库走
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={() => setPanel('none')} title="关闭">
          <Icon name="close" size={15} strokeWidth={2.2} />
        </button>
      </div>

      <div className="tm-toolbar">
        <div className="tp-input tm-search">
          <Icon name="search" size={13} />
          <input value={q} placeholder="搜索模型…" onChange={(e) => setQ(e.target.value)} />
        </div>
        <button
          type="button"
          className="link-btn"
          onClick={() => setAdding({ name: '', kind: 'video' })}
        >
          <Icon name="plus" size={11} strokeWidth={2.4} /> 新建
        </button>
        <button type="button" className="link-btn" onClick={() => void reset()}>
          恢复默认
        </button>
      </div>

      <div className="detail-scroll">
        <p className="mm-note">
          录入时只能从词表选择；输入新名字会自动加入词表。词表存在 <code>library.json</code>{' '}
          里，随库搬迁、随分享包带走。
        </p>

        {adding && (
          <div className="mm-add">
            <input
              ref={addRef}
              className="mm-add-name"
              value={adding.name}
              placeholder="模型名，如 即梦 3.0"
              onChange={(e) => setAdding({ ...adding, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addModel()
                if (e.key === 'Escape') setAdding(null)
              }}
            />
            <select
              className="mm-add-kind"
              value={adding.kind}
              onChange={(e) => setAdding({ ...adding, kind: e.target.value as ModelKind })}
              aria-label="模型类型"
            >
              {(['video', 'image', 'other'] as ModelKind[]).map((k) => (
                <option key={k} value={k}>
                  {MODEL_KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <button type="button" className="btn small" onClick={() => void addModel()}>
              加入
            </button>
            <button type="button" className="btn small ghost" onClick={() => setAdding(null)}>
              取消
            </button>
          </div>
        )}

        {models.length === 0 ? (
          <Empty
            icon="tag"
            title="词表是空的"
            desc="新建模型，或点「恢复默认」种入常用模型。"
          />
        ) : visible.length === 0 ? (
          <div className="muted pad">没有匹配的模型</div>
        ) : (
          <div className="tm-list">
            {visible.map((m) => {
              const count = countOf(m.name)
              return (
                <div key={m.id} className="tm-row mm-row">
                  {renaming?.id === m.id ? (
                    <input
                      className="tm-rename"
                      autoFocus
                      value={renaming.value}
                      onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
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
                    <span
                      className="tm-name ellipsis"
                      title="双击重命名"
                      onDoubleClick={() => startRename(m)}
                    >
                      {m.name}
                    </span>
                  )}

                  <span className={'mm-kind ' + m.kind}>{MODEL_KIND_LABEL[m.kind]}</span>
                  <span className="tm-count">{count} 条</span>

                  {renaming?.id === m.id && count > 0 && (
                    <label className="mm-sync" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={renaming.sync}
                        onChange={(e) => setRenaming({ ...renaming, sync: e.target.checked })}
                      />
                      同步历史
                    </label>
                  )}

                  <button
                    type="button"
                    className="icon-btn xs"
                    title="重命名"
                    onClick={() => startRename(m)}
                  >
                    <Icon name="edit" size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn xs"
                    title="从词表删除"
                    onClick={() => void removeOne(m)}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {unlisted.length > 0 && (
          <div className="tm-suggest">
            <div className="tm-suggest-head">
              <span>未入词表的模型（老库散装值）</span>
              <span className="tm-suggest-count">{unlisted.length}</span>
            </div>
            {unlisted.map((u) => (
              <div className="tm-sug" key={u.name}>
                <div className="tm-sug-text">
                  <div className="tm-sug-names">
                    <b>{u.name}</b>
                  </div>
                  <div className="tm-sug-reason">
                    {u.count} 条记录 · 建议按「{MODEL_KIND_LABEL[u.kind]}」
                  </div>
                </div>
                <button type="button" className="link-btn" onClick={() => void adopt(u.name, u.kind)}>
                  加入词表
                </button>
              </div>
            ))}
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="tm-suggest">
            <div className="tm-suggest-head">
              <span>疑似重复建议</span>
              <span className="tm-suggest-count">{suggestions.length}</span>
            </div>
            {suggestions.map(({ a, b, reason }) => {
              const ca = countOf(a.name)
              const cb = countOf(b.name)
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
    </aside>
  )
}
