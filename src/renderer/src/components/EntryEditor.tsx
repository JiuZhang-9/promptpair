import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Asset, EntryDraft, ModelKind, PromptParams } from '../../../shared/types'
import { assetMap, groupMap, mediaUrl, tagMap, thumbUrl, useStore } from '../store'
import { copyVariants, isMjEntry } from '../copyVariants'
import { withSyncedCodes } from '../mjParams'
import { Field, Icon, Stars, copyText, formatBytes } from './ui'
import ModelPicker from './ModelPicker'
import CollectionPicker from './CollectionPicker'
import ParamEditor from './ParamEditor'

function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

/* ────────────────────────── 标签选择器 ────────────────────────── */

function TagPicker({
  selected,
  onChange
}: {
  selected: string[]
  onChange: (ids: string[]) => void
}): React.ReactElement {
  const data = useStore((s) => s.data)
  const refresh = useStore((s) => s.refresh)
  const toast = useStore((s) => s.toast)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)

  const tags = useMemo(() => tagMap(data), [data])
  const groups = useMemo(() => groupMap(data), [data])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = data.tags.filter((t) => (needle ? t.name.toLowerCase().includes(needle) : true))
    list.sort((a, b) => {
      const sa = selected.includes(a.id) ? 0 : 1
      const sb = selected.includes(b.id) ? 0 : 1
      if (sa !== sb) return sa - sb
      return a.name.localeCompare(b.name, 'zh-Hans-CN')
    })
    return list.slice(0, 80)
  }, [data.tags, q, selected])

  const canCreate = q.trim() && !data.tags.some((t) => t.name.toLowerCase() === q.trim().toLowerCase())

  const createAndAdd = async (): Promise<void> => {
    const name = q.trim()
    if (!name) return
    try {
      const t = await window.pp.createTag(name, '')
      onChange([...selected, t.id])
      setQ('')
      await refresh()
    } catch (e) {
      toast(cleanError(e), 'err')
    }
  }

  return (
    <div className="tagpicker">
      {selected.length > 0 && (
        <div className="tp-selected">
          {selected.map((id) => {
            const t = tags.get(id)
            if (!t) return null
            return (
              <button
                key={id}
                type="button"
                className="pill removable"
                onClick={() => onChange(selected.filter((x) => x !== id))}
                title="点击移除"
              >
                {t.name}
                <Icon name="close" size={10} strokeWidth={2.6} />
              </button>
            )
          })}
        </div>
      )}

      <div className="tp-input">
        <Icon name="tag" size={13} />
        <input
          value={q}
          placeholder={selected.length ? '继续添加标签…' : '输入标签，回车创建新标签'}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 160)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) {
              e.stopPropagation()
              setOpen(false)
              return
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              const first = filtered.find((t) => !selected.includes(t.id))
              if (canCreate) void createAndAdd()
              else if (first) {
                onChange([...selected, first.id])
                setQ('')
              }
            }
            if (e.key === 'Backspace' && !q && selected.length) {
              onChange(selected.slice(0, -1))
            }
          }}
        />
        {canCreate && (
          <button
            type="button"
            className="tp-create"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void createAndAdd()}
          >
            <Icon name="plus" size={11} strokeWidth={2.4} /> 新建「{q.trim()}」
          </button>
        )}
      </div>

      {open && (filtered.length > 0 || canCreate) && (
        <div className="tp-menu">
          {filtered.map((t) => {
            const on = selected.includes(t.id)
            return (
              <button
                key={t.id}
                type="button"
                className={'tp-item' + (on ? ' on' : '')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange(on ? selected.filter((x) => x !== t.id) : [...selected, t.id])}
              >
                <span className="gdot" style={{ background: groups.get(t.groupId)?.color }} />
                <span className="ellipsis">{t.name}</span>
                {groups.get(t.groupId) && <em>{groups.get(t.groupId)!.name}</em>}
                {on && <Icon name="check" size={12} strokeWidth={2.6} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ────────────────────────── 全屏编辑器（方案 A） ────────────────────────── */

const MAX_ZOOM = 8

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export default function EntryEditor(): React.ReactElement | null {
  const editorOpen = useStore((s) => s.editorOpen)
  const draft = useStore((s) => s.draft)
  const setDraft = useStore((s) => s.setDraft)
  const closeEditor = useStore((s) => s.closeEditor)
  const saveDraft = useStore((s) => s.saveDraft)
  const data = useStore((s) => s.data)
  const refresh = useStore((s) => s.refresh)
  const toast = useStore((s) => s.toast)
  const showTip = useStore((s) => s.showTip)
  const askConfirm = useStore((s) => s.askConfirm)

  const assets = useMemo(() => assetMap(data), [data.assets])
  const defaultModelKind = useMemo<ModelKind>(() => {
    if (!draft) return 'other'
    const kinds = draft.assetIds.map((id) => assets.get(id)?.kind)
    if (kinds.includes('video')) return 'video'
    if (kinds.includes('image')) return 'image'
    return 'other'
  }, [draft, assets])

  const media = useMemo(
    () =>
      (draft?.assetIds ?? [])
        .map((id) => assets.get(id))
        .filter((a): a is Asset => Boolean(a)),
    [draft?.assetIds, assets]
  )

  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [mediaIdx, setMediaIdx] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [negOpen, setNegOpen] = useState(false)
  const [srcOpen, setSrcOpen] = useState(false)

  const posRef = useRef<HTMLTextAreaElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  zoomRef.current = zoom
  panRef.current = pan

  const cur = media[Math.min(mediaIdx, Math.max(0, media.length - 1))]

  /* 打开 / 切换记录时复位 */
  useEffect(() => {
    if (!editorOpen) return
    setMediaIdx(0)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setDirty(false)
    setNegOpen(!!draft?.negative)
    setSrcOpen(!!(draft?.source.url || draft?.source.platform))
    if (draft && !draft.id) window.setTimeout(() => posRef.current?.focus(), 80)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOpen, draft?.id])

  useEffect(() => {
    if (mediaIdx >= media.length) setMediaIdx(Math.max(0, media.length - 1))
  }, [mediaIdx, media.length])

  useEffect(() => {
    if (!editorOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [editorOpen])

  const patch = (p: Partial<EntryDraft>): void => {
    if (!draft) return
    setDraft({ ...draft, ...p })
    setDirty(true)
  }

  const patchParam = (k: string, v: string): void => {
    if (!draft) return
    const params: Record<string, unknown> = { ...draft.params }
    if (v === '') delete params[k]
    else if (k === 'width' || k === 'height' || k === 'steps' || k === 'cfg') params[k] = Number(v) || undefined
    else params[k] = v
    patch({ params: params as PromptParams })
  }

  /** 负向词改动时同步 mjCodeparam 的 --no 段（只对 MJ 条目） */
  const setNegative = (v: string): void => {
    if (!draft) return
    const extra = isMjEntry(draft) ? withSyncedCodes(draft.params.extra, v) : draft.params.extra
    patch({ negative: v, params: { ...draft.params, extra } })
  }

  const setParamsAndNegative = (params: PromptParams, negative: string): void => {
    patch({ params, negative })
  }

  const addFiles = async (paths: string[]): Promise<void> => {
    if (!paths.length || !draft) return
    setBusy(true)
    try {
      const before = draft.assetIds.length
      const added = (await window.pp.addAssets(paths)) as Asset[]
      const ids = [...new Set([...draft.assetIds, ...added.map((a) => a.id)])]
      patch({ assetIds: ids })
      await refresh()
      if (added.length) setMediaIdx(before)
      const dup = added.filter((a) => (a as Asset & { reused?: boolean }).reused).length
      if (dup) toast(`其中 ${dup} 个文件库里已有，直接复用`, 'info')
    } catch (e) {
      toast('加入媒体失败：' + (e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const pasteFromClipboard = async (): Promise<void> => {
    if (!draft) return
    setBusy(true)
    try {
      const a = (await window.pp.addFromClipboard()) as Asset | null
      if (!a) {
        toast('剪贴板里没有图片或文件', 'err')
        return
      }
      patch({ assetIds: [...new Set([...draft.assetIds, a.id])] })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!editorOpen) return
    const onPaste = async (e: ClipboardEvent): Promise<void> => {
      const items = Array.from(e.clipboardData?.items ?? [])
      const hasImage = items.some((i) => i.type.startsWith('image/'))
      if (hasImage) {
        e.preventDefault()
        await pasteFromClipboard()
      }
    }
    document.addEventListener('paste', onPaste as unknown as EventListener)
    return () => document.removeEventListener('paste', onPaste as unknown as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOpen, draft])

  /* ── 图片缩放 / 平移 ── */

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

  function zoomBy(factor: number, cx?: number, cy?: number): void {
    const old = zoomRef.current
    const next = clamp(old * factor, 1, MAX_ZOOM)
    if (next === 1) {
      resetZoom()
      return
    }
    const stage = stageRef.current
    if (stage && cx != null && cy != null && old !== next) {
      const r = stage.getBoundingClientRect()
      const ox = cx - r.left - r.width / 2
      const oy = cy - r.top - r.height / 2
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
      setZoom(2)
      return
    }
    const fit = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight)
    setZoom(clamp(fit > 0 ? 1 / fit : 2, 0.25, MAX_ZOOM))
    setPan({ x: 0, y: 0 })
  }

  useEffect(() => {
    if (!editorOpen) return
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if ((e.target as HTMLElement).closest('.v-filmstrip, .v-top, .es-empty')) return
      if (cur?.kind === 'video') return
      e.preventDefault()
      zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOpen, cur?.kind])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || cur?.kind === 'video' || zoom <= 1) return
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

  /* ── 关闭 / 保存 ── */

  const requestClose = (): void => {
    if (!dirty) {
      closeEditor()
      return
    }
    askConfirm({
      title: '放弃未保存的修改？',
      message: '这条记录还有改动没有保存，关闭后会丢失。',
      confirmLabel: '放弃修改',
      danger: true,
      onConfirm: closeEditor
    })
  }

  const save = async (): Promise<void> => {
    const ok = await saveDraft()
    if (ok) setDirty(false)
  }

  useEffect(() => {
    if (!editorOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (document.querySelector('.overlay')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        requestClose()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        void save()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOpen, dirty, draft])

  if (!editorOpen || !draft) return null

  const isNew = !draft.id
  const variants = copyVariants(draft)
  const mj = isMjEntry(draft)
  const currentModel = draft.params.model ?? ''

  return (
    <div className="es-screen" data-editor-screen>
      <header className="es-top">
        <button type="button" className="btn ghost" onClick={requestClose}>
          <Icon name="chevronLeft" size={14} /> 画廊
        </button>
        <div className="es-top-title">
          <b>{isNew ? '新建记录' : '编辑记录'}</b>
          <span>
            {media.length} 个产物{currentModel ? ` · ${currentModel}` : ''}
            {dirty && <em className="es-dirty">未保存</em>}
          </span>
        </div>
        <div className="es-top-spacer" />
        <span className="es-key-hint">Ctrl+Enter 保存 · Esc 返回</span>
        <button type="button" className="btn" onClick={requestClose}>
          取消
        </button>
        <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
          <Icon name="check" size={14} strokeWidth={2.4} />
          {isNew ? '保存记录' : '保存修改'}
        </button>
      </header>

      <div className="es-shell">
        {/* 左：图片 */}
        <section className="es-stage">
          <div
            className={'es-stage-inner' + (dragging ? ' dragging' : '') + (dragOver ? ' over' : '')}
            ref={stageRef}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const paths = Array.from(e.dataTransfer.files ?? [])
                .map((f) => window.pp.pathForFile(f))
                .filter(Boolean)
              void addFiles(paths)
            }}
          >
            {cur ? (
              cur.kind === 'video' ? (
                <video
                  key={cur.id}
                  className="es-video"
                  src={mediaUrl(cur)}
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : (
                <img
                  key={cur.id}
                  ref={imgRef}
                  className={'es-img' + (zoom > 1 ? ' zoomed' : '') + (dragging ? ' dragging' : '')}
                  src={mediaUrl(cur)}
                  alt={cur.relPath.split('/').pop()}
                  draggable={false}
                  style={{
                    transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`
                  }}
                  onPointerDown={onPointerDown}
                  onDoubleClick={() => (zoom > 1 ? resetZoom() : oneToOne())}
                />
              )
            ) : (
              <div className="es-empty">
                <div className="es-empty-ico">
                  <Icon name="image" size={30} strokeWidth={1.4} />
                </div>
                <div className="es-empty-title">把图片 / 视频拖进来</div>
                <div className="es-empty-desc">
                  也可以点下面选择文件，或直接 Ctrl+V 粘贴剪贴板图片
                </div>
                <div className="es-empty-actions">
                  <button
                    type="button"
                    className="btn primary"
                    onClick={async () => {
                      const paths = await window.pp.pickFiles()
                      await addFiles(paths)
                    }}
                    disabled={busy}
                  >
                    <Icon name="plus" size={14} strokeWidth={2.4} /> 选择文件
                  </button>
                  <button type="button" className="btn" onClick={() => void pasteFromClipboard()}>
                    粘贴剪贴板
                  </button>
                </div>
              </div>
            )}

            <div className="v-top">
              <span className="v-pill">
                {media.length ? `${mediaIdx + 1} / ${media.length}` : '0 / 0'}
              </span>
              {cur?.kind !== 'video' && (
                <>
                  <span className="v-pill es-hint hide-sm">滚轮缩放 · 拖拽移动 · 双击 1:1</span>
                  <div className="v-zoom">
                    <button type="button" title="缩小" onClick={() => zoomBy(1 / 1.25)}>
                      <Icon name="minus" size={13} />
                    </button>
                    <span className="v-pct">{Math.round(zoom * 100)}%</span>
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
              <span className="v-pill es-count">{media.length} 个产物</span>
            </div>

            <div className="v-filmstrip es-filmstrip">
              {media.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  className={'v-film' + (i === mediaIdx ? ' on' : '')}
                  onClick={() => {
                    setMediaIdx(i)
                    resetZoom()
                  }}
                  title={`${a.relPath.split('/').pop()} · ${formatBytes(a.bytes)}`}
                >
                  <img src={thumbUrl(a)} alt="" loading="lazy" />
                  {a.kind === 'video' && (
                    <span className="v-film-play">
                      <Icon name="play" size={9} strokeWidth={2.6} />
                    </span>
                  )}
                  <span
                    className="es-film-del"
                    title="从这条记录里移除（文件仍留在库中）"
                    onClick={(e) => {
                      e.stopPropagation()
                      const ids = draft.assetIds.filter((x) => x !== a.id)
                      patch({ assetIds: ids })
                      setMediaIdx(0)
                      resetZoom()
                    }}
                  >
                    <Icon name="close" size={9} strokeWidth={3} />
                  </span>
                </button>
              ))}
              <button
                type="button"
                className="v-film es-film-add"
                title="加入图片 / 视频"
                onClick={async () => {
                  const paths = await window.pp.pickFiles()
                  await addFiles(paths)
                }}
                disabled={busy}
              >
                <Icon name="plus" size={16} strokeWidth={1.8} />
              </button>
            </div>

            {dragOver && cur && (
              <div className="es-drop">
                <Icon name="image" size={26} />
                <span>松手即挂到这条记录</span>
              </div>
            )}
          </div>
        </section>

        {/* 右：参数列 */}
        <aside className="es-side">
          <div className="es-sec es-title-sec">
            <input
              className="es-title"
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="给这条记录起个名字（留空用提示词前 24 个字）"
              aria-label="标题"
            />
            <div className="es-sub">
              {isNew ? '新建记录' : '编辑记录'} · {media.length} 个产物
            </div>
          </div>

          <div className="es-sec">
            <div className="es-basics">
              <ModelPicker
                value={currentModel}
                defaultKind={defaultModelKind}
                onChange={(name) => patchParam('model', name)}
              />
              <button
                type="button"
                className={'icon-btn fav' + (draft.favorite ? ' on' : '')}
                title={draft.favorite ? '取消收藏' : '收藏'}
                aria-pressed={draft.favorite}
                onClick={() => patch({ favorite: !draft.favorite })}
              >
                <Icon name="heart" size={15} />
              </button>
            </div>
            <div className="es-rating">
              <span className="es-rating-label">评分</span>
              <Stars value={draft.rating} size={17} onChange={(v) => patch({ rating: v })} />
              {draft.rating > 0 && (
                <button type="button" className="clear-rating" onClick={() => patch({ rating: 0 })}>
                  清除
                </button>
              )}
            </div>
          </div>

          <div className="es-sec">
            <div className="es-sec-head">
              <h4>生成参数</h4>
              <span className="es-sec-hint">MJ 参数整串粘，点解析拆字段</span>
            </div>
            <ParamEditor
              params={draft.params}
              negative={draft.negative}
              onChange={setParamsAndNegative}
              positive={draft.positive}
              onPositiveChange={(text) => patch({ positive: text })}
            />
          </div>

          <div className="es-sec">
            <div className="es-sec-head">
              <h4>正向提示词</h4>
              <span className="es-sec-hint">Ctrl+Enter 保存</span>
            </div>
            <textarea
              ref={posRef}
              className="textarea es-prompt"
              rows={6}
              value={draft.positive}
              onChange={(e) => patch({ positive: e.target.value })}
              placeholder="把生成时用的提示词粘贴到这里…"
            />
            <div className="es-ta-tools">
              <span className="es-count-text">{draft.positive.length} 字符</span>
              <button
                type="button"
                className="link-btn"
                onClick={async () => {
                  try {
                    const t = await navigator.clipboard.readText()
                    if (!t.trim()) {
                      toast('剪贴板是空的', 'err')
                      return
                    }
                    patch({ positive: draft.positive ? draft.positive + '\n' + t : t })
                  } catch {
                    toast('读取剪贴板被系统拒绝，请手动 Ctrl+V', 'err')
                  }
                }}
              >
                <Icon name="copy" size={11} /> 从剪贴板读入
              </button>
              {draft.positive && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={(e) =>
                    void copyText(draft.positive).then(() => showTip('已复制提示词', e.clientX, e.clientY))
                  }
                >
                  <Icon name="check" size={11} /> 复制
                </button>
              )}
            </div>
            {mj && (
              <div className="mj-copy-row">
                {variants
                  .filter((v) => v.id !== 'prompt')
                  .map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="mj-chip"
                      disabled={v.disabled}
                      title={v.disabled ? '没有对应内容' : v.text.slice(0, 120)}
                      onClick={(e) =>
                        void copyText(v.text)
                          .then(() =>
                            showTip('已复制：' + v.label.replace(/^复制/, ''), e.clientX, e.clientY)
                          )
                          .catch(() => toast('复制失败，请手动选中文本', 'err'))
                      }
                    >
                      <Icon name="copy" size={11} /> {v.label}
                    </button>
                  ))}
              </div>
            )}
          </div>

          <div className="es-sec">
            <div className="es-sec-head">
              <h4>标签</h4>
            </div>
            <TagPicker selected={draft.tagIds} onChange={(ids) => patch({ tagIds: ids })} />
          </div>

          <div className="es-sec">
            <div className="es-sec-head">
              <h4>所属集合</h4>
              <span className="es-sec-hint">只显示已选</span>
            </div>
            <CollectionPicker
              selected={draft.collectionIds}
              onChange={(ids) => patch({ collectionIds: ids })}
            />
          </div>

          <div className="es-sec">
            <div className="es-sec-head">
              <h4>备注</h4>
            </div>
            <textarea
              className="textarea es-note"
              rows={4}
              value={draft.note}
              onChange={(e) => patch({ note: e.target.value })}
              placeholder="这条为什么值得留？改动了什么？"
            />
          </div>

          <details
            className="es-sec es-fold"
            open={negOpen}
            onToggle={(e) => setNegOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>负向提示词</summary>
            <textarea
              className="textarea"
              rows={2}
              value={draft.negative}
              onChange={(e) => setNegative(e.target.value)}
              placeholder="要排除的内容（可选）"
            />
          </details>

          <details className="es-sec es-fold">
            <summary>通用 / SD 参数</summary>
            <div className="es-grid">
              <Field label="Seed">
                <input
                  className="input"
                  value={draft.params.seed ?? ''}
                  onChange={(e) => patchParam('seed', e.target.value)}
                  placeholder="随机种子"
                />
              </Field>
              <Field label="宽">
                <input
                  className="input"
                  value={draft.params.width ?? ''}
                  onChange={(e) => patchParam('width', e.target.value)}
                  placeholder="1024"
                />
              </Field>
              <Field label="高">
                <input
                  className="input"
                  value={draft.params.height ?? ''}
                  onChange={(e) => patchParam('height', e.target.value)}
                  placeholder="1024"
                />
              </Field>
              <Field label="步数">
                <input
                  className="input"
                  value={draft.params.steps ?? ''}
                  onChange={(e) => patchParam('steps', e.target.value)}
                  placeholder="20"
                />
              </Field>
              <Field label="CFG">
                <input
                  className="input"
                  value={draft.params.cfg ?? ''}
                  onChange={(e) => patchParam('cfg', e.target.value)}
                  placeholder="7"
                />
              </Field>
              <Field label="采样器">
                <input
                  className="input"
                  value={draft.params.sampler ?? ''}
                  onChange={(e) => patchParam('sampler', e.target.value)}
                  placeholder="Euler a"
                />
              </Field>
              <Field label="参考图">
                <input
                  className="input"
                  value={draft.params.reference ?? ''}
                  onChange={(e) => patchParam('reference', e.target.value)}
                  placeholder="垫图 / 参考图说明"
                />
              </Field>
            </div>
          </details>

          <details
            className="es-sec es-fold"
            open={srcOpen}
            onToggle={(e) => setSrcOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>来源</summary>
            <Field label="来源平台">
              <input
                className="input"
                value={draft.source.platform ?? ''}
                onChange={(e) => patch({ source: { ...draft.source, platform: e.target.value } })}
                placeholder="即梦 / 可灵 / Midjourney…"
              />
            </Field>
            <Field label="来源链接">
              <input
                className="input"
                value={draft.source.url ?? ''}
                onChange={(e) => patch({ source: { ...draft.source, url: e.target.value } })}
                placeholder="https://…"
              />
            </Field>
          </details>
        </aside>
      </div>
    </div>
  )
}
