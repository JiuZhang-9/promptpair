import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Asset, PromptEntry } from '../../../shared/types'
import { assetMap, selectEntries, tagMap, thumbUrl, useStore, groupMap } from '../store'
import { Empty, Icon, Stars, copyText } from './ui'

const PAD = 18
const GAP = 14
const TEXT_H = 86

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
  assets,
  tagInfo,
  selected,
  focused,
  onSelect,
  onOpenDetail,
  onEdit,
  onCopy
}: {
  entry: PromptEntry
  width: number
  assets: Map<string, Asset>
  tagInfo: Map<string, { name: string; color: string }>
  selected: boolean
  focused: boolean
  onSelect: (e: React.MouseEvent) => void
  onOpenDetail: () => void
  onEdit: () => void
  onCopy: () => void
}): React.ReactElement {
  const first = assets.get(entry.assetIds[0] ?? '')
  const video = first?.kind === 'video'
  const multi = entry.assetIds.length > 1

  return (
    <div
      className={'card' + (selected ? ' sel' : '') + (focused ? ' focused' : '')}
      style={{ width }}
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.preventDefault()
        onEdit()
      }}
      onContextMenu={(e) => {
        if (!e.shiftKey) return
        e.preventDefault()
        onCopy()
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpenDetail()
      }}
      title={entry.title}
    >
      <div className="card-thumb" style={{ height: width }}>
        {first ? (
          <img src={thumbUrl(first)} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : (
          <div className="card-noimg">
            <Icon name="image" size={22} />
          </div>
        )}

        <div className="card-badges">
          <span className="badge-left">
            {video && (
              <span className="badge play">
                <Icon name="play" size={10} strokeWidth={2.4} />
              </span>
            )}
            {multi && <span className="badge count">{entry.assetIds.length}</span>}
          </span>
          {entry.favorite && (
            <span className="badge fav">
              <Icon name="star" size={10} strokeWidth={2.4} />
            </span>
          )}
        </div>

        <div className="card-actions">
          {entry.positive && (
            <button
              type="button"
              className="mini-btn"
              title="复制提示词"
              onClick={(e) => {
                e.stopPropagation()
                onCopy()
              }}
            >
              <Icon name="copy" size={13} />
            </button>
          )}
          <button
            type="button"
            className="mini-btn"
            title="查看详情"
            onClick={(e) => {
              e.stopPropagation()
              onOpenDetail()
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

        {entry.rating > 0 && (
          <div className="card-stars">
            <Stars value={entry.rating} readOnly size={9} />
          </div>
        )}
      </div>

      <div className="card-info">
        <div className="card-title">{entry.title || '未命名'}</div>
        <div className={'card-prompt' + (entry.positive ? '' : ' dim')}>
          {entry.positive || '（暂无提示词，双击补充）'}
        </div>
        {entry.tagIds.length > 0 && (
          <div className="card-tags">
            {entry.tagIds.slice(0, 3).map((id) => {
              const t = tagInfo.get(id)
              if (!t) return null
              return (
                <span key={id} className="mini-tag">
                  {t.name}
                </span>
              )
            })}
            {entry.tagIds.length > 3 && <span className="mini-tag more">+{entry.tagIds.length - 3}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Gallery(): React.ReactElement {
  const data = useStore((s) => s.data)
  const thumbSize = useStore((s) => s.thumbSize)
  const selectedIds = useStore((s) => s.selectedIds)
  const focusIndex = useStore((s) => s.focusIndex)
  const setFocusIndex = useStore((s) => s.setFocusIndex)
  const q = useStore((s) => s.q)
  const resetFilters = useStore((s) => s.resetFilters)
  const select = useStore((s) => s.select)
  const selectMany = useStore((s) => s.selectMany)
  const clearSelection = useStore((s) => s.clearSelection)
  const openDetail = useStore((s) => s.openDetail)
  const startEdit = useStore((s) => s.startEdit)
  const startCreate = useStore((s) => s.startCreate)
  const importDialog = useStore((s) => s.importDialog)
  const doImport = useStore((s) => s.doImport)
  const toast = useStore((s) => s.toast)

  const entries = useStore(useShallow(selectEntries))
  const assets = useMemo(() => assetMap(data), [data])
  const tags = useMemo(() => tagMap(data), [data])
  const groups = useMemo(() => groupMap(data), [data])
  const tagInfo = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>()
    for (const t of data.tags) {
      const g = groups.get(t.groupId)
      m.set(t.id, { name: t.name, color: g?.color ?? '#8b95a8' })
    }
    return m
  }, [data.tags, groups])

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
  const dragDepth = useRef(0)

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

  const cols = Math.max(1, Math.floor((viewport.w - PAD * 2 + GAP) / (thumbSize + GAP)))
  const cardW = Math.max(
    90,
    Math.floor((viewport.w - PAD * 2 - GAP * (cols - 1)) / cols)
  )
  const rowH = cardW + TEXT_H + GAP
  const rows = Math.ceil(entries.length / cols)
  const totalH = rows * rowH + PAD * 2

  const startRow = Math.max(0, Math.floor((scrollTop - PAD) / rowH) - 2)
  const endRow = Math.min(rows, Math.ceil((scrollTop + viewport.h - PAD) / rowH) + 2)
  const from = startRow * cols
  const to = Math.min(entries.length, endRow * cols)
  const visible = entries.slice(from, to)

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  useEffect(() => {
    // 筛选变化时回到顶部
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setScrollTop(0)
  }, [q, entries.length])

  // 键盘焦点移动时，把目标行滚进视野
  useEffect(() => {
    if (focusIndex == null) return
    const el = scrollRef.current
    if (!el) return
    const row = Math.floor(focusIndex / cols)
    const top = PAD + row * rowH
    const bottom = top + rowH
    if (top < el.scrollTop + PAD) el.scrollTop = Math.max(0, top - PAD)
    else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = bottom - el.clientHeight + PAD
    }
  }, [focusIndex, cols, rowH])

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
      const c0 = Math.max(0, Math.floor((x0 - PAD) / (cardW + GAP)))
      const c1 = Math.min(cols - 1, Math.floor((x1 - PAD) / (cardW + GAP)))
      const r0 = Math.max(0, Math.floor((y0 - PAD) / rowH))
      const r1 = Math.min(rows - 1, Math.floor((y1 - PAD) / rowH))
      const out: string[] = []
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
    [entries, cols, cardW, rowH, rows]
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
        openDetail(null)
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
                    return (
                    <Card
                      key={entry.id}
                      entry={entry}
                      width={cardW}
                      assets={assets}
                      tagInfo={tagInfo}
                      selected={selectedIds.includes(entry.id)}
                      focused={focusIndex === index}
                      onSelect={(e) => {
                        setFocusIndex(index)
                        const additive = e.ctrlKey || e.metaKey
                        const range = e.shiftKey
                        if (range || additive) {
                          select(entry.id, { additive, range })
                        } else {
                          select(entry.id)
                          openDetail(entry.id)
                        }
                      }}
                      onOpenDetail={() => {
                        setFocusIndex(index)
                        select(entry.id)
                        openDetail(entry.id)
                      }}
                      onEdit={() => startEdit(entry.id)}
                      onCopy={() => {
                        if (!entry.positive) return
                        void copyText(entry.positive)
                          .then(() => toast('已复制提示词', 'ok'))
                          .catch(() => toast('复制失败，请手动选中文本', 'err'))
                      }}
                    />
                    )
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
    </div>
  )
}
