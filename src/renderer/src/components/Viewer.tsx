import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { PromptEntry } from '../../../shared/types'
import {
  assetMap,
  collMap,
  groupMap,
  mediaUrl,
  tagMap,
  thumbUrl,
  useStore
} from '../store'
import { copyVariants, isMjEntry } from '../copyVariants'
import { Icon, Stars, copyText, formatBytes, formatDate, formatDuration } from './ui'

const MAX_ZOOM = 8

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function paramLabel(key: string): string {
  const map: Record<string, string> = {
    mjCodeparam: 'MJ 参数',
    mjCodes: '风格码',
    sref: 'Sref',
    profile: 'Profile',
    styleRef: 'Style Ref',
    mjCodeMode: '码型',
    mjCodeCount: '码数',
    mjReuse: '复用',
    mjVibe: 'Vibe',
    styleWeight: '风格权重',
    aspect: '比例',
    version: '版本',
    chaos: 'Chaos',
    stylize: 'Stylize',
    weird: 'Weird',
    raw: 'Raw',
    hd: 'HD',
    tile: 'Tile',
    no: '负向'
  }
  return map[key] ?? key
}

function extraValue(key: string, value: string): string {
  if (key === 'mjCodeMode') return value === 'solo' ? '独码' : value === 'multi' ? '混码' : value
  return value
}

export default function Viewer(): React.ReactElement | null {
  const viewerId = useStore((s) => s.viewerId)
  const data = useStore((s) => s.data)
  const closeViewer = useStore((s) => s.closeViewer)
  const startEdit = useStore((s) => s.startEdit)
  const patchEntries = useStore((s) => s.patchEntries)
  const filterByTag = useStore((s) => s.filterByTag)
  const findSimilar = useStore((s) => s.findSimilar)
  const removeEntries = useStore((s) => s.removeEntries)
  const askConfirm = useStore((s) => s.askConfirm)
  const showTip = useStore((s) => s.showTip)
  const toast = useStore((s) => s.toast)
  const activeTagIds = useStore((s) => s.tagIds)

  const entry = useMemo(
    () => (viewerId ? data.entries.find((e) => e.id === viewerId) : undefined),
    [data.entries, viewerId]
  )
  const assets = useMemo(() => assetMap(data), [data.assets])
  const tags = useMemo(() => tagMap(data), [data.tags])
  const groups = useMemo(() => groupMap(data), [data.tagGroups])
  const colls = useMemo(() => collMap(data), [data.collections])

  const [idx, setIdx] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  zoomRef.current = zoom
  panRef.current = pan

  useEffect(() => {
    setIdx(0)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [viewerId])

  useEffect(() => {
    if (!viewerId) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [viewerId])

  useEffect(() => {
    if (!entry) return
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      // 确认框 / 编辑弹窗打开时，Esc 归它们处理
      if (document.querySelector('.overlay')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeViewer()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === ']') {
        e.preventDefault()
        setIdx((i) => (i + 1) % Math.max(1, entry.assetIds.length))
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === '[') {
        e.preventDefault()
        setIdx((i) => (i - 1 + entry.assetIds.length) % Math.max(1, entry.assetIds.length))
        return
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        zoomBy(1.25)
        return
      }
      if (e.key === '-') {
        e.preventDefault()
        zoomBy(1 / 1.25)
        return
      }
      if (e.key === '0') {
        e.preventDefault()
        resetZoom()
        return
      }
      if (e.key.toLowerCase() === 'e') startEdit(entry.id)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // zoomBy/resetZoom 只读当前 state，用函数式 set 足够
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, closeViewer, startEdit])

  useEffect(() => {
    if (!viewerId) return
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (el.querySelector('.v-video')) return
      e.preventDefault()
      zoomBy(Math.exp(-e.deltaY * 0.0015), e)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId])

  if (!entry) return null

  const cur = assets.get(entry.assetIds[idx] ?? '')
  const multi = entry.assetIds.length > 1
  const mjVariants = copyVariants(entry)
  const hasMj = isMjEntry(entry)

  const paramRows: [string, string][] = []
  if (entry.params?.model) paramRows.push(['模型', entry.params.model])
  if (entry.params?.width && entry.params?.height)
    paramRows.push(['尺寸', `${entry.params.width} × ${entry.params.height}`])
  if (entry.params?.seed) paramRows.push(['Seed', entry.params.seed])
  if (entry.params?.steps) paramRows.push(['步数', String(entry.params.steps)])
  if (entry.params?.cfg) paramRows.push(['CFG', String(entry.params.cfg)])
  if (entry.params?.sampler) paramRows.push(['采样器', entry.params.sampler])
  if (entry.params?.reference) paramRows.push(['参考图', entry.params.reference])
  for (const [k, v] of Object.entries(entry.params?.extra ?? {})) {
    if (!v) continue
    paramRows.push([paramLabel(k), extraValue(k, String(v))])
  }

  const allText = (): string => {
    const parts: string[] = []
    if (entry.positive) parts.push(entry.positive)
    if (entry.negative) parts.push('Negative: ' + entry.negative)
    if (entry.note) parts.push('备注：' + entry.note)
    if (paramRows.length) parts.push(paramRows.map(([k, v]) => `${k}: ${v}`).join('\n'))
    return parts.join('\n\n')
  }

  const copy = async (
    text: string,
    label: string,
    key: string,
    e?: React.MouseEvent
  ): Promise<void> => {
    if (!text) return
    try {
      await copyText(text)
      setCopied(key)
      showTip(label, e?.clientX, e?.clientY)
      window.setTimeout(() => setCopied((curKey) => (curKey === key ? null : curKey)), 1400)
    } catch {
      toast('复制失败，请手动选中文本', 'err')
    }
  }

  function resetZoom(): void {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  function boundPan(x: number, y: number, z: number): { x: number; y: number } {
    const stage = stageRef.current
    if (!stage) return { x, y }
    const maxX = Math.max(0, (stage.clientWidth * (z - 1)) / 2 + 80)
    const maxY = Math.max(0, (stage.clientHeight * (z - 1)) / 2 + 80)
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) }
  }

  function applyZoom(next: number, cx?: number, cy?: number): void {
    const old = zoomRef.current
    const z = clamp(next, 1, MAX_ZOOM)
    if (z === 1) {
      resetZoom()
      return
    }
    const stage = stageRef.current
    if (stage && cx != null && cy != null && old !== z) {
      const r = stage.getBoundingClientRect()
      const ox = cx - r.left - r.width / 2
      const oy = cy - r.top - r.height / 2
      const p = panRef.current
      const ratio = z / old
      const np = boundPan(ox - (ox - p.x) * ratio, oy - (oy - p.y) * ratio, z)
      setPan(np)
    }
    setZoom(z)
  }

  function zoomBy(factor: number, e?: { clientX: number; clientY: number }): void {
    const old = zoomRef.current
    const next = clamp(old * factor, 1, MAX_ZOOM)
    if (next === 1) {
      resetZoom()
      return
    }
    const stage = stageRef.current
    const x = e?.clientX
    const y = e?.clientY
    if (stage && x != null && y != null && old !== next) {
      const r = stage.getBoundingClientRect()
      const ox = x - r.left - r.width / 2
      const oy = y - r.top - r.height / 2
      const p = panRef.current
      const ratio = next / old
      const np = boundPan(ox - (ox - p.x) * ratio, oy - (oy - p.y) * ratio, next)
      setPan(np)
    }
    setZoom(next)
  }

  function oneToOne(): void {
    const img = imgRef.current
    const stage = stageRef.current
    if (!img || !stage || !img.naturalWidth) {
      applyZoom(2)
      return
    }
    const fit = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight)
    // 小图可能比窗口还小：1:1 允许缩到 100% 以下（至少 25%），否则等于没反应
    const target = fit > 0 ? 1 / fit : 2
    setZoom(clamp(target, 0.25, MAX_ZOOM))
    setPan({ x: 0, y: 0 })
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (cur?.kind === 'video' || zoom <= 1) return
    if ((e.target as HTMLElement).closest('button, .v-filmstrip')) return
    e.preventDefault()
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }
    setDragging(true)
    const move = (ev: PointerEvent): void => {
      const d = dragRef.current
      if (!d) return
      setPan(boundPan(d.px + ev.clientX - d.sx, d.py + ev.clientY - d.sy, zoom))
    }
    const up = (): void => {
      dragRef.current = null
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const onDoubleClick = (): void => {
    if (cur?.kind === 'video') return
    if (zoom > 1) resetZoom()
    else oneToOne()
  }

  const coll = entry.collectionIds.map((id) => colls.get(id)).filter(Boolean)
  const shownZoom = Math.round(zoom * 100)

  return (
    <div
      className="viewer"
      data-viewer
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeViewer()
      }}
    >
      <div className="viewer-shell">
        <div className="v-stage" ref={stageRef}>
          {cur ? (
            cur.kind === 'video' ? (
              <video
                key={cur.id}
                className="v-video"
                src={mediaUrl(cur)}
                controls
                autoPlay
                loop
                playsInline
              />
            ) : (
              <img
                key={cur.id}
                ref={imgRef}
                className={'v-img' + (zoom > 1 ? ' zoomed' : '') + (dragging ? ' dragging' : '')}
                src={mediaUrl(cur)}
                alt={entry.title}
                draggable={false}
                style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)` }}
                onPointerDown={onPointerDown}
                onDoubleClick={onDoubleClick}
              />
            )
          ) : (
            <div className="v-empty">
              <Icon name="image" size={28} />
              <span>这条记录还没有图片 / 视频</span>
            </div>
          )}

          <div className="v-top">
            <span className="v-pill">
              {idx + 1} / {Math.max(1, entry.assetIds.length)}
            </span>
            {cur?.kind !== 'video' && (
              <>
                <span className="v-pill hint hide-sm">
                  滚轮缩放 · 拖拽移动 · 双击 1:1
                </span>
                <div className="v-zoom">
                  <button type="button" title="缩小" onClick={() => zoomBy(1 / 1.25)}>
                    <Icon name="minus" size={13} />
                  </button>
                  <span className="v-pct">{shownZoom}%</span>
                  <button type="button" title="放大" onClick={() => zoomBy(1.25)}>
                    <Icon name="plus" size={13} />
                  </button>
                  <button type="button" className="txt" title="原始像素 1:1" onClick={oneToOne}>
                    1:1
                  </button>
                  <button type="button" className="txt" title="适应窗口" onClick={resetZoom}>
                    适应
                  </button>
                </div>
              </>
            )}
            <div className="v-top-spacer" />
            <button type="button" className="v-pill btnlike" onClick={closeViewer} title="关闭 (Esc)">
              <Icon name="close" size={13} strokeWidth={2.2} /> 关闭
            </button>
          </div>

          {multi && (
            <>
              <button
                type="button"
                className="v-nav left"
                title="上一张（← / [）"
                onClick={() => setIdx((i) => (i - 1 + entry.assetIds.length) % entry.assetIds.length)}
              >
                <Icon name="chevronLeft" size={18} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                className="v-nav right"
                title="下一张（→ / ]）"
                onClick={() => setIdx((i) => (i + 1) % entry.assetIds.length)}
              >
                <Icon name="chevronRight" size={18} strokeWidth={2.2} />
              </button>
              <div className="v-filmstrip">
                {entry.assetIds.map((id, i) => {
                  const a = assets.get(id)
                  if (!a) return null
                  return (
                    <button
                      key={id}
                      type="button"
                      className={'v-film' + (i === idx ? ' on' : '')}
                      onClick={() => setIdx(i)}
                      title={a.relPath.split('/').pop()}
                    >
                      <img src={thumbUrl(a)} alt="" loading="lazy" />
                      {a.kind === 'video' && (
                        <span className="v-film-play">
                          <Icon name="play" size={9} strokeWidth={2.6} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <aside className="v-info">
          <div className="v-head">
            <div className="v-head-text">
              <div className="v-title" title={entry.title}>
                {entry.title || '未命名'}
              </div>
              <div className="v-sub">
                {entry.source?.platform || '未标注来源'}
                {entry.params?.model ? ` · ${entry.params.model}` : ''} · {formatDate(entry.createdAt)}
              </div>
            </div>
            <button type="button" className="icon-btn" title="关闭 (Esc)" onClick={closeViewer}>
              <Icon name="close" size={15} strokeWidth={2.2} />
            </button>
          </div>

          <div className="v-scroll">
            <div className="v-actions">
              <Stars
                value={entry.rating}
                size={16}
                onChange={(v) =>
                  void patchEntries([entry.id], { rating: v }, { optimistic: true, quiet: true })
                }
              />
              {entry.rating > 0 && (
                <button
                  type="button"
                  className="clear-rating"
                  title="清除评分"
                  onClick={() =>
                    void patchEntries([entry.id], { rating: 0 }, { optimistic: true, quiet: true })
                  }
                >
                  清除
                </button>
              )}
              <div className="v-spacer" />
              <button
                type="button"
                className={'icon-btn' + (entry.favorite ? ' fav on' : '')}
                title={entry.favorite ? '取消收藏' : '收藏'}
                aria-pressed={entry.favorite}
                onClick={() =>
                  void patchEntries(
                    [entry.id],
                    { favorite: !entry.favorite },
                    { optimistic: true, quiet: true }
                  )
                }
              >
                <Icon name="heart" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="找相似图"
                onClick={() => findSimilar(entry.id)}
              >
                <Icon name="search" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="编辑 (E)"
                onClick={() => startEdit(entry.id)}
              >
                <Icon name="edit" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="在资源管理器中定位文件"
                onClick={() => cur && window.pp.revealAsset(cur.id)}
              >
                <Icon name="folder" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn danger"
                title="删除这条记录"
                onClick={() => {
                  const title = entry.title || '未命名'
                  askConfirm({
                    title: '删除记录',
                    message: `删除「${title}」？\n媒体文件若不再被其他记录引用，也会一并清理。`,
                    confirmLabel: '删除',
                    danger: true,
                    onConfirm: () => removeEntries([entry.id])
                  })
                }}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>

            <div className="v-sect">
              <h4>所属集合</h4>
              <div className="v-pills">
                {coll.length === 0 && <span className="v-dim">未归集合</span>}
                {coll.map((c) => (
                  <button
                    key={c!.id}
                    type="button"
                    className="v-pillbtn"
                    title={`只看「${c!.name}」`}
                    onClick={() => {
                      useStore.getState().setCollection(c!.id)
                      closeViewer()
                    }}
                  >
                    <span className="coll-dot" style={{ background: c!.color }} />
                    {c!.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="v-sect">
              <h4>标签</h4>
              <div className="v-pills">
                {entry.tagIds.length === 0 && <span className="v-dim">无标签</span>}
                {entry.tagIds.map((id) => {
                  const t = tags.get(id)
                  if (!t) return null
                  return (
                    <button
                      key={id}
                      type="button"
                      className={'v-pillbtn' + (activeTagIds.includes(id) ? ' on' : '')}
                      title={`只看「${t.name}」`}
                      onClick={() => {
                        filterByTag(id)
                        closeViewer()
                      }}
                    >
                      {t.name}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="v-sect">
              <div className="v-sect-head">
                <h4>正向提示词</h4>
                <div className="v-copy-actions">
                  <button
                    type="button"
                    className="copy-btn"
                    disabled={!entry.positive}
                    onClick={(e) => void copy(entry.positive, '已复制提示词', 'pos', e)}
                  >
                    <Icon name={copied === 'pos' ? 'check' : 'copy'} size={12} /> 复制
                  </button>
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={(e) => void copy(allText(), '已复制全部内容', 'all', e)}
                  >
                    <Icon name={copied === 'all' ? 'check' : 'copy'} size={12} /> 复制全部
                  </button>
                </div>
              </div>
              <div
                className={'v-pbox' + (entry.positive ? '' : ' placeholder')}
                onDoubleClick={(e) => void copy(entry.positive, '已复制提示词', 'pos', e)}
              >
                {entry.positive || '还没有提示词。点编辑补充。'}
              </div>
              {hasMj && (
                <div className="mj-copy-row">
                  {mjVariants
                    .filter((v) => v.id !== 'prompt')
                    .map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        className="mj-chip"
                        disabled={v.disabled}
                        title={v.disabled ? '这条记录没有对应内容' : v.text.slice(0, 120)}
                        onClick={(e) =>
                          void copy(v.text, '已复制：' + v.label.replace(/^复制/, ''), 'mj:' + v.id, e)
                        }
                      >
                        <Icon name={copied === 'mj:' + v.id ? 'check' : 'copy'} size={11} />
                        {v.label}
                      </button>
                    ))}
                </div>
              )}
            </div>

            {entry.negative && (
              <div className="v-sect">
                <div className="v-sect-head">
                  <h4>负向提示词</h4>
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={(e) => void copy(entry.negative, '已复制负向提示词', 'neg', e)}
                  >
                    <Icon name={copied === 'neg' ? 'check' : 'copy'} size={12} /> 复制
                  </button>
                </div>
                <div className="v-pbox">{entry.negative}</div>
              </div>
            )}

            {paramRows.length > 0 && (
              <div className="v-sect">
                <h4>生成参数</h4>
                <div className="v-kv">
                  {paramRows.map(([k, v]) => (
                    <React.Fragment key={k + v}>
                      <div className="k">{k}</div>
                      <div className="v" title={v}>
                        {v}
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            {entry.note && (
              <div className="v-sect">
                <h4>备注</h4>
                <div className="v-note">{entry.note}</div>
              </div>
            )}

            <div className="v-sect">
              <h4>产物文件</h4>
              <div className="v-files">
                {entry.assetIds.map((id) => {
                  const a = assets.get(id)
                  if (!a) return null
                  return (
                    <button
                      key={id}
                      type="button"
                      className="v-file"
                      onClick={() => window.pp.revealAsset(a.id)}
                      title="在资源管理器中定位"
                    >
                      <Icon name={a.kind === 'video' ? 'video' : 'image'} size={13} />
                      <span className="ellipsis">{a.relPath.split('/').pop()}</span>
                      <em>
                        {a.width && a.height ? `${a.width}×${a.height} · ` : ''}
                        {a.kind === 'video' && a.duration ? `${formatDuration(a.duration)} · ` : ''}
                        {formatBytes(a.bytes)}
                      </em>
                    </button>
                  )
                })}
              </div>
            </div>

            {entry.source?.url && (
              <div className="v-sect">
                <h4>来源</h4>
                <button
                  type="button"
                  className="v-source"
                  onClick={() => window.pp.openExternal(entry.source.url!)}
                >
                  <Icon name="external" size={12} />
                  <span className="ellipsis">{entry.source.url}</span>
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
