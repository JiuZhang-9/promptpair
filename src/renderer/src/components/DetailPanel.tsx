import React, { useEffect, useMemo, useState } from 'react'
import { assetMap, collMap, groupMap, mediaUrl, tagMap, thumbUrl, useStore } from '../store'
import { Icon, Stars, copyText, formatBytes, formatDate, formatDuration } from './ui'

export default function DetailPanel(): React.ReactElement | null {
  const detailId = useStore((s) => s.detailId)
  const data = useStore((s) => s.data)
  const openDetail = useStore((s) => s.openDetail)
  const startEdit = useStore((s) => s.startEdit)
  const patchEntries = useStore((s) => s.patchEntries)
  const filterByTag = useStore((s) => s.filterByTag)
  const activeTagIds = useStore((s) => s.tagIds)
  const removeEntries = useStore((s) => s.removeEntries)
  const toast = useStore((s) => s.toast)
  const refresh = useStore((s) => s.refresh)

  const entry = useMemo(() => data.entries.find((e) => e.id === detailId), [data.entries, detailId])
  const assets = useMemo(() => assetMap(data), [data])
  const tags = useMemo(() => tagMap(data), [data])
  const groups = useMemo(() => groupMap(data), [data])
  const colls = useMemo(() => collMap(data), [data])

  const [idx, setIdx] = useState(0)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    setIdx(0)
  }, [detailId])

  useEffect(() => {
    if (!entry) return
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      // 有弹窗（设置 / AI / 合并）时，别让 Esc 同时关掉背后的详情
      if (document.querySelector('.overlay')) return
      if (e.key === 'Escape') openDetail(null)
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === ']') {
        setIdx((i) => (i + 1) % Math.max(1, entry.assetIds.length))
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === '[') {
        setIdx((i) => (i - 1 + entry.assetIds.length) % Math.max(1, entry.assetIds.length))
      }
      if (e.key === 'e') startEdit(entry.id)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [entry, openDetail, startEdit])

  if (!entry) return null

  const cur = assets.get(entry.assetIds[idx] ?? '')
  const copy = async (text: string, key: string): Promise<void> => {
    if (!text) return
    try {
      await copyText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1400)
    } catch {
      toast('复制失败，请手动选中文本', 'err')
    }
  }

  const paramRows: [string, string][] = []
  if (entry.params?.model) paramRows.push(['模型', entry.params.model])
  if (entry.params?.width && entry.params?.height)
    paramRows.push(['尺寸', `${entry.params.width} × ${entry.params.height}`])
  if (entry.params?.seed) paramRows.push(['Seed', entry.params.seed])
  if (entry.params?.steps) paramRows.push(['步数', String(entry.params.steps)])
  if (entry.params?.cfg) paramRows.push(['CFG', String(entry.params.cfg)])
  if (entry.params?.sampler) paramRows.push(['采样器', entry.params.sampler])
  if (entry.params?.reference) paramRows.push(['参考图', entry.params.reference])
  for (const [k, v] of Object.entries(entry.params?.extra ?? {})) paramRows.push([k, String(v)])

  const allText = (): string => {
    const parts: string[] = []
    if (entry.positive) parts.push(entry.positive)
    if (entry.negative) parts.push('Negative: ' + entry.negative)
    if (entry.note) parts.push('备注：' + entry.note)
    if (paramRows.length) parts.push(paramRows.map(([k, v]) => `${k}: ${v}`).join('\n'))
    return parts.join('\n\n')
  }

  return (
    <aside className="detail">
      <div className="detail-head">
        <div className="dh-text">
          <div className="dh-title" title={entry.title}>
            {entry.title || '未命名'}
          </div>
          <div className="dh-sub" title={`${entry.source?.platform || '未标注来源'}${entry.params?.model ? ' · ' + entry.params.model : ''} · ${formatDate(entry.createdAt)}`}>
            {entry.source?.platform || '未标注来源'}
            {entry.params?.model ? ` · ${entry.params.model}` : ''} · {formatDate(entry.createdAt)}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={() => openDetail(null)} title="关闭 (Esc)">
          <Icon name="close" size={15} strokeWidth={2.2} />
        </button>
      </div>

      <div className="detail-scroll">
        <div className="stage">
          {cur ? (
            cur.kind === 'video' ? (
              <video key={cur.id} src={mediaUrl(cur)} controls autoPlay loop playsInline />
            ) : (
              <img key={cur.id} src={mediaUrl(cur)} alt={entry.title} />
            )
          ) : (
            <div className="stage-empty">
              <Icon name="image" size={26} />
              <span>这条记录还没有图片/视频</span>
            </div>
          )}

          {entry.assetIds.length > 1 && (
            <div className="stage-nav">
              <button
                type="button"
                className="nav-btn"
                onClick={() => setIdx((i) => (i - 1 + entry.assetIds.length) % entry.assetIds.length)}
              >
                <Icon name="chevronLeft" size={15} strokeWidth={2.4} />
              </button>
              <span className="nav-idx">
                {idx + 1} / {entry.assetIds.length}
              </span>
              <button
                type="button"
                className="nav-btn"
                onClick={() => setIdx((i) => (i + 1) % entry.assetIds.length)}
              >
                <Icon name="chevronRight" size={15} strokeWidth={2.4} />
              </button>
            </div>
          )}
        </div>

        {entry.assetIds.length > 1 && (
          <div className="filmstrip">
            {entry.assetIds.map((id, i) => {
              const a = assets.get(id)
              if (!a) return null
              return (
                <button
                  key={id}
                  type="button"
                  className={'fs-item' + (i === idx ? ' on' : '')}
                  onClick={() => setIdx(i)}
                >
                  <img src={thumbUrl(a)} alt="" loading="lazy" />
                  {a.kind === 'video' && (
                    <span className="fs-play">
                      <Icon name="play" size={9} strokeWidth={2.6} />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        <div className="detail-body">
          <div className="db-actions">
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
            <div className="db-spacer" />
            <button
              type="button"
              className={'icon-btn' + (entry.favorite ? ' fav on' : '')}
              title={entry.favorite ? '取消收藏' : '收藏'}
              onClick={() =>
                void patchEntries(
                  [entry.id],
                  { favorite: !entry.favorite },
                  { optimistic: true, quiet: true }
                )
              }
            >
              <Icon name="star" size={15} />
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
                if (window.confirm(`删除「${entry.title}」？\n媒体文件若不再被其他记录引用，也会一并清理。`))
                  void removeEntries([entry.id])
              }}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>

          <div className="sect">
            <div className="sect-head">
              <h4>正向提示词</h4>
              <div className="sect-actions">
                <button
                  type="button"
                  className={'copy-btn' + (copied === 'pos' ? ' done' : '')}
                  onClick={() => void copy(entry.positive, 'pos')}
                  disabled={!entry.positive}
                >
                  <Icon name={copied === 'pos' ? 'check' : 'copy'} size={12} />
                  {copied === 'pos' ? '已复制' : '复制'}
                </button>
                <button
                  type="button"
                  className={'copy-btn' + (copied === 'all' ? ' done' : '')}
                  onClick={() => void copy(allText(), 'all')}
                  title="复制正向、负向、备注和生成参数"
                >
                  <Icon name={copied === 'all' ? 'check' : 'copy'} size={12} />
                  {copied === 'all' ? '已复制' : '复制全部'}
                </button>
              </div>
            </div>
            <div
              className={'pbox' + (entry.positive ? '' : ' placeholder')}
              onDoubleClick={() => void copy(entry.positive, 'pos')}
            >
              {entry.positive || '还没有提示词。双击编辑，或点右上角编辑按钮补充。'}
            </div>
          </div>

          {entry.negative && (
            <div className="sect">
              <div className="sect-head">
                <h4>负向提示词</h4>
                <button
                  type="button"
                  className={'copy-btn' + (copied === 'neg' ? ' done' : '')}
                  onClick={() => void copy(entry.negative, 'neg')}
                >
                  <Icon name={copied === 'neg' ? 'check' : 'copy'} size={12} />
                  {copied === 'neg' ? '已复制' : '复制'}
                </button>
              </div>
              <div className="pbox">{entry.negative}</div>
            </div>
          )}

          {entry.tagIds.length > 0 && (
            <div className="sect">
              <h4>标签</h4>
              <div className="taglist">
                {entry.tagIds.map((id) => {
                  const t = tags.get(id)
                  if (!t) return null
                  return (
                    <button
                      key={id}
                      type="button"
                      className={'pill tag' + (activeTagIds.includes(id) ? ' on' : '')}
                      onClick={() => filterByTag(id)}
                      title={`只看「${t.name}」`}
                    >
                      {t.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {entry.collectionIds.length > 0 && (
            <div className="sect">
              <h4>所属集合</h4>
              <div className="taglist">
                {entry.collectionIds.map((id) => {
                  const c = colls.get(id)
                  if (!c) return null
                  return (
                    <span key={id} className="pill">
                      <span className="cdot" />
                      {c.name}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {paramRows.length > 0 && (
            <div className="sect">
              <h4>生成参数</h4>
              <div className="kv">
                {paramRows.map(([k, v]) => (
                  <React.Fragment key={k}>
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
            <div className="sect">
              <h4>备注</h4>
              <div className="note">{entry.note}</div>
            </div>
          )}

          <div className="sect">
            <h4>产物文件</h4>
            <div className="filelist">
              {entry.assetIds.map((id) => {
                const a = assets.get(id)
                if (!a) return null
                return (
                  <button
                    key={id}
                    type="button"
                    className="file-row"
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
            <div className="sect">
              <h4>来源</h4>
              <button
                type="button"
                className="link-btn full"
                onClick={() => window.pp.openExternal(entry.source.url!)}
              >
                <Icon name="external" size={12} />
                <span className="ellipsis">{entry.source.url}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
