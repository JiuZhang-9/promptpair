import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ModelKind, PromptParams } from '../../../shared/types'
import {
  assetMap,
  mediaUrl,
  tagMap,
  thumbUrl,
  useStore
} from '../store'
import { copyVariants, isMjEntry } from '../copyVariants'
import { withSyncedCodes } from '../mjParams'
import { capabilitiesOf, taskLabel } from '../../../shared/modes'
import { Icon, Stars, copyText, formatBytes, formatDate, formatDuration } from './ui'
import ModelPicker from './ModelPicker'
import ModelCaps from './ModelCaps'
import TaskPicker from './TaskPicker'
import CollectionPicker from './CollectionPicker'
import ParamEditor from './ParamEditor'

const MAX_ZOOM = 8

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

interface MenuPos {
  x: number
  y: number
}

export default function Viewer(): React.ReactElement | null {
  const viewerId = useStore((s) => s.viewerId)
  const viewerIds = useStore((s) => s.viewerIds)
  const viewerIndex = useStore((s) => s.viewerIndex)
  const data = useStore((s) => s.data)
  const closeViewer = useStore((s) => s.closeViewer)
  const openViewer = useStore((s) => s.openViewer)
  const openCompare = useStore((s) => s.openCompare)
  const startEdit = useStore((s) => s.startEdit)
  const patchEntries = useStore((s) => s.patchEntries)
  const patchEntry = useStore((s) => s.patchEntry)
  const filterByTag = useStore((s) => s.filterByTag)
  const findSimilar = useStore((s) => s.findSimilar)
  const removeEntries = useStore((s) => s.removeEntries)
  const askConfirm = useStore((s) => s.askConfirm)
  const showTip = useStore((s) => s.showTip)
  const toast = useStore((s) => s.toast)
  const refresh = useStore((s) => s.refresh)
  const activeTagIds = useStore((s) => s.tagIds)

  const entry = useMemo(
    () => (viewerId ? data.entries.find((e) => e.id === viewerId) : undefined),
    [data.entries, viewerId]
  )
  const assets = useMemo(() => assetMap(data), [data.assets])
  const tags = useMemo(() => tagMap(data), [data.tags])

  const [idx, setIdx] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [flipX, setFlipX] = useState(false)
  const [flipY, setFlipY] = useState(false)
  const [gray, setGray] = useState(false)
  const [menu, setMenu] = useState<MenuPos | null>(null)
  const [savingTransform, setSavingTransform] = useState(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  const idxRef = useRef(idx)
  const lastWheelRef = useRef(0)
  const openedAtRef = useRef(0)
  zoomRef.current = zoom
  panRef.current = pan
  idxRef.current = idx

  /* ── 打开 / 切换记录时复位 ── */
  useEffect(() => {
    setIdx(0)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setFlipX(false)
    setFlipY(false)
    setGray(false)
    setMenu(null)
    setCopied(null)
    openedAtRef.current = Date.now()
  }, [viewerId])

  useEffect(() => {
    if (!viewerId) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [viewerId])

  /* ── 缩放 / 平移 ── */
  function resetZoom(): void {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  function resetTransforms(): void {
    setFlipX(false)
    setFlipY(false)
    setGray(false)
  }

  function boundPan(x: number, y: number, z: number): { x: number; y: number } {
    const stage = stageRef.current
    if (!stage) return { x, y }
    const maxX = Math.max(0, (stage.clientWidth * (z - 1)) / 2 + 80)
    const maxY = Math.max(0, (stage.clientHeight * (z - 1)) / 2 + 80)
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) }
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
      setPan(boundPan(ox - (ox - p.x) * ratio, oy - (oy - p.y) * ratio, next))
    }
    setZoom(next)
  }

  function oneToOne(): void {
    const img = imgRef.current
    const stage = stageRef.current
    if (!img || !stage || !img.naturalWidth) {
      zoomBy(2)
      return
    }
    const fit = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight)
    setZoom(clamp(fit > 0 ? 1 / fit : 2, 0.25, MAX_ZOOM))
    setPan({ x: 0, y: 0 })
  }

  const n = Math.max(1, entry?.assetIds.length ?? 0)
  const cur = assets.get(entry?.assetIds[idx] ?? '')
  const switchTo = (next: number): void => {
    const target = ((next % n) + n) % n
    setIdx(target)
    resetZoom()
    resetTransforms()
    setCopied(null)
  }

  /** 单图条目：滚轮 / 方向键在当前筛选结果里翻记录 */
  const gotoRecord = (dir: number): void => {
    if (viewerIds.length < 2) return
    const at = viewerIndex >= 0 ? viewerIndex : 0
    const next = viewerIds[(at + dir + viewerIds.length) % viewerIds.length]
    if (next) openViewer(next)
  }

  /* ── 键盘 ── */
  useEffect(() => {
    if (!entry) return
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (document.querySelector('.overlay')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (menu) setMenu(null)
        else closeViewer()
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === ']') {
        e.preventDefault()
        if (n > 1) switchTo(idxRef.current + 1)
        else gotoRecord(1)
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === '[') {
        e.preventDefault()
        if (n > 1) switchTo(idxRef.current - 1)
        else gotoRecord(-1)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, closeViewer, startEdit, menu, n, viewerIds, viewerIndex])

  /* ── 滚轮：直接切换 / Ctrl 缩放 ── */
  useEffect(() => {
    if (!viewerId) return
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if ((e.target as HTMLElement).closest('.v-top, .v-filmstrip, .v-transchip')) return
      if (e.ctrlKey) {
        if (cur?.kind === 'video') return
        e.preventDefault()
        zoomBy(Math.exp(-e.deltaY * 0.0015), e)
        return
      }
      const now = Date.now()
      if (now - lastWheelRef.current < 170) return
      lastWheelRef.current = now
      e.preventDefault()
      if (n > 1) switchTo(idxRef.current + (e.deltaY > 0 ? 1 : -1))
      else gotoRecord(e.deltaY > 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId, cur?.kind, n, viewerIds, viewerIndex])

  if (!entry) return null

  const multi = entry.assetIds.length > 1
  const mjVariants = copyVariants(entry)
  const hasMj = isMjEntry(entry)
  const transformed = flipX || flipY || gray
  const entryTask = entry.task ?? 't2i'
  const curKind: ModelKind = cur?.kind === 'video' ? 'video' : cur?.kind === 'image' ? 'image' : 'other'
  const modelPreset = (data.models ?? []).find(
    (m) =>
      m.name.trim().toLowerCase().replace(/\s+/g, ' ') ===
      (entry.params.model ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  )
  const modelKind: ModelKind = modelPreset?.kind ?? curKind
  const modelCaps = capabilitiesOf(modelPreset, entry.params.model ?? '', modelKind)
  const taskWarning = entryTask === 'i2i' && !modelCaps.i2i

  /* ── A/B 对比入口：优先本条多图，否则找同 prompt 的另一条 ── */
  const normPrompt = (s?: string): string =>
    String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const compareImages = entry.assetIds.filter((id) => assets.get(id)?.kind === 'image')
  const sibling = data.entries.find(
    (e) =>
      e.id !== entry.id &&
      !!normPrompt(entry.positive) &&
      normPrompt(e.positive) === normPrompt(entry.positive) &&
      e.assetIds.some((id) => assets.get(id)?.kind === 'image')
  )
  const siblingImage = sibling?.assetIds.find((id) => assets.get(id)?.kind === 'image')
  const compareTitle =
    compareImages.length > 1
      ? '对比本条的多张产物'
      : sibling
        ? `同 prompt 对比：${sibling.title || '未命名'}`
        : '对比（需要两张图或另一条同 prompt 记录）'
  const openSmartCompare = (): void => {
    if (compareImages.length > 1) {
      openCompare(
        { entryId: entry.id, assetId: compareImages[0] },
        { entryId: entry.id, assetId: compareImages[1] }
      )
      return
    }
    if (compareImages[0] && sibling && siblingImage) {
      openCompare(
        { entryId: entry.id, assetId: compareImages[0] },
        { entryId: sibling.id, assetId: siblingImage }
      )
      return
    }
    toast('需要至少两张图，或另一条同 prompt 记录')
  }

  /* ── 查看器内联修改 ── */
  const patchParams = (params: PromptParams, negative?: string): void => {
    void patchEntry(entry.id, negative === undefined ? { params } : { params, negative })
  }

  const setModel = (name: string): void => {
    const next: PromptParams = { ...entry.params }
    if (name) next.model = name
    else delete next.model
    patchParams(next)
  }

  const setNegative = (v: string): void => {
    const extra = isMjEntry(entry) ? withSyncedCodes(entry.params.extra, v) : entry.params.extra
    void patchEntry(entry.id, { negative: v, params: { ...entry.params, extra } })
  }

  const allText = (): string => {
    const parts: string[] = []
    if (entry.positive) parts.push(entry.positive)
    if (entry.negative) parts.push('Negative: ' + entry.negative)
    if (entry.note) parts.push('备注：' + entry.note)
    const mj = mjVariants.find((v) => v.id === 'mjParams')
    if (mj && !mj.disabled) parts.push(mj.text)
    else {
      const kv: string[] = []
      if (entry.params.model) kv.push('模型: ' + entry.params.model)
      if (entry.params.width && entry.params.height)
        kv.push(`尺寸: ${entry.params.width} × ${entry.params.height}`)
      if (entry.params.seed) kv.push('Seed: ' + entry.params.seed)
      if (entry.params.steps) kv.push('步数: ' + entry.params.steps)
      if (entry.params.cfg) kv.push('CFG: ' + entry.params.cfg)
      if (entry.params.sampler) kv.push('采样器: ' + entry.params.sampler)
      if (kv.length) parts.push(kv.join('\n'))
    }
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

  /* ── 中键抓取平移（左键单击关闭，不再左键拖动） ── */
  const onStagePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 1 || cur?.kind === 'video' || zoom <= 1) return
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const px = pan.x
    const py = pan.y
    setDragging(true)
    const move = (ev: PointerEvent): void => {
      setPan(boundPan(px + ev.clientX - sx, py + ev.clientY - sy, zoom))
    }
    const up = (): void => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const onStageClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    // 刚打开的 280ms 内忽略点击：防止习惯性双击的第二下把查看器立刻关掉
    if (Date.now() - openedAtRef.current < 280) return
    const t = e.target as HTMLElement
    if (
      t.closest(
        'button, .v-top, .v-filmstrip, .v-nav, .v-transchip, .ctx-menu, .ctx-backdrop, .v-text-card'
      )
    )
      return
    closeViewer()
  }

  const openMenu = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const x = clamp(e.clientX, 8, window.innerWidth - 246)
    const y = clamp(e.clientY, 8, window.innerHeight - 430)
    setMenu({ x, y })
  }

  const saveTransform = async (): Promise<void> => {
    if (!cur || cur.kind !== 'image' || !transformed) return
    setSavingTransform(true)
    try {
      const next = await window.pp.transformAsset(cur.id, { flipX, flipY, gray })
      const ids = [...entry.assetIds, next.id]
      await patchEntry(entry.id, { assetIds: ids })
      await refresh()
      setIdx(ids.length - 1)
      resetZoom()
      resetTransforms()
      setMenu(null)
      toast('已保存为新产物，原图未改动', 'ok')
    } catch (e) {
      toast('保存失败：' + errText(e), 'err')
    } finally {
      setSavingTransform(false)
    }
  }

  const copyImage = async (): Promise<void> => {
    if (!cur || cur.kind !== 'image') return
    const ok = await window.pp.copyAssetImage(cur.id)
    toast(ok ? '已复制图片到剪贴板' : '复制图片失败', ok ? 'ok' : 'err')
    setMenu(null)
  }

  const shownZoom = Math.round(zoom * 100)
  const fx = flipX ? -1 : 1
  const fy = flipY ? -1 : 1
  const transformParts: string[] = []
  if (flipX) transformParts.push('水平翻转')
  if (flipY) transformParts.push('垂直翻转')
  if (gray) transformParts.push('去色')

  return (
    <div
      className="viewer"
      data-viewer
      onClick={(e) => {
        if (e.target === e.currentTarget && Date.now() - openedAtRef.current >= 280) closeViewer()
      }}
    >
      <div className="viewer-shell">
        <div
          className="v-stage"
          ref={stageRef}
          onClick={onStageClick}
          onContextMenu={(e) => {
            if (cur) openMenu(e)
            else e.preventDefault()
          }}
          onPointerDown={onStagePointerDown}
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault()
          }}
          onAuxClick={(e) => {
            if (e.button === 1) e.preventDefault()
          }}
        >
          {!cur && entry.assetIds.length === 0 ? (
            <div className="v-text-stage">
              <div className="v-text-card">
                <div className="v-text-mark">“</div>
                <div className="v-text-body">
                  {entry.positive || '这条纯提示词记录还没有正文。点「编辑」补充。'}
                </div>
                <div className="v-text-foot">
                  <span className={'v-task-chip ' + entryTask}>
                    {taskLabel(entryTask, 'image')}
                  </span>
                  {entry.params.model && <span>{entry.params.model}</span>}
                  <span>{entry.positive.length} 字符</span>
                  <span>纯提示词 · 无产物</span>
                </div>
              </div>
            </div>
          ) : cur ? (
            cur.kind === 'video' ? (
              <video
                key={cur.id}
                className="v-video"
                src={mediaUrl(cur)}
                controls
                autoPlay
                loop
                playsInline
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <img
                key={cur.id}
                ref={imgRef}
                className={'v-img' + (zoom > 1 ? ' zoomed' : '') + (dragging ? ' dragging' : '')}
                src={mediaUrl(cur)}
                alt={entry.title}
                draggable={false}
                style={{
                  transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px) scaleX(${fx}) scaleY(${fy})`,
                  filter: gray ? 'grayscale(1)' : undefined
                }}
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
              {n > 1
                ? `${idx + 1} / ${n}`
                : viewerIds.length > 1
                  ? `记录 ${Math.max(0, viewerIndex) + 1} / ${viewerIds.length}`
                  : '1 / 1'}
            </span>
            {!cur && entry.assetIds.length === 0 && (
              <span className="v-pill hint hide-sm">滚轮翻记录 · 单击背景关闭</span>
            )}
            {cur && cur.kind !== 'video' && (
              <>
                <span className="v-pill hint hide-sm">
                  滚轮切换图片 / 记录 · Ctrl+滚轮缩放 · 中键拖动 · 右键菜单 · 单击图片关闭
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
            <button
              type="button"
              className="v-pill btnlike v-close-pill"
              onClick={closeViewer}
              title="关闭 (Esc)"
              data-viewer-close="stage"
            >
              <Icon name="close" size={13} strokeWidth={2.2} /> 关闭
            </button>
          </div>

          {(multi || viewerIds.length > 1) && (
            <>
              <button
                type="button"
                className="v-nav left"
                title={multi ? '上一张（← / [）' : '上一条记录（← / [）'}
                onClick={(e) => {
                  e.stopPropagation()
                  if (multi) switchTo(idx - 1)
                  else gotoRecord(-1)
                }}
              >
                <Icon name="chevronLeft" size={18} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                className="v-nav right"
                title={multi ? '下一张（→ / ]）' : '下一条记录（→ / ]）'}
                onClick={(e) => {
                  e.stopPropagation()
                  if (multi) switchTo(idx + 1)
                  else gotoRecord(1)
                }}
              >
                <Icon name="chevronRight" size={18} strokeWidth={2.2} />
              </button>
              {multi && <div className="v-filmstrip">
                {entry.assetIds.map((id, i) => {
                  const a = assets.get(id)
                  if (!a) return null
                  return (
                    <button
                      key={id}
                      type="button"
                      className={'v-film' + (i === idx ? ' on' : '')}
                      onClick={(e) => {
                        e.stopPropagation()
                        switchTo(i)
                      }}
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
              </div>}
            </>
          )}

          {transformed && (
            <div className="v-transchip" onClick={(e) => e.stopPropagation()}>
              <span>预览：{transformParts.join(' · ')}</span>
              <button
                type="button"
                className="save"
                disabled={savingTransform}
                onClick={() => void saveTransform()}
              >
                {savingTransform ? '保存中…' : '保存为新产物'}
              </button>
              <button type="button" onClick={resetTransforms}>
                重置
              </button>
            </div>
          )}

          {menu &&
            createPortal(
              <>
              <div
                className="ctx-backdrop"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenu(null)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu(null)
                }}
              />
              <div
                className="ctx-menu"
                style={{ left: menu.x, top: menu.y }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="ctx-head v-menu-head">{`第 ${idx + 1} / ${n} 张`}</div>
                <button
                  type="button"
                  className="ctx-item"
                  disabled={cur?.kind !== 'image'}
                  onClick={() => setFlipX((v) => !v)}
                >
                  <Icon name="swap" size={14} /> 水平翻转
                  {flipX && (
                    <span className="ctx-check">
                      <Icon name="check" size={13} strokeWidth={2.4} />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="ctx-item"
                  disabled={cur?.kind !== 'image'}
                  onClick={() => setFlipY((v) => !v)}
                >
                  <Icon name="swap" size={14} className="flip-v" /> 垂直翻转
                  {flipY && (
                    <span className="ctx-check">
                      <Icon name="check" size={13} strokeWidth={2.4} />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="ctx-item"
                  disabled={cur?.kind !== 'image'}
                  onClick={() => setGray((v) => !v)}
                >
                  <Icon name="filter" size={14} /> 去色
                  {gray && (
                    <span className="ctx-check">
                      <Icon name="check" size={13} strokeWidth={2.4} />
                    </span>
                  )}
                </button>
                <div className="ctx-sep" />
                <button
                  type="button"
                  className="ctx-item"
                  disabled={!transformed}
                  onClick={() => {
                    resetTransforms()
                    setMenu(null)
                  }}
                >
                  <Icon name="refresh" size={14} /> 重置变换
                </button>
                <button
                  type="button"
                  className="ctx-item"
                  disabled={cur?.kind !== 'image'}
                  onClick={() => void copyImage()}
                >
                  <Icon name="copy" size={14} /> 复制图片
                </button>
                <button
                  type="button"
                  className="ctx-item"
                  disabled={cur?.kind !== 'image' || !transformed || savingTransform}
                  onClick={() => void saveTransform()}
                >
                  <Icon name="download" size={14} /> 保存为新产物…
                </button>
                <div className="ctx-sep" />
                <button
                  type="button"
                  className="ctx-item"
                  onClick={() => {
                    setMenu(null)
                    if (!cur) return
                    void window.pp
                      .saveAssetAs(cur.id, entry.title)
                      .then((p) => {
                        if (p) toast('已另存为：' + p, 'ok')
                      })
                      .catch((err) => toast('另存失败：' + errText(err), 'err'))
                  }}
                >
                  <Icon name="save" size={14} /> 另存为图片…
                </button>
                <button
                  type="button"
                  className="ctx-item"
                  disabled={cur?.kind !== 'image'}
                  onClick={() => {
                    setMenu(null)
                    if (!cur) return
                    void window.pp
                      .exportAssetWithPrompt(cur.id, allText(), entry.title)
                      .then((p) => {
                        if (p) toast('已导出带提示词的 PNG：' + p, 'ok')
                      })
                      .catch((err) => toast('导出失败：' + errText(err), 'err'))
                  }}
                >
                  <Icon name="tag" size={14} /> 导出带提示词的 PNG…
                </button>
                <button
                  type="button"
                  className="ctx-item"
                  disabled={cur?.kind !== 'image'}
                  onClick={() => {
                    setMenu(null)
                    if (!cur) return
                    void window.pp
                      .exportCompressedAsset(cur.id, 80, entry.title)
                      .then((r) => {
                        if (r) toast(`已压缩另存：${r.path}（${formatBytes(r.bytes)}）`, 'ok')
                      })
                      .catch((err) => toast('压缩失败：' + errText(err), 'err'))
                  }}
                >
                  <Icon name="download" size={14} /> 压缩另存为 JPG（80%）…
                </button>
                <div className="ctx-sep" />
                <button
                  type="button"
                  className="ctx-item"
                  onClick={() => {
                    setMenu(null)
                    if (cur) void window.pp.revealAsset(cur.id)
                  }}
                >
                  <Icon name="folder" size={14} /> 在资源管理器中显示
                </button>
              </div>
              </>,
              document.body
            )}
        </div>

        <aside className="v-info">
          <div className="v-head">
            <div className="v-head-text">
              <input
                className="v-title-input"
                value={entry.title || ''}
                placeholder="未命名"
                onChange={(e) => void patchEntry(entry.id, { title: e.target.value })}
                title={entry.title}
              />
              <div className="v-sub">
                {entry.source?.platform || '未标注来源'}
                {entry.params?.model ? ` · ${entry.params.model}` : ''} · {formatDate(entry.createdAt)}
              </div>
            </div>
            <button
              type="button"
              className="icon-btn v-close-x"
              title="关闭 (Esc)"
              onClick={closeViewer}
              data-viewer-close="panel"
            >
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
                className={'icon-btn fav' + (entry.favorite ? ' on' : '')}
                title={entry.favorite ? '取消收藏' : '收藏'}
                aria-pressed={entry.favorite}
                onClick={() =>
                  void patchEntries([entry.id], { favorite: !entry.favorite }, { optimistic: true, quiet: true })
                }
              >
                <Icon name="heart" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={compareTitle}
                onClick={openSmartCompare}
              >
                <Icon name="swap" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="找相似图"
                onClick={() => findSimilar(entry.id)}
              >
                <Icon name="search" size={15} />
              </button>
              <button type="button" className="icon-btn" title="编辑 (E)" onClick={() => startEdit(entry.id)}>
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

            <div className="v-sec">
              <div className="v-sec-head">
                <h4>所属集合</h4>
                <span className="v-dim" style={{ marginLeft: 'auto', fontSize: 10 }}>
                  只显示已选
                </span>
              </div>
              <CollectionPicker
                selected={entry.collectionIds}
                onChange={(ids) => void patchEntry(entry.id, { collectionIds: ids })}
                compact
              />
            </div>

            <div className="v-sec">
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

            <div className="v-sec">
              <div className="v-sec-head">
                <h4>生成参数</h4>
                <span className="v-dim" style={{ marginLeft: 'auto', fontSize: 10 }}>
                  直接改，失焦即存
                </span>
              </div>
              <div className="v-task-row">
                <span className="v-task-label">生成方式</span>
                <TaskPicker
                  value={entryTask}
                  kind={cur?.kind ?? 'image'}
                  onChange={(t) => void patchEntry(entry.id, { task: t })}
                  compact
                />
              </div>
              <div style={{ marginBottom: 5 }}>
                <ModelPicker
                  value={entry.params.model ?? ''}
                  defaultKind={(cur?.kind === 'video' ? 'video' : 'image') as ModelKind}
                  onChange={setModel}
                />
              </div>
              <ModelCaps name={entry.params.model ?? ''} kind={modelKind} compact />
              {taskWarning && (
                <div className="v-task-warn">当前模型未标注「图生图」能力</div>
              )}
              <div style={{ marginTop: 7 }}>
              <ParamEditor
                params={entry.params}
                negative={entry.negative}
                onChange={(params, negative) => patchParams(params, negative)}
                hint={false}
              />
              </div>
            </div>

            <div className="v-sec">
              <div className="v-sec-head">
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

            <div className="v-sec">
              <div className="v-sec-head">
                <h4>负向提示词</h4>
                <span className="v-dim" style={{ marginLeft: 'auto', fontSize: 10 }}>
                  可直接改
                </span>
              </div>
              <textarea
                className="v-note-edit"
                data-field="negative"
                rows={2}
                value={entry.negative}
                placeholder="要排除的内容（可选）"
                onChange={(e) => setNegative(e.target.value)}
              />
            </div>

            <div className="v-sec">
              <div className="v-sec-head">
                <h4>备注</h4>
                <span className="v-dim" style={{ marginLeft: 'auto', fontSize: 10 }}>
                  可直接改
                </span>
              </div>
              <textarea
                className="v-note-edit"
                data-field="note"
                rows={4}
                value={entry.note}
                placeholder="这条为什么值得留？改动了什么？"
                onChange={(e) => void patchEntry(entry.id, { note: e.target.value })}
              />
            </div>

            <div className="v-sec">
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
              <div className="v-sec">
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
