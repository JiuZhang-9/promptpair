import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Collection } from '../../../shared/types'
import { useStore, tagMap, groupMap, selectEntries } from '../store'
import { parseQuery } from '../query'
import { Icon, Modal } from './ui'

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

  const setCollection = useStore((s) => s.setCollection)
  const toggleTag = useStore((s) => s.toggleTag)
  const switchTag = useStore((s) => s.switchTag)
  const clearTags = useStore((s) => s.clearTags)
  const setTagMode = useStore((s) => s.setTagMode)
  const setRatingMin = useStore((s) => s.setRatingMin)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const setKind = useStore((s) => s.setKind)
  const setPlatform = useStore((s) => s.setPlatform)
  const setPanel = useStore((s) => s.setPanel)
  const saveCurrentView = useStore((s) => s.saveCurrentView)
  const applyView = useStore((s) => s.applyView)
  const deleteView = useStore((s) => s.deleteView)
  const resetFilters = useStore((s) => s.resetFilters)
  const toast = useStore((s) => s.toast)
  const refresh = useStore((s) => s.refresh)
  const askConfirm = useStore((s) => s.askConfirm)

  const views = data.views ?? []
  const tags = useMemo(() => tagMap(data), [data.tags])
  const groups = useMemo(() => groupMap(data), [data.tagGroups])

  // 计数跟随当前搜索：算标签时忽略标签筛选本身，算集合时忽略集合筛选本身
  const tagBase = useStore(useShallow((s) => selectEntries(s, { ignoreTags: true })))
  const collBase = useStore(useShallow((s) => selectEntries(s, { ignoreCollection: true })))

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of tagBase) for (const t of e.tagIds) m.set(t, (m.get(t) ?? 0) + 1)
    return m
  }, [tagBase])

  const collCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of collBase) for (const id of e.collectionIds) m.set(id, (m.get(id) ?? 0) + 1)
    return m
  }, [collBase])

  // 集合操作弹窗显示全库总数，不受当前搜索影响
  const totalCollCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of data.entries) for (const id of e.collectionIds) m.set(id, (m.get(id) ?? 0) + 1)
    return m
  }, [data.entries])

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
  const queryTags = useMemo(
    () => parseQuery(q).tags.map((x) => x.trim().toLowerCase()).filter(Boolean),
    [q]
  )

  const groupedTags = useMemo(() => {
    const byGroup = new Map<string, { id: string; name: string }[]>()
    for (const t of data.tags) {
      const n = tagCounts.get(t.id) ?? 0
      // 搜索标签时只保留被搜索的；平时只保留当前结果里出现的（已选中的始终保留）
      const name = t.name.toLowerCase()
      const visible = tagIds.includes(t.id)
        ? true
        : queryTags.length
          ? queryTags.some((needle) => name.includes(needle))
          : n > 0
      if (!visible) continue
      const gid = t.groupId && groups.has(t.groupId) ? t.groupId : ''
      const arr = byGroup.get(gid) ?? []
      arr.push({ id: t.id, name: t.name })
      byGroup.set(gid, arr)
    }
    for (const [, arr] of byGroup) {
      arr.sort((a, b) => (tagCounts.get(b.id) ?? 0) - (tagCounts.get(a.id) ?? 0))
    }
    return byGroup
  }, [data.tags, groups, tagCounts, queryTags, tagIds])

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

  const [collMenu, setCollMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [targetMode, setTargetMode] = useState<'move' | 'merge' | null>(null)
  const [targetSource, setTargetSource] = useState<string | null>(null)
  const [targetPick, setTargetPick] = useState<string | null>(null)
  const collMenuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!collMenu || !collMenuRef.current) return
    const el = collMenuRef.current
    const r = el.getBoundingClientRect()
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, collMenu.x))}px`
    el.style.top = `${Math.max(8, Math.min(window.innerHeight - r.height - 8, collMenu.y))}px`
  }, [collMenu])

  useEffect(() => {
    if (!collMenu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setCollMenu(null)
    }
    const onDown = (e: MouseEvent): void => {
      if (collMenuRef.current && !collMenuRef.current.contains(e.target as Node)) setCollMenu(null)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [collMenu])

  const deleteCollection = (c: Collection): void => {
    const count = data.entries.filter((e) => e.collectionIds.includes(c.id)).length
    setCollMenu(null)
    askConfirm({
      title: '删除集合',
      message: `确定删除集合「${c.name}」？\n其中 ${count} 条记录不会被删除，只会不再归属于这个集合。`,
      confirmLabel: '删除集合',
      danger: true,
      onConfirm: async () => {
        await window.pp.deleteCollection(c.id)
        if (collectionId === c.id) setCollection(null)
        await refresh()
        toast(`已删除集合「${c.name}」`, 'ok')
      }
    })
  }

  const openTarget = (mode: 'move' | 'merge', source: Collection): void => {
    setCollMenu(null)
    setTargetMode(mode)
    setTargetSource(source.id)
    setTargetPick(null)
  }

  const targetSourceColl = data.collections.find((c) => c.id === targetSource)
  const targetOther = data.collections.filter((c) => c.id !== targetSource)
  const targetPickColl = data.collections.find((c) => c.id === targetPick)
  const menuColl = data.collections.find((c) => c.id === collMenu?.id)

  const runTarget = async (): Promise<void> => {
    if (!targetMode || !targetSource || !targetPick) return
    try {
      if (targetMode === 'move') {
        const r = await window.pp.moveCollectionContents(targetSource, targetPick)
        if (collectionId === targetSource) setCollection(targetPick)
        toast(`已把 ${r.moved} 条内容移动到「${r.target.name}」`, 'ok')
      } else {
        const r = await window.pp.mergeCollections([targetSource], targetPick)
        if (collectionId === targetSource) setCollection(targetPick)
        toast(`已把 ${r.moved} 条内容并入「${r.target.name}」，来源集合已删除`, 'ok')
      }
      setTargetMode(null)
      setTargetSource(null)
      setTargetPick(null)
      await refresh()
    } catch (e) {
      toast((e as Error).message, 'err')
    }
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
            <Icon name="heart" size={14} />
            <span className="nav-label">收藏</span>
            <em>{data.entries.filter((e) => e.favorite).length}</em>
          </button>
        </Section>

        <Section
          title="视图"
          action={
            <button
              type="button"
              className="icon-btn xs"
              title="把当前搜索、筛选和排序保存为视图"
              onClick={() => {
                const name = window.prompt('保存当前视图，输入名称：', '')
                if (name?.trim()) void saveCurrentView(name)
              }}
            >
              <Icon name="plus" size={13} strokeWidth={2.2} />
            </button>
          }
        >
          {views.length === 0 && (
            <div className="sb-hint">把常用搜索、标签和排序存成视图，下次一点就回来。</div>
          )}
          {views.map((v) => (
            <div
              key={v.id}
              className="nav-item"
              role="button"
              tabIndex={0}
              title={v.q || '保存的筛选视图'}
              onClick={() => applyView(v.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyView(v.id)
              }}
            >
              <Icon name="filter" size={14} />
              <span className="nav-label">{v.name}</span>
              <button
                type="button"
                className="row-del"
                title="删除视图"
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm(`删除视图「${v.name}」？`)) void deleteView(v.id)
                }}
              >
                <Icon name="close" size={11} strokeWidth={2.2} />
              </button>
            </div>
          ))}
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
            const n = collCounts.get(c.id) ?? 0
            return (
              <div
                key={c.id}
                data-coll={c.id}
                className={
                  'nav-item' + (collectionId === c.id ? ' on' : '') + (n === 0 && collectionId !== c.id ? ' dim' : '')
                }
                onClick={() => setCollection(collectionId === c.id ? null : c.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setCollMenu({ id: c.id, x: e.clientX, y: e.clientY })
                }}
                role="button"
                tabIndex={0}
              >
                <span className="coll-dot" style={{ background: c.color }} />
                <span className="nav-label">{c.name}</span>
                <em>{n}</em>
                <button
                  type="button"
                  className="row-more"
                  title="集合菜单：重命名 / 移动 / 合并 / 删除"
                  aria-label={`集合菜单：${c.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    const r = e.currentTarget.getBoundingClientRect()
                    setCollMenu({ id: c.id, x: r.left, y: r.bottom + 4 })
                  }}
                >
                  <Icon name="dots" size={14} />
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

          <div className={'seg tiny' + (tagIds.length > 1 ? '' : ' seg-off')}>
            <button
              type="button"
              className={'seg-btn' + (tagMode === 'or' ? ' on' : '')}
              disabled={tagIds.length < 2}
              title={tagIds.length < 2 ? '选中多个标签后生效' : '命中任意一个所选标签'}
              onClick={() => setTagMode('or')}
            >
              任一
            </button>
            <button
              type="button"
              className={'seg-btn' + (tagMode === 'and' ? ' on' : '')}
              disabled={tagIds.length < 2}
              title={tagIds.length < 2 ? '选中多个标签后生效' : '同时满足所有所选标签'}
              onClick={() => setTagMode('and')}
            >
              同时满足
            </button>
          </div>

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
                          // 单击直接切换（2026-11-15 用户定）；Ctrl/⌘+点 才往多选里加
                          if (e.ctrlKey || e.metaKey) toggleTag(t.id)
                          else switchTag(t.id)
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

      {collMenu && menuColl && (
        <div
          className="ctx-menu coll-ctx"
          ref={collMenuRef}
          style={{ left: collMenu.x, top: collMenu.y }}
          role="menu"
          aria-label="集合菜单"
        >
          <div className="ctx-head" title={menuColl.name}>
            集合：{menuColl.name}
          </div>
          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            data-coll-cmd="rename"
            onClick={() => {
              setCollMenu(null)
              void renameCollection(menuColl.id, menuColl.name)
            }}
          >
            <Icon name="edit" size={13} /> 重命名
          </button>
          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            data-coll-cmd="move"
            onClick={() => openTarget('move', menuColl)}
          >
            <Icon name="folder" size={13} /> 将内容移动到…
          </button>
          <button
            type="button"
            className="ctx-item"
            role="menuitem"
            data-coll-cmd="merge"
            onClick={() => openTarget('merge', menuColl)}
          >
            <Icon name="plus" size={13} /> 合并到另一个集合…
          </button>
          <div className="ctx-sep" />
          <button
            type="button"
            className="ctx-item danger"
            role="menuitem"
            data-coll-cmd="delete"
            onClick={() => deleteCollection(menuColl)}
          >
            <Icon name="trash" size={13} /> 删除集合…
          </button>
        </div>
      )}

      <Modal
        open={!!targetMode && !!targetSourceColl}
        onClose={() => {
          setTargetMode(null)
          setTargetSource(null)
          setTargetPick(null)
        }}
        width={460}
        label={targetMode === 'merge' ? '合并集合' : '移动集合内容'}
      >
        <div className="mini-modal-head">
          <div className="mm-title">
            {targetMode === 'merge' ? '合并到另一个集合' : '将内容移动到另一个集合'}
          </div>
          <div className="mm-sub">
            {targetMode === 'merge'
              ? '来源集合的条目会并入目标集合，来源集合本身会被删除。'
              : '来源集合会保留，只是里面的条目会改到目标集合。'}
          </div>
        </div>
        <div className="mini-modal-body">
          <div className="target-list">
            {targetOther.length === 0 && (
              <div className="muted pad">没有其他集合可选，先新建一个。</div>
            )}
            {targetOther.map((c) => (
              <button
                key={c.id}
                type="button"
                className={'target-row' + (targetPick === c.id ? ' on' : '')}
                onClick={() => setTargetPick(c.id)}
              >
                <span className="coll-dot" style={{ background: c.color }} />
                <span className="ellipsis">{c.name}</span>
                <em>{totalCollCounts.get(c.id) ?? 0} 条</em>
                <Icon name={targetPick === c.id ? 'check' : 'chevronRight'} size={13} />
              </button>
            ))}
          </div>
          {targetMode === 'merge' && (
            <div className="target-warn">
              合并不可撤销。确认后「{targetSourceColl?.name}」会被删除。
            </div>
          )}
        </div>
        <div className="mini-modal-foot">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setTargetMode(null)
              setTargetSource(null)
              setTargetPick(null)
            }}
          >
            取消
          </button>
          <button
            type="button"
            className={'btn ' + (targetMode === 'merge' ? 'danger' : 'primary')}
            disabled={!targetPickColl}
            onClick={() => void runTarget()}
          >
            {targetMode === 'merge' ? '确认合并' : '确认移动'}
          </button>
        </div>
      </Modal>
    </aside>
  )
}
