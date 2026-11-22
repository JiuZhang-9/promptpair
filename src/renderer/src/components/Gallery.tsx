import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Asset, Collection, PromptEntry } from '../../../shared/types'
import {
  assetMap,
  collMap,
  selectEntries,
  thumbUrl,
  mediaUrl,
  useStore,
  groupMap
} from '../store'
import { parseQuery } from '../query'
import { copyVariants, isMjEntry, variantText, type CopyVariant } from '../copyVariants'
import { taskLabel } from '../../../shared/modes'
import { Empty, Icon, Stars, copyText, formatClock } from './ui'

const PAD = 18
const GAP = 14
const TEXT_H = 100

interface MarqueeRect {
  left: number
  top: number
  width: number
  height: number
}

interface MarqueeDrag {
  startX: number
  startY: number
  lastX: number
  lastY: number
  moved: boolean
  additive: boolean
  base: string[]
}

function Card({
  entry,
  width,
  thumbH,
  assets,
  tagInfo,
  colls,
  activeTagIds,
  selected,
  focused,
  onSelect,
  onOpenViewer,
  onEdit,
  onCopy,
  onCopyVariant,
  onRate,
  onToggleFavorite,
  onTagClick,
  onCollectionClick,
  onContextMenu
}: {
  entry: PromptEntry
  width: number
  /** 瀑布流模式下的缩略图高度（按首图纵横比）；缺省为正方形 */
  thumbH?: number
  assets: Map<string, Asset>
  tagInfo: Map<string, { name: string; color: string }>
  colls: Map<string, Collection>
  activeTagIds: string[]
  selected: boolean
  focused: boolean
  onSelect: (e: React.MouseEvent) => void
  onOpenViewer: () => void
  onEdit: () => void
  onCopy: (e: React.MouseEvent) => void
  onCopyVariant?: (id: CopyVariant['id'], e: React.MouseEvent) => void
  onRate: (v: number) => void
  onToggleFavorite: () => void
  onTagClick: (tagId: string) => void
  onCollectionClick: (collectionId: string) => void
  onContextMenu: (e: React.MouseEvent) => void
}): React.ReactElement {
  const first = assets.get(entry.assetIds[0] ?? '')
  const textOnly = !first && entry.assetIds.length === 0
  const missingAsset = !first && entry.assetIds.length > 0
  const video = first?.kind === 'video'
  const multi = entry.assetIds.length > 1
  const entryTask = entry.task ?? 't2i'
  const model = entry.params?.model?.trim()
  const coll = entry.collectionIds.length ? colls.get(entry.collectionIds[0]) : undefined
  const activeSet = useMemo(() => new Set(activeTagIds), [activeTagIds])
  // 搜索标签时只展示被搜索的标签；平时保持「模型 + 前 1–2 个标签」的紧凑密度
  const matchedTags = activeSet.size
    ? entry.tagIds.filter((id) => activeSet.has(id))
    : []
  const shownTags = activeSet.size ? matchedTags : entry.tagIds.slice(0, model ? 1 : 2)
  const hiddenTagCount = activeSet.size ? 0 : Math.max(0, entry.tagIds.length - shownTags.length)
  const variants = useMemo(() => copyVariants(entry), [entry])
  const codeMode = entry.params?.extra?.['mjCodeMode']
  const codeCount = entry.params?.extra?.['mjCodeCount']
  const reuse = entry.params?.extra?.['mjReuse']

  const [previewing, setPreviewing] = useState(false)
  const previewRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (!previewing) return
    // 以播放进度封顶 3 秒（不是墙钟：媒体加载慢时不至于还没开始播就被暂停）
    const v = previewRef.current
    if (!v) return
    const onTime = (): void => {
      if (v.currentTime >= 3) v.pause()
    }
    v.addEventListener('timeupdate', onTime)
    return () => v.removeEventListener('timeupdate', onTime)
  }, [previewing])

  return (
    <div
      className={'card' + (selected ? ' sel' : '') + (focused ? ' focused' : '') + (textOnly ? ' text-card' : '')}
      data-id={entry.id}
      style={{ width }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        if (e.key === 'Enter') onOpenViewer()
      }}
      title={entry.title}
    >
      <div
        className="card-thumb"
        style={{ height: thumbH ?? width }}
        onMouseEnter={video ? () => setPreviewing(true) : undefined}
        onMouseLeave={video ? () => setPreviewing(false) : undefined}
      >
        {textOnly ? (
          <div className="text-cover">
            <span className="text-cover-mark">“</span>
            <div className="text-cover-prompt">{entry.positive || entry.title || '纯提示词'}</div>
            <div className="text-cover-foot">
              <span>纯提示词</span>
              <span>{entry.positive.length} 字符</span>
            </div>
          </div>
        ) : first ? (
          <img src={thumbUrl(first)} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : (
          <div className="card-noimg">
            <Icon name="image" size={22} />
          </div>
        )}

        {previewing && video && first ? (
          <video
            ref={previewRef}
            className="card-preview"
            src={mediaUrl(first)}
            muted
            playsInline
            autoPlay
            onError={() => setPreviewing(false)}
          />
        ) : null}

        {video && first?.duration ? (
          <span className="card-dur">{formatClock(first.duration)}</span>
        ) : null}

        <div className="card-badges">
          <span className="badge-left">
            <span
              className={'badge task ' + entryTask}
              title={entryTask === 'i2i' ? '图生图：有参考图 / 改图等输入图' : '文生图：只输入提示词'}
            >
              {taskLabel(entryTask, first?.kind)}
            </span>
            {codeMode === 'solo' && (
              <span className="badge code solo" title="独码：单个风格码即可复现效果">
                独码
              </span>
            )}
            {codeMode === 'multi' && (
              <span
                className="badge code multi"
                title={`混码 ${codeCount ?? '多'} 个：整组一起用，别拆开`}
              >
                混码{codeCount ? '·' + codeCount : ''}
              </span>
            )}
            {reuse && (
              <span className="badge reuse" title={`这套码被复用了 ${reuse} 次`}>
                ★{reuse}
              </span>
            )}
            {video && (
              <span className="badge play">
                <Icon name="play" size={10} strokeWidth={2.4} />
              </span>
            )}
            {multi && <span className="badge count">{entry.assetIds.length}</span>}
          </span>
          <button
            type="button"
            className={'card-fav' + (entry.favorite ? ' on' : '')}
            title={entry.favorite ? '取消收藏' : '收藏'}
            aria-label={entry.favorite ? '取消收藏' : '收藏'}
            aria-pressed={entry.favorite}
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite()
            }}
          >
            <Icon name="heart" size={14} />
          </button>
        </div>

        <div className="card-actions">
          {entry.positive && (
            <div className="mini-copy">
              <button
                type="button"
                className="mini-btn"
                data-copy="prompt"
                title="复制提示词（悬停可选：提示词+参数 / 仅参数 / 风格码+参数）"
                onClick={(e) => {
                  e.stopPropagation()
                  onCopy(e)
                }}
              >
                <Icon name="copy" size={13} />
              </button>
              <div className="mini-copy-menu" role="menu">
                {variants
                  .filter((v) => !v.disabled)
                  .map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="mini-copy-item"
                      role="menuitem"
                      data-copy={v.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        onCopyVariant?.(v.id, e)
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
              </div>
            </div>
          )}
          <button
            type="button"
            className="mini-btn"
            title="放大查看"
            onClick={(e) => {
              e.stopPropagation()
              onOpenViewer()
            }}
          >
            <Icon name="eye" size={13} />
          </button>
          <button
            type="button"
            className="mini-btn"
            title="编辑"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
          >
            <Icon name="edit" size={13} />
          </button>
        </div>

        <div className={'card-stars' + (entry.rating > 0 ? ' has-rating' : '')}>
          <Stars value={entry.rating} size={13} onChange={(v) => onRate(v)} />
          {entry.rating > 0 && (
            <button
              type="button"
              className="card-clear"
              title="清除评分"
              aria-label="清除评分"
              onClick={(e) => {
                e.stopPropagation()
                onRate(0)
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="card-info">
        <div className="card-title">{entry.title || '未命名'}</div>
        {textOnly ? (
          <div className="card-prompt dim">没有产物 · 纯提示词记录</div>
        ) : missingAsset ? (
          <div className="card-prompt dim">产物文件缺失</div>
        ) : (
          <div className={'card-prompt' + (entry.positive ? '' : ' dim')}>
            {entry.positive || '（暂无提示词，单击补充）'}
          </div>
        )}
        {(model || coll || shownTags.length > 0) && (
          <div className="card-tags">
            {coll && (
              <button
                type="button"
                className="mini-tag coll"
                title={`所属集合：${coll.name}（点击筛选）`}
                onClick={(e) => {
                  e.stopPropagation()
                  onCollectionClick(coll.id)
                }}
              >
                <Icon name="folder" size={10} />
                <span className="ellipsis">{coll.name}</span>
              </button>
            )}
            {model && (
              <span className="mini-tag model" title={`模型：${model}`}>
                {model}
              </span>
            )}
            {shownTags.map((id) => {
              const t = tagInfo.get(id)
              if (!t) return null
              const active = activeTagIds.includes(id)
              return (
                <button
                  key={id}
                  type="button"
                  className={'mini-tag' + (active ? ' on' : '')}
                  title={`只看「${t.name}」`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onTagClick(id)
                  }}
                >
                  {t.name}
                </button>
              )
            })}
            {hiddenTagCount > 0 && <span className="mini-tag more">+{hiddenTagCount}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Gallery(): React.ReactElement {
  const data = useStore((s) => s.data)
  const thumbSize = useStore((s) => s.thumbSize)
  const galleryLayout = useStore((s) => s.galleryLayout)
  const selectedIds = useStore((s) => s.selectedIds)
  const focusIndex = useStore((s) => s.focusIndex)
  const setFocusIndex = useStore((s) => s.setFocusIndex)
  const tagIds = useStore((s) => s.tagIds)
  const filterByTag = useStore((s) => s.filterByTag)
  const setCollection = useStore((s) => s.setCollection)
  const patchEntries = useStore((s) => s.patchEntries)
  const q = useStore((s) => s.q)
  const resetFilters = useStore((s) => s.resetFilters)
  const select = useStore((s) => s.select)
  const selectMany = useStore((s) => s.selectMany)
  const clearSelection = useStore((s) => s.clearSelection)
  const openViewer = useStore((s) => s.openViewer)
  const openCompare = useStore((s) => s.openCompare)
  const closeViewer = useStore((s) => s.closeViewer)
  const startEdit = useStore((s) => s.startEdit)
  const startCreate = useStore((s) => s.startCreate)
  const importDialog = useStore((s) => s.importDialog)
  const doImport = useStore((s) => s.doImport)
  const removeEntries = useStore((s) => s.removeEntries)
  const exportPack = useStore((s) => s.exportPack)
  const exportHtml = useStore((s) => s.exportHtml)
  const askConfirm = useStore((s) => s.askConfirm)
  const showTip = useStore((s) => s.showTip)
  const toast = useStore((s) => s.toast)

  const entries = useStore(useShallow(selectEntries))
  const assets = useMemo(() => assetMap(data), [data.assets])
  const groups = useMemo(() => groupMap(data), [data.tagGroups])
  const colls = useMemo(() => collMap(data), [data.collections])
  const tagInfo = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>()
    for (const t of data.tags) {
      const g = groups.get(t.groupId)
      m.set(t.id, { name: t.name, color: g?.color ?? '#8b95a8' })
    }
    return m
  }, [data.tags, groups])

  // 搜索里有 tag: 时，卡片只显示被搜索的标签（左侧 tagIds 也算）
  const activeTagIds = useMemo(() => {
    const set = new Set(tagIds)
    const parsed = parseQuery(q)
    if (parsed.tags.length) {
      const needles = parsed.tags.map((x) => x.toLowerCase())
      for (const t of data.tags) {
        const name = t.name.toLowerCase()
        if (needles.some((n) => name.includes(n))) set.add(t.id)
      }
    }
    return [...set]
  }, [tagIds, q, data.tags])

  const scrollRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const marqueeRef = useRef<MarqueeDrag | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const rafRef = useRef<number | null>(null)
  const suppressClick = useRef(false)
  const [viewport, setViewport] = useState({ w: 900, h: 700 })
  const [scrollTop, setScrollTop] = useState(0)
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null)
  const [dragging, setDragging] = useState(false)
  const [cardMenu, setCardMenu] = useState<{ entryId: string; x: number; y: number } | null>(null)
  const [menuExport, setMenuExport] = useState(false)
  const cardMenuRef = useRef<HTMLDivElement>(null)
  const suppressFocusScroll = useRef(false)
  const dragDepth = useRef(0)

  // 右键菜单：视口边缘收进来；滚动/Esc/点外部关闭
  useLayoutEffect(() => {
    if (!cardMenu || !cardMenuRef.current) return
    const el = cardMenuRef.current
    const r = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(window.innerWidth - r.width - 8, cardMenu.x))
    const top = Math.max(8, Math.min(window.innerHeight - r.height - 8, cardMenu.y))
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [cardMenu, menuExport])

  useEffect(() => {
    if (!cardMenu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setCardMenu(null)
    }
    const onScroll = (): void => setCardMenu(null)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [cardMenu])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const measure = (): void => setViewport({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(() => {
      // 左右栏收起/展开会连续触发 ResizeObserver。等宽度稳定后再重排一次，
      // 避免卡片在整个 180ms 动画期间反复缩放。
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        measure()
      }, 200)
    })
    ro.observe(el)
    measure()
    return () => {
      ro.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [])

  // 卡片宽度固定为缩略图尺寸：左右栏收放只增减列数，卡片本身不缩放
  const cardW = Math.max(90, thumbSize)
  const cols = Math.max(1, Math.floor((viewport.w - PAD * 2 + GAP) / (cardW + GAP)))
  const rowH = cardW + TEXT_H + GAP
  const rows = Math.ceil(entries.length / cols)
  const totalH = rows * rowH + PAD * 2

  const masonry = galleryLayout === 'masonry'

  // 瀑布流：按首图纵横比逐个放入最矮列，记录每张卡的绝对位置
  const mLayout = useMemo(() => {
    if (!masonry) return null
    const colH = new Array(cols).fill(PAD)
    const pos: { x: number; y: number; h: number; imgH: number }[] = []
    for (const e of entries) {
      const a = assets.get(e.assetIds[0] ?? '')
      const aspect = a?.width && a?.height ? a.width / a.height : 1
      const imgH = Math.max(60, Math.round(cardW / aspect))
      const h = imgH + TEXT_H
      let c = 0
      for (let i = 1; i < colH.length; i++) if (colH[i] < colH[c]) c = i
      pos.push({ x: PAD + c * (cardW + GAP), y: colH[c], h, imgH })
      colH[c] = colH[c] + h + GAP
    }
    const total = Math.max(PAD, ...colH, PAD) + PAD
    return { pos, total }
  }, [masonry, entries, assets, cardW, cols])

  const startRow = Math.max(0, Math.floor((scrollTop - PAD) / rowH) - 2)
  const endRow = Math.min(rows, Math.ceil((scrollTop + viewport.h - PAD) / rowH) + 2)
  const from = startRow * cols
  const to = Math.min(entries.length, endRow * cols)
  const visible = entries.slice(from, to)

  // 瀑布流的可视窗口：按 y 区间过滤
  const mVisible = useMemo(() => {
    if (!mLayout) return []
    const buf = 600
    const lo = scrollTop - buf
    const hi = scrollTop + viewport.h + buf
    const out: number[] = []
    for (let i = 0; i < entries.length; i++) {
      const p = mLayout.pos[i]
      if (p.y + p.h < lo || p.y > hi) continue
      out.push(i)
    }
    return out
  }, [mLayout, scrollTop, viewport.h, entries.length])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  useEffect(() => {
    // 筛选变化时回到顶部
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setScrollTop(0)
  }, [q, entries.length])

  // 键盘焦点移动时，把目标行/卡片滚进视野（瀑布流按卡片实际位置）
  useEffect(() => {
    if (focusIndex == null) return
    // 右键菜单会顺带设置焦点；这里不要因此触发滚动，否则菜单会被 scroll 监听立刻关掉
    if (suppressFocusScroll.current) {
      suppressFocusScroll.current = false
      return
    }
    const el = scrollRef.current
    if (!el) return
    let top: number, bottom: number
    if (masonry && mLayout) {
      const p = mLayout.pos[focusIndex]
      if (!p) return
      top = p.y
      bottom = p.y + p.h
    } else {
      const row = Math.floor(focusIndex / cols)
      top = PAD + row * rowH
      bottom = top + rowH
    }
    if (top < el.scrollTop + PAD) el.scrollTop = Math.max(0, top - PAD)
    else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = bottom - el.clientHeight + PAD
    }
  }, [focusIndex, cols, rowH, masonry, mLayout])

  // 筛选结果变短后，把越界的焦点收回来
  useEffect(() => {
    if (focusIndex != null && focusIndex >= entries.length) {
      setFocusIndex(entries.length ? entries.length - 1 : null)
    }
  }, [focusIndex, entries.length, setFocusIndex])

  // Ctrl+滚轮缩放卡片
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const s = useStore.getState()
      const dir = e.deltaY > 0 ? -1 : 1
      const next = Math.max(120, Math.min(380, s.thumbSize + dir * 20))
      if (next !== s.thumbSize) s.setThumbSize(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 组件卸载时清掉框选期间挂到 window 上的监听
  useEffect(() => {
    return () => cleanupRef.current?.()
  }, [])

  const idsInRect = useCallback(
    (left: number, top: number, right: number, bottom: number): string[] => {
      const el = scrollRef.current
      if (!el) return []
      const x0 = Math.min(left, right)
      const x1 = Math.max(left, right)
      const y0 = Math.min(top, bottom) + el.scrollTop
      const y1 = Math.max(top, bottom) + el.scrollTop
      const out: string[] = []
      if (masonry && mLayout) {
        // 瀑布流：逐卡命中测试
        for (let i = 0; i < entries.length; i++) {
          const p = mLayout.pos[i]
          const l = p.x
          const r = p.x + cardW
          const t = p.y
          const b = p.y + p.h
          if (r < x0 || l > x1 || b < y0 || t > y1) continue
          out.push(entries[i].id)
        }
        return out
      }
      const c0 = Math.max(0, Math.floor((x0 - PAD) / (cardW + GAP)))
      const c1 = Math.min(cols - 1, Math.floor((x1 - PAD) / (cardW + GAP)))
      const r0 = Math.max(0, Math.floor((y0 - PAD) / rowH))
      const r1 = Math.min(rows - 1, Math.floor((y1 - PAD) / rowH))
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const cardLeft = PAD + c * (cardW + GAP)
          const cardRight = cardLeft + cardW
          const cardTop = PAD + r * rowH
          const cardBottom = cardTop + cardW + TEXT_H
          if (cardRight < x0 || cardLeft > x1 || cardBottom < y0 || cardTop > y1) continue
          const entry = entries[r * cols + c]
          if (entry) out.push(entry.id)
        }
      }
      return out
    },
    [entries, cols, cardW, rowH, rows, masonry, mLayout]
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || dragging) return
    const target = e.target as HTMLElement
    if (target.closest('.card, button, a, input, textarea, .empty')) return
    const el = scrollRef.current
    const wrap = wrapRef.current
    if (!el || !wrap) return
    const startRect = wrap.getBoundingClientRect()
    // 竖向滚动条不属于空白区域
    if (e.clientX > startRect.left + el.clientWidth) return

    const drag: MarqueeDrag = {
      startX: e.clientX - startRect.left,
      startY: e.clientY - startRect.top,
      lastX: e.clientX - startRect.left,
      lastY: e.clientY - startRect.top,
      moved: false,
      additive: e.ctrlKey || e.metaKey,
      base: useStore.getState().selectedIds.slice()
    }
    marqueeRef.current = drag

    const update = (clientX: number, clientY: number): void => {
      const d = marqueeRef.current
      const w = wrapRef.current
      if (!d || !w) return
      const r = w.getBoundingClientRect()
      d.lastX = clientX - r.left
      d.lastY = clientY - r.top
      const dx = d.lastX - d.startX
      const dy = d.lastY - d.startY
      if (!d.moved && Math.hypot(dx, dy) < 4) return
      d.moved = true
      const left = Math.min(d.startX, d.lastX)
      const top = Math.min(d.startY, d.lastY)
      const right = Math.max(d.startX, d.lastX)
      const bottom = Math.max(d.startY, d.lastY)
      setMarquee({ left, top, width: right - left, height: bottom - top })
      const ids = idsInRect(left, top, right, bottom)
      selectMany(d.additive ? [...new Set([...d.base, ...ids])] : ids)
    }

    const onMove = (ev: PointerEvent): void => update(ev.clientX, ev.clientY)

    const cancel = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      cleanupRef.current = null
    }

    const finish = (): void => {
      const d = marqueeRef.current
      marqueeRef.current = null
      cancel()
      setMarquee(null)
      if (d?.moved) {
        // 框选结束后的 click 不要落到卡片上
        suppressClick.current = true
        window.setTimeout(() => {
          suppressClick.current = false
        }, 0)
      } else if (d) {
        // 空白处单击：清空选中并收起详情
        clearSelection()
        closeViewer()
      }
    }

    const autoScroll = (): void => {
      const d = marqueeRef.current
      const s = scrollRef.current
      const w = wrapRef.current
      if (!d || !s || !w) {
        rafRef.current = null
        return
      }
      if (d.moved) {
        const r = w.getBoundingClientRect()
        const edge = 28
        let dy = 0
        if (d.lastY < edge) dy = -14
        else if (d.lastY > r.height - edge) dy = 14
        if (dy) {
          s.scrollTop = Math.max(
            0,
            Math.min(s.scrollHeight - s.clientHeight, s.scrollTop + dy)
          )
          update(d.lastX + r.left, d.lastY + r.top)
        }
      }
      rafRef.current = requestAnimationFrame(autoScroll)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    cleanupRef.current = cancel
    rafRef.current = requestAnimationFrame(autoScroll)
  }

  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    const paths = files.map((f) => window.pp.pathForFile(f)).filter(Boolean)
    if (!paths.length) {
      toast('没有识别到本地文件路径', 'err')
      return
    }
    await doImport(paths, { roots: paths })
  }

  const hasAnyEntry = data.entries.length > 0
  const menuEntry = cardMenu ? data.entries.find((e) => e.id === cardMenu.entryId) : undefined
  const menuAsset = menuEntry ? assets.get(menuEntry.assetIds[0] ?? '') : undefined
  const menuVariants = menuEntry ? copyVariants(menuEntry) : []

  /** 卡片渲染（网格与瀑布流共用）：index 用于选中/焦点，thumbH 仅瀑布流传入 */
  const renderCard = (entry: PromptEntry, index: number, thumbH?: number): React.ReactElement => (
    <Card
      key={entry.id}
      entry={entry}
      width={cardW}
      thumbH={thumbH}
      assets={assets}
      tagInfo={tagInfo}
      colls={colls}
      activeTagIds={activeTagIds}
      selected={selectedIds.includes(entry.id)}
      focused={focusIndex === index}
      onSelect={(e) => {
        setFocusIndex(index)
        const additive = e.ctrlKey || e.metaKey
        const range = e.shiftKey
        if (range || additive) {
          // 0.14.1：单击直接进详情；Ctrl / Shift 单击留给多选
          select(entry.id, { additive, range })
          return
        }
        openViewer(entry.id)
      }}
      onOpenViewer={() => {
        setFocusIndex(index)
        openViewer(entry.id)
      }}
      onEdit={() => startEdit(entry.id)}
      onCopy={(e) => {
        if (!entry.positive && !entry.note) return
        const text = copyVariants(entry)[0].text
        void copyText(text)
          .then(() => showTip('已复制提示词', e.clientX, e.clientY))
          .catch(() => toast('复制失败，请手动选中文本', 'err'))
      }}
      onCopyVariant={(vid, e) => {
        const v = copyVariants(entry).find((x) => x.id === vid)
        void copyText(variantText(entry, vid))
          .then(() => showTip('已复制' + (v ? '：' + v.label.replace(/^复制/, '') : ''), e.clientX, e.clientY))
          .catch(() => toast('复制失败，请手动选中文本', 'err'))
      }}
      onRate={(v) =>
        void patchEntries([entry.id], { rating: v }, { optimistic: true, quiet: true })
      }
      onToggleFavorite={() =>
        void patchEntries([entry.id], { favorite: !entry.favorite }, { optimistic: true, quiet: true })
      }
      onTagClick={(id) => filterByTag(id)}
      onCollectionClick={(id) => setCollection(id)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        suppressFocusScroll.current = true
        setFocusIndex(index)
        if (!selectedIds.includes(entry.id)) select(entry.id)
        setMenuExport(false)
        setCardMenu({ entryId: entry.id, x: e.clientX, y: e.clientY })
      }}
    />
  )

  return (
    <div
      className="gallery-wrap"
      ref={wrapRef}
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current++
        if (e.dataTransfer.types.includes('Files')) setDragging(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        dragDepth.current--
        if (dragDepth.current <= 0) {
          dragDepth.current = 0
          setDragging(false)
        }
      }}
      onDrop={(e) => void handleDrop(e)}
    >
      <div
        className="gallery-scroll"
        ref={scrollRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.stopPropagation()
            e.preventDefault()
            suppressClick.current = false
          }
        }}
      >
        {entries.length === 0 ? (
          !hasAnyEntry ? (
            <Empty
              icon="package"
              title="把你的第一条「提示词 + 图」放进来"
              desc="把图片/视频直接拖进这个窗口，再粘贴提示词。也可以整个文件夹拖进来批量导入。"
            >
              <button type="button" className="btn primary" onClick={() => startCreate()}>
                <Icon name="plus" size={14} /> 手动新建
              </button>
              <button type="button" className="btn" onClick={() => void importDialog('folder')}>
                <Icon name="folder" size={14} /> 导入文件夹
              </button>
              <button type="button" className="btn" onClick={() => void importDialog('files')}>
                <Icon name="upload" size={14} /> 选择文件
              </button>
            </Empty>
          ) : (
            <Empty
              icon="search"
              title="没有符合条件的记录"
              desc="换个关键词，或清除筛选条件试试。"
            >
              <button type="button" className="btn" onClick={resetFilters}>
                <Icon name="refresh" size={14} /> 清除筛选
              </button>
            </Empty>
          )
        ) : masonry && mLayout ? (
          <div className="vgrid" style={{ height: mLayout.total }}>
            {mVisible.map((index) => {
              const entry = entries[index]
              const p = mLayout.pos[index]
              return (
                <div key={entry.id} style={{ position: 'absolute', top: p.y, left: p.x }}>
                  {renderCard(entry, index, p.imgH)}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="vgrid" style={{ height: totalH }}>
            {Array.from({ length: endRow - startRow }, (_, ri) => {
              const row = startRow + ri
              const rowItems = visible.slice(ri * cols, ri * cols + cols)
              if (!rowItems.length) return null
              return (
                <div
                  key={row}
                  className="vrow"
                  style={{ top: PAD + row * rowH, left: PAD, gap: GAP }}
                >
                  {rowItems.map((entry, ci) => {
                    const index = from + ri * cols + ci
                    return renderCard(entry, index)
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {marquee && <div className="marquee" style={marquee} />}

      {dragging && (
        <div className="dropzone">
          <div className="dropzone-inner">
            <Icon name="download" size={34} strokeWidth={1.5} />
            <div className="dz-title">松开即可导入</div>
            <div className="dz-desc">
              会自动按文件夹名打标签、读取同名 .txt 提示词、把连号文件合并成一条记录
            </div>
          </div>
        </div>
      )}

      {cardMenu && menuEntry && (
        <div className="ctx-backdrop" onMouseDown={() => setCardMenu(null)}>
          <div
            className="ctx-menu"
            ref={cardMenuRef}
            style={{ left: cardMenu.x, top: cardMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            role="menu"
            aria-label="卡片菜单"
          >
            <div className="ctx-head" title={menuEntry.title}>
              {menuEntry.title || '未命名'}
            </div>
            {menuVariants
              .filter((v) => v.id === 'prompt' || !v.disabled || isMjEntry(menuEntry))
              .map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="ctx-item"
                  role="menuitem"
                  data-ctx-copy={v.id}
                  disabled={v.disabled}
                  title={v.disabled ? '这条记录没有对应内容' : v.text.slice(0, 120)}
                  onClick={() => {
                    void copyText(v.text)
                      .then(() => showTip('已复制：' + v.label.replace(/^复制/, ''), cardMenu.x, cardMenu.y))
                      .catch(() => toast('复制失败，请手动选中文本', 'err'))
                    setCardMenu(null)
                  }}
                >
                  <Icon name="copy" size={13} />
                  {v.label}
                </button>
              ))}
            <div className="ctx-sep" />
            <button
              type="button"
              className="ctx-item"
              role="menuitem"
              onClick={() => {
                openViewer(menuEntry.id)
                setCardMenu(null)
              }}
            >
              <Icon name="eye" size={13} /> 放大查看
            </button>
            {menuEntry.assetIds.filter((id) => assets.get(id)?.kind === 'image').length > 1 && (
              <button
                type="button"
                className="ctx-item"
                role="menuitem"
                data-ctx-compare
                onClick={() => {
                  const imgs = menuEntry.assetIds.filter((id) => assets.get(id)?.kind === 'image')
                  openCompare(
                    { entryId: menuEntry.id, assetId: imgs[0] },
                    { entryId: menuEntry.id, assetId: imgs[1] }
                  )
                  setCardMenu(null)
                }}
              >
                <Icon name="swap" size={13} /> 对比第 1 / 第 2 张
              </button>
            )}
            <button
              type="button"
              className="ctx-item"
              role="menuitem"
              onClick={() => {
                startEdit(menuEntry.id)
                setCardMenu(null)
              }}
            >
              <Icon name="edit" size={13} /> 编辑
            </button>
            <button
              type="button"
              className="ctx-item"
              role="menuitem"
              onClick={() => setMenuExport((v) => !v)}
            >
              <Icon name="download" size={13} /> 导出 / 另存为
              <span className="ctx-sub">{menuExport ? '▾' : '▸'}</span>
            </button>
            {menuExport && (
              <div className="ctx-subgroup">
                <button
                  type="button"
                  className="ctx-item"
                  disabled={!menuAsset}
                  onClick={() => {
                    if (!menuAsset) return
                    void window.pp
                      .saveAssetAs(menuAsset.id, menuEntry.title)
                      .then((p) => {
                        if (p) toast('已另存为：' + p, 'ok')
                      })
                      .catch((err) => toast('另存失败：' + (err as Error).message, 'err'))
                    setCardMenu(null)
                  }}
                >
                  <Icon name="image" size={13} /> {menuAsset?.kind === 'video' ? '另存原视频…' : '另存原图…'}
                </button>
                <button
                  type="button"
                  className="ctx-item"
                  onClick={() => {
                    void exportPack([menuEntry.id], true, menuEntry.title)
                    setCardMenu(null)
                  }}
                >
                  <Icon name="package" size={13} /> 导出分享包（此条）
                </button>
                <button
                  type="button"
                  className="ctx-item"
                  onClick={() => {
                    void exportHtml([menuEntry.id], 'thumb', menuEntry.title)
                    setCardMenu(null)
                  }}
                >
                  <Icon name="external" size={13} /> 导出单页 HTML（此条）
                </button>
              </div>
            )}
            <div className="ctx-sep" />
            <button
              type="button"
              className="ctx-item danger"
              role="menuitem"
              onClick={() => {
                const title = menuEntry.title || '未命名'
                setCardMenu(null)
                askConfirm({
                  title: '删除记录',
                  message: `确定删除「${title}」？\n不再被引用的媒体文件会一并清理。`,
                  confirmLabel: '删除',
                  danger: true,
                  onConfirm: () => removeEntries([menuEntry.id])
                })
              }}
            >
              <Icon name="trash" size={13} /> 删除
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
