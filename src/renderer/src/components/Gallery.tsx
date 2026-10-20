import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Asset, PromptEntry } from '../../../shared/types'
import { assetMap, selectEntries, tagMap, thumbUrl, useStore, groupMap } from '../store'
import { Empty, Icon, Stars } from './ui'

const PAD = 18
const GAP = 14
const TEXT_H = 86

function Card({
  entry,
  width,
  assets,
  tagInfo,
  selected,
  onSelect,
  onOpenDetail,
  onEdit
}: {
  entry: PromptEntry
  width: number
  assets: Map<string, Asset>
  tagInfo: Map<string, { name: string; color: string }>
  selected: boolean
  onSelect: (e: React.MouseEvent) => void
  onOpenDetail: () => void
  onEdit: () => void
}): React.ReactElement {
  const first = assets.get(entry.assetIds[0] ?? '')
  const video = first?.kind === 'video'
  const multi = entry.assetIds.length > 1

  return (
    <div
      className={'card' + (selected ? ' sel' : '')}
      style={{ width }}
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.preventDefault()
        onEdit()
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
  const q = useStore((s) => s.q)
  const resetFilters = useStore((s) => s.resetFilters)
  const select = useStore((s) => s.select)
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
  const [viewport, setViewport] = useState({ w: 900, h: 700 })
  const [scrollTop, setScrollTop] = useState(0)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewport({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setViewport({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
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
      <div className="gallery-scroll" ref={scrollRef} onScroll={onScroll}>
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
                  {rowItems.map((entry) => (
                    <Card
                      key={entry.id}
                      entry={entry}
                      width={cardW}
                      assets={assets}
                      tagInfo={tagInfo}
                      selected={selectedIds.includes(entry.id)}
                      onSelect={(e) => {
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
                        select(entry.id)
                        openDetail(entry.id)
                      }}
                      onEdit={() => startEdit(entry.id)}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>

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
