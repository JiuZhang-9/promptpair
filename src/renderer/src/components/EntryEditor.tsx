import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Asset, EntryDraft } from '../../../shared/types'
import { assetMap, groupMap, tagMap, thumbUrl, useStore } from '../store'
import { Field, Icon, Modal, Stars, copyText, formatBytes } from './ui'

// 单色设计：集合/标签组一律用灰阶，不用彩色
const PRESET_COLORS = ['#c7c7cc', '#a1a1aa', '#8e8e93', '#71717a', '#5a5a60', '#b4b4bb', '#3f3f46']

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
    // 已选中的排前面
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
      toast((e as Error).message, 'err')
    }
  }

  return (
    <div className="tagpicker">
      {selected.length > 0 && (
        <div className="tp-selected">
          {selected.map((id) => {
            const t = tags.get(id)
            if (!t) return null
            const color = groups.get(t.groupId)?.color ?? '#8b95a8'
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
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          onKeyDown={(e) => {
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
          <button type="button" className="tp-create" onMouseDown={(e) => e.preventDefault()} onClick={() => void createAndAdd()}>
            <Icon name="plus" size={11} strokeWidth={2.4} /> 新建「{q.trim()}」
          </button>
        )}
      </div>

      {open && (filtered.length > 0 || canCreate) && (
        <div className="tp-menu">
          {filtered.map((t) => {
            const color = groups.get(t.groupId)?.color ?? '#8b95a8'
            const on = selected.includes(t.id)
            return (
              <button
                key={t.id}
                type="button"
                className={'tp-item' + (on ? ' on' : '')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange(on ? selected.filter((x) => x !== t.id) : [...selected, t.id])}
              >
                <span className="gdot" style={{ background: color }} />
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

export default function EntryEditor(): React.ReactElement | null {
  const editorOpen = useStore((s) => s.editorOpen)
  const draft = useStore((s) => s.draft)
  const setDraft = useStore((s) => s.setDraft)
  const closeEditor = useStore((s) => s.closeEditor)
  const saveDraft = useStore((s) => s.saveDraft)
  const data = useStore((s) => s.data)
  const refresh = useStore((s) => s.refresh)
  const toast = useStore((s) => s.toast)

  const assets = useMemo(() => assetMap(data), [data])
  const groups = useMemo(() => groupMap(data), [data])

  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const posRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editorOpen) {
      const d = useStore.getState().draft
      if (d && !d.id && !d.negative && !d.note) setAdvanced(false)
      // 新建时把光标放在提示词上
      setTimeout(() => posRef.current?.focus(), 60)
    }
  }, [editorOpen])

  const patch = (p: Partial<EntryDraft>): void => {
    if (!draft) return
    setDraft({ ...draft, ...p })
  }

  const patchParam = (k: string, v: string): void => {
    if (!draft) return
    const params: Record<string, unknown> = { ...draft.params }
    if (v === '') delete params[k]
    else if (k === 'width' || k === 'height' || k === 'steps' || k === 'cfg') params[k] = Number(v) || undefined
    else params[k] = v
    setDraft({ ...draft, params: params as EntryDraft['params'] })
  }

  const addFiles = async (paths: string[]): Promise<void> => {
    if (!paths.length || !draft) return
    setBusy(true)
    try {
      const added = (await window.pp.addAssets(paths)) as Asset[]
      const ids = [...new Set([...draft.assetIds, ...added.map((a) => a.id)])]
      patch({ assetIds: ids })
      await refresh()
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
  }, [editorOpen, draft])

  if (!editorOpen || !draft) return null

  const isNew = !draft.id
  const removed: string[] = []

  return (
    <Modal open={editorOpen} onClose={closeEditor} width={880} className="editor" label="编辑记录">
      <div className="ed-head">
        <div>
          <div className="ed-title">{isNew ? '新建记录' : '编辑记录'}</div>
          <div className="ed-sub">
            {isNew ? '拖入图片/视频，粘贴提示词，一次搞定配对' : draft.title}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={closeEditor} title="关闭 (Esc)">
          <Icon name="close" size={16} strokeWidth={2.2} />
        </button>
      </div>

      <div className="ed-body">
        {/* 媒体区 */}
        <div
          className={'ed-media' + (dragOver ? ' over' : '')}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault()
            setDragOver(false)
            const paths = Array.from(e.dataTransfer.files ?? [])
              .map((f) => window.pp.pathForFile(f))
              .filter(Boolean)
            await addFiles(paths)
          }}
        >
          <div className="ed-media-list">
            {draft.assetIds.map((id) => {
              const a = assets.get(id)
              if (!a) {
                removed.push(id)
                return null
              }
              return (
                <div className="ed-thumb" key={id} title={a.relPath.split('/').pop()}>
                  <img src={thumbUrl(a)} alt="" />
                  {a.kind === 'video' && (
                    <span className="ed-thumb-kind">
                      <Icon name="play" size={8} strokeWidth={2.8} />
                    </span>
                  )}
                  <button
                    type="button"
                    className="ed-thumb-del"
                    title="从这条记录里移除（文件仍留在库中）"
                    onClick={() => patch({ assetIds: draft.assetIds.filter((x) => x !== id) })}
                  >
                    <Icon name="close" size={10} strokeWidth={3} />
                  </button>
                  <span className="ed-thumb-size">{formatBytes(a.bytes)}</span>
                </div>
              )
            })}

            <button
              type="button"
              className="ed-add"
              onClick={async () => {
                const paths = await window.pp.pickFiles()
                await addFiles(paths)
              }}
              disabled={busy}
            >
              <Icon name="plus" size={18} strokeWidth={1.8} />
              <span>拖入 / 选择</span>
            </button>
          </div>

          <div className="ed-media-tips">
            <span>可以直接把文件拖到这个区域</span>
            <button type="button" className="link-btn" onClick={() => void pasteFromClipboard()}>
              粘贴剪贴板图片
            </button>
            <span className="ed-count">已挂 {draft.assetIds.length} 个产物</span>
          </div>
        </div>

        {/* 表单区 */}
        <div className="ed-form">
          <Field label="标题" hint="留空会自动用提示词前 24 个字">
            <input
              className="input"
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="给这条记录起个名字"
            />
          </Field>

          <Field label="正向提示词" hint="Ctrl+Enter 保存">
            <div className="ta-wrap">
              <textarea
                ref={posRef}
                className="textarea"
                rows={5}
                value={draft.positive}
                onChange={(e) => patch({ positive: e.target.value })}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void saveDraft()
                }}
                placeholder="把生成时用的提示词粘贴到这里…"
              />
              <div className="ta-tools">
                <span className="ta-count">{draft.positive.length} 字符</span>
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
                    onClick={() => void copyText(draft.positive)}
                  >
                    <Icon name="check" size={11} /> 复制
                  </button>
                )}
              </div>
            </div>
          </Field>

          <Field label="模型" hint="生成这张图用的模型，例如 即梦3.0 / MJ v6 / SDXL">
            <input
              className="input"
              value={draft.params.model ?? ''}
              onChange={(e) => patchParam('model', e.target.value)}
              placeholder="即梦3.0 / MJ v6 / SDXL…"
            />
          </Field>

          <div className="ed-row">
            <Field label="评分" grow>
              <Stars value={draft.rating} onChange={(v) => patch({ rating: v })} />
            </Field>
            <Field label="收藏" grow>
              <button
                type="button"
                className={'btn small' + (draft.favorite ? ' accent' : '')}
                onClick={() => patch({ favorite: !draft.favorite })}
              >
                <Icon name="star" size={12} /> {draft.favorite ? '已收藏' : '加入收藏'}
              </button>
            </Field>
          </div>

          <Field label="标签">
            <TagPicker selected={draft.tagIds} onChange={(ids) => patch({ tagIds: ids })} />
          </Field>

          <Field label="所属集合">
            <div className="coll-picker">
              {data.collections.length === 0 && <span className="muted">还没有集合，可在左侧新建</span>}
              {data.collections.map((c) => {
                const on = draft.collectionIds.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={'pill clickable' + (on ? ' on' : '')}
                    onClick={() =>
                      patch({
                        collectionIds: on
                          ? draft.collectionIds.filter((x) => x !== c.id)
                          : [...draft.collectionIds, c.id]
                      })
                    }
                  >
                    <span className="cdot" style={{ background: c.color }} />
                    {c.name}
                  </button>
                )
              })}
            </div>
          </Field>

          <button
            type="button"
            className="ed-advanced-toggle"
            onClick={() => setAdvanced((v) => !v)}
          >
            <Icon name={advanced ? 'chevronDown' : 'chevronRight'} size={12} strokeWidth={2.2} />
            负向提示词 / 生成参数 / 备注
            {!advanced && (draft.negative || draft.note) && <span className="dot-flag" />}
          </button>

          {advanced && (
            <>
              <Field label="负向提示词">
                <textarea
                  className="textarea"
                  rows={2}
                  value={draft.negative}
                  onChange={(e) => patch({ negative: e.target.value })}
                  placeholder="要排除的内容（可选）"
                />
              </Field>

              <div className="ed-grid">
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
                    placeholder="垫图/参考图说明"
                  />
                </Field>
              </div>

              <div className="ed-grid">
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
              </div>

              <Field label="备注">
                <textarea
                  className="textarea"
                  rows={2}
                  value={draft.note}
                  onChange={(e) => patch({ note: e.target.value })}
                  placeholder="这条为什么值得留？改动了什么？"
                />
              </Field>
            </>
          )}
        </div>
      </div>

      <div className="ed-foot">
        <div className="ed-foot-hint">
          {draft.assetIds.length === 0 && <span className="warn-text">建议至少挂一个产物文件</span>}
          {removed.length > 0 && <span className="muted">{removed.length} 个文件已不存在</span>}
        </div>
        <button type="button" className="btn" onClick={closeEditor}>
          取消
        </button>
        <button type="button" className="btn primary" onClick={() => void saveDraft()} disabled={busy}>
          <Icon name="check" size={14} strokeWidth={2.4} />
          {isNew ? '保存记录' : '保存修改'}
        </button>
      </div>
    </Modal>
  )
}
