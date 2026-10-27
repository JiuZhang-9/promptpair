import React, { useMemo, useState } from 'react'
import { useStore, tagMap, groupMap, selectEntries } from '../store'
import { Icon } from './ui'

// 单色设计：集合/标签组一律用灰阶，不用彩色
const PRESET_COLORS = ['#c7c7cc', '#a1a1aa', '#8e8e93', '#71717a', '#5a5a60', '#b4b4bb', '#3f3f46']

function Section({
  title,
  action,
  children,
  collapsible = false,
  defaultOpen = true
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="sb-section">
      <div className="sb-head">
        <button
          type="button"
          className={'sb-title' + (collapsible ? ' clickable' : '')}
          onClick={() => collapsible && setOpen((v) => !v)}
        >
          {collapsible && (
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} strokeWidth={2.2} />
          )}
          <span>{title}</span>
        </button>
        {action}
      </div>
      {(!collapsible || open) && <div className="sb-body">{children}</div>}
    </div>
  )
}

export default function Sidebar(): React.ReactElement {
  const data = useStore((s) => s.data)
  const root = useStore((s) => s.root)
  const q = useStore((s) => s.q)
  const collectionId = useStore((s) => s.collectionId)
  const tagIds = useStore((s) => s.tagIds)
  const tagMode = useStore((s) => s.tagMode)
  const ratingMin = useStore((s) => s.ratingMin)
  const onlyFavorite = useStore((s) => s.onlyFavorite)
  const kind = useStore((s) => s.kind)
  const platform = useStore((s) => s.platform)
  const modelFilter = useStore((s) => s.model)
  const setModelFilter = useStore((s) => s.setModelFilter)
  const panel = useStore((s) => s.panel)

  const setCollection = useStore((s) => s.setCollection)
  const toggleTag = useStore((s) => s.toggleTag)
  const clearTags = useStore((s) => s.clearTags)
  const setTagMode = useStore((s) => s.setTagMode)
  const setRatingMin = useStore((s) => s.setRatingMin)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const setKind = useStore((s) => s.setKind)
  const setPlatform = useStore((s) => s.setPlatform)
  const setPanel = useStore((s) => s.setPanel)
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen)
  const resetFilters = useStore((s) => s.resetFilters)
  const toast = useStore((s) => s.toast)
  const refresh = useStore((s) => s.refresh)
  const scanDups = useStore((s) => s.scanDups)

  const tags = useMemo(() => tagMap(data), [data])
  const groups = useMemo(() => groupMap(data), [data])

  // 标签计数：基于「除标签筛选外」的集合，方便看出交叉组合还剩多少
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>()
    const noTagFilter: typeof data.entries = data.entries.filter((e) => {
      if (collectionId && !e.collectionIds.includes(collectionId)) return false
      if (onlyFavorite && !e.favorite) return false
      if (ratingMin > 0 && e.rating < ratingMin) return false
      if (platform && (e.source?.platform ?? '') !== platform) return false
      return true
    })
    for (const e of noTagFilter) for (const t of e.tagIds) m.set(t, (m.get(t) ?? 0) + 1)
    return m
  }, [data.entries, collectionId, onlyFavorite, ratingMin, platform])

  const modelChips = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of data.entries) {
      const raw = (e.params?.model ?? '').trim()
      if (!raw) continue
      const key = raw.toLowerCase().replace(/\s+/g, ' ')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const names = new Map<string, string>()
    for (const m of data.models ?? []) {
      names.set(m.name.trim().toLowerCase().replace(/\s+/g, ' '), m.name)
    }
    for (const e of data.entries) {
      const raw = (e.params?.model ?? '').trim()
      if (!raw) continue
      const key = raw.toLowerCase().replace(/\s+/g, ' ')
      if (!names.has(key)) names.set(key, raw)
    }
    return Array.from(names.entries())
      .map(([key, name]) => ({ name, count: counts.get(key) ?? 0 }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 16)
  }, [data.entries, data.models])

  const platforms = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of data.entries) {
      const p = e.source?.platform || '未标注'
      m.set(p, (m.get(p) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [data.entries])

  const resultCount = useStore((s) => selectEntries(s).length)

  const groupedTags = useMemo(() => {
    const byGroup = new Map<string, { id: string; name: string }[]>()
    for (const t of data.tags) {
      const gid = t.groupId && groups.has(t.groupId) ? t.groupId : ''
      const arr = byGroup.get(gid) ?? []
      arr.push({ id: t.id, name: t.name })
      byGroup.set(gid, arr)
    }
    for (const [, arr] of byGroup) {
      arr.sort((a, b) => (tagCounts.get(b.id) ?? 0) - (tagCounts.get(a.id) ?? 0))
    }
    return byGroup
  }, [data.tags, groups, tagCounts])

  const sortedGroups = useMemo(
    () => [...data.tagGroups].sort((a, b) => a.order - b.order),
    [data.tagGroups]
  )

  const [newColl, setNewColl] = useState('')
  const [addingColl, setAddingColl] = useState(false)

  const addCollection = async (): Promise<void> => {
    const name = newColl.trim()
    if (!name) {
      setAddingColl(false)
      return
    }
    try {
      const c = await window.pp.createCollection(name, PRESET_COLORS[data.collections.length % PRESET_COLORS.length])
      setNewColl('')
      setAddingColl(false)
      await refresh()
      setCollection(c.id)
      toast(`已创建集合「${name}」`, 'ok')
    } catch (e) {
      toast('创建失败：' + (e as Error).message, 'err')
    }
  }

  const renameCollection = async (id: string, cur: string): Promise<void> => {
    const name = window.prompt('重命名集合', cur)
    if (!name || name === cur) return
    await window.pp.updateCollection(id, { name })
    await refresh()
  }

  const deleteCollection = async (id: string, name: string): Promise<void> => {
    if (!window.confirm(`删除集合「${name}」？\n记录本身不会被删除，只是不再归属这个集合。`)) return
    await window.pp.deleteCollection(id)
    if (collectionId === id) setCollection(null)
    await refresh()
    toast('集合已删除', 'ok')
  }

  const hasFilter =
    !!q.trim() || !!collectionId || tagIds.length > 0 || ratingMin > 0 || onlyFavorite || kind !== 'all' || !!platform

  return (
    <aside className="sidebar">
      <div className="lib-card">
        <div className="lib-top">
          <div className="lib-badge">
            <Icon name="package" size={15} />
          </div>
          <div className="lib-meta">
            <div className="lib-name" title={root}>
              {data.name || '我的素材库'}
            </div>
            <div className="lib-path" title={root}>
              {root}
            </div>
          </div>
        </div>
        <div className="lib-stats">
          <div>
            <b>{data.entries.length}</b>
            <span>条记录</span>
          </div>
          <div>
            <b>{data.assets.length}</b>
            <span>个媒体</span>
          </div>
          <div>
            <b>{data.tags.length}</b>
            <span>个标签</span>
          </div>
        </div>
        <button type="button" className="lib-open" onClick={() => window.pp.revealLibrary()}>
          <Icon name="folder" size={13} /> 在资源管理器中打开
        </button>
      </div>

      <div className="sb-scroll">
        <Section title="浏览">
          <button
            type="button"
            className={'nav-item' + (collectionId === null && !onlyFavorite ? ' on' : '')}
            onClick={() => {
              setCollection(null)
              if (onlyFavorite) toggleFavorite()
            }}
          >
            <Icon name="layers" size={14} />
            <span className="nav-label">全部提示词</span>
            <em>{data.entries.length}</em>
          </button>
          <button
            type="button"
            className={'nav-item' + (onlyFavorite ? ' on' : '')}
            onClick={() => toggleFavorite()}
          >
            <Icon name="star" size={14} />
            <span className="nav-label">收藏</span>
            <em>{data.entries.filter((e) => e.favorite).length}</em>
          </button>
        </Section>

        <Section
          title="集合"
          action={
            <button type="button" className="icon-btn xs" onClick={() => setAddingColl(true)} title="新建集合">
              <Icon name="plus" size={13} strokeWidth={2.2} />
            </button>
          }
        >
          {addingColl && (
            <div className="inline-add">
              <input
                autoFocus
                value={newColl}
                placeholder="集合名称"
                onChange={(e) => setNewColl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addCollection()
                  if (e.key === 'Escape') {
                    setAddingColl(false)
                    setNewColl('')
                  }
                }}
                onBlur={() => void addCollection()}
              />
            </div>
          )}
          {data.collections.length === 0 && !addingColl && (
            <div className="sb-hint">还没有集合。集合像文件夹，但一条记录可以属于多个集合。</div>
          )}
          {data.collections.map((c) => {
            const n = data.entries.filter((e) => e.collectionIds.includes(c.id)).length
            return (
              <div
                key={c.id}
                className={'nav-item' + (collectionId === c.id ? ' on' : '')}
                onClick={() => setCollection(collectionId === c.id ? null : c.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  void renameCollection(c.id, c.name)
                }}
                role="button"
                tabIndex={0}
              >
                <span className="coll-dot" style={{ background: c.color }} />
                <span className="nav-label">{c.name}</span>
                <em>{n}</em>
                <button
                  type="button"
                  className="row-del"
                  title="删除集合"
                  onClick={(e) => {
                    e.stopPropagation()
                    void deleteCollection(c.id, c.name)
                  }}
                >
                  <Icon name="close" size={11} strokeWidth={2.2} />
                </button>
              </div>
            )
          })}
        </Section>

        <Section title="类型">
          <div className="seg">
            {(
              [
                ['all', '全部', 'grid'],
                ['image', '图片', 'image'],
                ['video', '视频', 'video']
              ] as const
            ).map(([k, label, icon]) => (
              <button
                key={k}
                type="button"
                className={'seg-btn' + (kind === k ? ' on' : '')}
                onClick={() => setKind(k)}
              >
                <Icon name={icon} size={13} />
                {label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="评分" collapsible defaultOpen={false}>
          <div className="rating-filter">
            {[5, 4, 3, 2, 1].map((r) => (
              <button
                key={r}
                type="button"
                className={'rating-row' + (ratingMin === r ? ' on' : '')}
                onClick={() => setRatingMin(ratingMin === r ? 0 : r)}
              >
                <Icon name="star" size={12} />
                <span>{r} 星以上</span>
              </button>
            ))}
          </div>
        </Section>

        {platforms.length > 1 && (
          <Section title="来源平台" collapsible defaultOpen={false}>
            {platforms.map(([p, n]) => (
              <button
                key={p}
                type="button"
                className={'nav-item' + (platform === p ? ' on' : '')}
                onClick={() => setPlatform(platform === p ? null : p)}
              >
                <Icon name="link" size={13} />
                <span className="nav-label">{p}</span>
                <em>{n}</em>
              </button>
            ))}
          </Section>
        )}

        <Section
          title="模型"
          action={
            <div className="sb-head-actions">
              <button type="button" className="link-btn" onClick={() => setPanel('models')}>
                管理
              </button>
              {modelFilter && (
                <button type="button" className="link-btn" onClick={() => setModelFilter(null)}>
                  清空
                </button>
              )}
            </div>
          }
        >
          {modelChips.length === 0 ? (
            <div className="sb-hint">在录入或编辑时，从模型词表里选择。</div>
          ) : (
            <div className="tag-list">
              {modelChips.map((m) => (
                <button
                  key={m.name}
                  type="button"
                  className={'tagchip' + (modelFilter === m.name ? ' on' : '')}
                  onClick={() => setModelFilter(modelFilter === m.name ? null : m.name)}
                  title="点击筛选 · 再点取消"
                >
                  <span className="gdot" />
                  {m.name}
                  <em>{m.count}</em>
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="标签"
          action={
            <div className="sb-head-actions">
              <button type="button" className="link-btn" onClick={() => setPanel('tags')}>
                管理
              </button>
              {tagIds.length > 0 && (
                <button type="button" className="link-btn" onClick={clearTags}>
                  清空
                </button>
              )}
            </div>
          }
        >
          {data.tags.length === 0 && (
            <div className="sb-hint">
              还没有标签。在录入时输入标签，或导入时按文件夹名自动生成。
            </div>
          )}

          {tagIds.length > 1 && (
            <div className="seg tiny">
              <button
                type="button"
                className={'seg-btn' + (tagMode === 'or' ? ' on' : '')}
                onClick={() => setTagMode('or')}
              >
                任一
              </button>
              <button
                type="button"
                className={'seg-btn' + (tagMode === 'and' ? ' on' : '')}
                onClick={() => setTagMode('and')}
              >
                同时满足
              </button>
            </div>
          )}

          {[...groupedTags.entries()]
            .filter(([gid]) => gid !== '' || (groupedTags.get('')?.length ?? 0) > 0)
            .sort((a, b) => {
              if (a[0] === '') return 1
              if (b[0] === '') return -1
              const ga = groups.get(a[0])
              const gb = groups.get(b[0])
              return (ga?.order ?? 0) - (gb?.order ?? 0)
            })
            .map(([gid, list]) => {
              const g = groups.get(gid)
              const color = g?.color ?? '#8b95a8'
              return (
                <div className="tag-group" key={gid || 'none'}>
                  <div className="tag-group-name">
                    <span className="gdot" style={{ background: color }} />
                    {g?.name ?? '未分组'}
                  </div>
                  <div className="tag-list">
                    {list.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={'tagchip' + (tagIds.includes(t.id) ? ' on' : '')}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleTag(t.id)
                        }}
                        title={`点击筛选 · 右键重命名/移动/删除`}
                        onContextMenu={async (e) => {
                          e.preventDefault()
                          const act = window.prompt(
                            `标签「${t.name}」\n\n` +
                              `输入新名字 = 重命名\n` +
                              `输入 - = 删除\n` +
                              `输入 = 目标标签名 = 合并到目标标签\n` +
                              `直接回车取消。`,
                            t.name
                          )
                          if (act === null || act === t.name) return

                          if (act === '-') {
                            if (!window.confirm(`删除标签「${t.name}」？所有记录上的该标签都会被移除。`)) return
                            await window.pp.deleteTag(t.id)
                          } else if (act.startsWith('=')) {
                            const targetName = act.slice(1).trim()
                            if (!targetName) return
                            const target = data.tags.find(
                              (x) => x.name.trim().toLowerCase() === targetName.toLowerCase()
                            )
                            if (!target) {
                              toast(`没有找到标签「${targetName}」`, 'err')
                              return
                            }
                            if (target.id === t.id) return
                            const affected = data.entries.filter((x) => x.tagIds.includes(t.id)).length
                            if (
                              !window.confirm(
                                `把「${t.name}」合并到「${target.name}」？\n\n会影响 ${affected} 条记录，合并后「${t.name}」会被删除。`
                              )
                            )
                              return
                            try {
                              await window.pp.mergeTags([t.id], target.id)
                            } catch (err) {
                              toast((err as Error).message, 'err')
                              return
                            }
                          } else if (act.trim()) {
                            try {
                              await window.pp.updateTag(t.id, { name: act.trim() })
                            } catch (err) {
                              toast((err as Error).message, 'err')
                              return
                            }
                          }
                          await refresh()
                        }}
                      >
                        <span className="ellipsis">{t.name}</span>
                        <span className="tagcount">{tagCounts.get(t.id) ?? 0}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
        </Section>

        <Section title="工具" collapsible defaultOpen>
          <button type="button" className="nav-item" onClick={() => setShortcutsOpen(true)}>
            <Icon name="help" size={14} />
            <span className="nav-label">快捷键帮助</span>
          </button>
          <button
            type="button"
            className={'nav-item' + (panel === 'tags' ? ' on' : '')}
            onClick={() => setPanel(panel === 'tags' ? 'none' : 'tags')}
          >
            <Icon name="tag" size={14} />
            <span className="nav-label">标签管理</span>
          </button>
          <button
            type="button"
            className={'nav-item' + (panel === 'models' ? ' on' : '')}
            onClick={() => setPanel(panel === 'models' ? 'none' : 'models')}
          >
            <Icon name="layers" size={14} />
            <span className="nav-label">模型管理</span>
          </button>
          <button
            type="button"
            className={'nav-item' + (panel === 'dups' ? ' on' : '')}
            onClick={() => void scanDups()}
          >
            <Icon name="copy" size={14} />
            <span className="nav-label">重复图检测</span>
          </button>
          <button
            type="button"
            className={'nav-item' + (panel === 'settings' ? ' on' : '')}
            onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
          >
            <Icon name="settings" size={14} />
            <span className="nav-label">设置</span>
          </button>
        </Section>
      </div>

      <div className="sb-foot">
        <div className="result-count">
          当前筛选 <b>{resultCount}</b> 条
        </div>
        {hasFilter && (
          <button type="button" className="link-btn" onClick={resetFilters}>
            清除全部筛选
          </button>
        )}
      </div>
    </aside>
  )
}
