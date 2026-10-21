import React, { useEffect, useMemo, useState } from 'react'
import type { AiSuggestResult } from '../../../shared/types'
import { assetMap, thumbUrl, useStore } from '../store'
import { Icon, Modal } from './ui'

function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

export default function AiTagModal({
  open,
  onClose,
  entryIds
}: {
  open: boolean
  onClose: () => void
  entryIds: string[]
}): React.ReactElement | null {
  const data = useStore((s) => s.data)
  const refresh = useStore((s) => s.refresh)
  const toast = useStore((s) => s.toast)

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AiSuggestResult | null>(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [applying, setApplying] = useState(false)

  // entryIds 的内容用 key 表达，避免数组引用变化导致重复请求
  const key = entryIds.join(',')
  // 主进程单次最多处理 40 条，这里提前截断，避免界面显示与实际处理数不一致
  const ids = entryIds.slice(0, 40)
  const existing = useMemo(
    () => new Set(data.tags.map((t) => t.name.trim().toLowerCase())),
    [data.tags]
  )
  const assets = useMemo(() => assetMap(data), [data])
  const entryMap = useMemo(() => new Map(data.entries.map((e) => [e.id, e])), [data.entries])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setResult(null)
    setError('')
    setPicked({})

    window.pp
      .aiSuggestTags(ids)
      .then((r) => {
        if (cancelled) return
        setResult(r)
        const init: Record<string, string[]> = {}
        for (const x of r.results) init[x.entryId] = [...x.tags]
        setPicked(init)
      })
      .catch((e) => {
        if (!cancelled) setError(cleanError(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key])

  if (!open) return null

  const toggle = (entryId: string, tag: string): void => {
    setPicked((p) => {
      const cur = p[entryId] ?? []
      return {
        ...p,
        [entryId]: cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag]
      }
    })
  }

  const totalTags = Object.values(picked).reduce((n, a) => n + a.length, 0)
  const newNames = new Set(
    Object.values(picked)
      .flat()
      .filter((name) => !existing.has(name.trim().toLowerCase()))
  )

  const apply = async (): Promise<void> => {
    const assignments = Object.entries(picked)
      .map(([entryId, tags]) => ({ entryId, tags }))
      .filter((a) => a.tags.length > 0)
    if (!assignments.length) return

    setApplying(true)
    try {
      const r = await window.pp.aiApplyTags(assignments)
      await refresh()
      toast(
        `已写入 ${r.updatedEntries} 条记录` +
          (r.createdTags.length ? `，新建标签 ${r.createdTags.length} 个` : ''),
        'ok'
      )
      onClose()
    } catch (e) {
      toast('写入失败：' + cleanError(e), 'err')
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} width={720} label="AI 打标">
      <div className="mini-modal-head">
        <div className="mm-title">AI 打标</div>
        <div className="mm-sub">
          候选确认后才写入 · 模型 {result?.model ?? '…'}
        </div>
      </div>

      <div className="ai-body">
        {loading && (
          <div className="ai-loading">
            <div className="spinner" />
            <div>
              <b>正在请求模型…</b>
              <div className="muted">
                共 {ids.length} 条{entryIds.length > ids.length ? '（一次最多 40 条，其余请分批）' : ''}
                ，最多同时处理 3 条。请不要关闭窗口。
              </div>
            </div>
          </div>
        )}

        {!loading && error && <div className="ai-error">{error}</div>}

        {!loading && result && (
          <>
            <div className="ai-summary">
              共 {result.results.length} 条 · 失败 {result.failed} 条 · 候选 {totalTags} 个
              {newNames.size > 0 && ` · 新标签 ${newNames.size} 个`}
            </div>

            <div className="ai-list">
              {result.results.map((r) => {
                const entry = entryMap.get(r.entryId)
                if (!entry) return null
                const first = assets.get(entry.assetIds[0] ?? '')
                const chosen = picked[r.entryId] ?? []
                return (
                  <div className="ai-card" key={r.entryId}>
                    {first ? (
                      <img className="ai-thumb" src={thumbUrl(first)} alt="" loading="lazy" />
                    ) : (
                      <div className="ai-thumb" />
                    )}
                    <div className="ai-meta">
                      <div className="ai-title ellipsis">{entry.title || '未命名'}</div>
                      <div className="ai-prompt ellipsis">{entry.positive || '（无提示词）'}</div>
                      {r.error ? (
                        <div className="ai-err">失败：{r.error}</div>
                      ) : (
                        <div className="ai-tags">
                          {r.tags.map((tag) => {
                            const on = chosen.includes(tag)
                            const isNew = !existing.has(tag.trim().toLowerCase())
                            return (
                              <button
                                key={tag}
                                type="button"
                                className={'ai-tag' + (on ? ' on' : '') + (isNew ? ' new' : '')}
                                onClick={() => toggle(r.entryId, tag)}
                                title={isNew ? '新标签，确认后创建' : '复用现有标签'}
                              >
                                <Icon name={on ? 'check' : 'plus'} size={10} />
                                {tag}
                                {isNew && <em>新</em>}
                              </button>
                            )
                          })}
                          {r.tags.length === 0 && <span className="muted">没有候选</span>}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      <div className="ai-foot">
        <div className="muted">标签是用户资产：默认全选，但可以逐个取消。</div>
        <div className="ai-foot-actions">
          <button type="button" className="btn small" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn small primary"
            disabled={loading || applying || totalTags === 0}
            onClick={() => void apply()}
          >
            {applying ? '写入中…' : `应用 ${totalTags} 个标签`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
