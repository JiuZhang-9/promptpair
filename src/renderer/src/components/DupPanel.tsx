import React, { useMemo } from 'react'
import { assetMap, thumbUrl, useStore } from '../store'
import { Empty, Icon, formatBytes } from './ui'

export default function DupPanel(): React.ReactElement {
  const report = useStore((s) => s.dupReport)
  const data = useStore((s) => s.data)
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const scanDups = useStore((s) => s.scanDups)
  const config = useStore((s) => s.config)
  const applyConfig = useStore((s) => s.applyConfig)
  const refresh = useStore((s) => s.refresh)
  const toast = useStore((s) => s.toast)

  const assets = useMemo(() => assetMap(data), [data])

  const resolve = async (keep: string, rest: string[]): Promise<void> => {
    if (!rest.length) return
    if (
      !window.confirm(
        `保留 1 个文件，删除其余 ${rest.length} 个？\n\n删除后这些文件会从磁盘移除，引用它们的记录里也会去掉。此操作不可撤销。`
      )
    )
      return
    const r = await window.pp.resolveDuplicates(keep, rest)
    await refresh()
    await scanDups()
    toast(`已清理 ${r.removed} 个重复文件，影响 ${r.affectedEntries} 条记录`, 'ok')
  }

  if (panel !== 'dups') return <></>

  return (
    <aside className="detail">
      <div className="detail-head">
        <div className="dh-text">
          <div className="dh-title">重复图检测</div>
          <div className="dh-sub">
            感知哈希比对 · 阈值 {config.duplicateThreshold}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={() => setPanel('none')} title="关闭">
          <Icon name="close" size={15} strokeWidth={2.2} />
        </button>
      </div>

      <div className="detail-scroll">
        <div className="dup-top">
          <div className="dup-stat">
            <b>{report?.groups.length ?? 0}</b>
            <span>组重复</span>
          </div>
          <div className="dup-stat">
            <b>{report?.scanned ?? 0}</b>
            <span>已比对</span>
          </div>
          <div className="dup-stat">
            <b>{report ? formatBytes(report.reclaimableBytes) : '—'}</b>
            <span>可释放</span>
          </div>
        </div>

        <div className="dup-slider">
          <span>严格</span>
          <input
            type="range"
            min={0}
            max={16}
            value={config.duplicateThreshold}
            onChange={(e) => {
              void applyConfig({ duplicateThreshold: Number(e.target.value) })
            }}
            onMouseUp={() => void scanDups()}
            onTouchEnd={() => void scanDups()}
          />
          <span>宽松</span>
          <button type="button" className="link-btn" onClick={() => void scanDups()}>
            <Icon name="refresh" size={11} /> 重新检测
          </button>
        </div>

        <div className="dup-list">
          {!report && <div className="muted pad">正在检测…</div>}
          {report && report.groups.length === 0 && (
            <Empty
              icon="check"
              title="没有发现重复图"
              desc="同一文件重复导入已经被自动去重（按内容哈希）。这里检测的是「看起来一样但不是同一文件」的近似重复。"
            />
          )}

          {(report?.groups ?? []).map((g, gi) => {
            const list = g.assetIds.map((id) => assets.get(id)).filter(Boolean)
            if (!list.length) return null
            // 默认保留体积最大的
            const keep = [...list].sort((a, b) => (b!.bytes ?? 0) - (a!.bytes ?? 0))[0]!
            const rest = list.filter((a) => a!.id !== keep.id).map((a) => a!.id)

            return (
              <div className="dup-group" key={gi}>
                <div className="dup-group-head">
                  <span>
                    第 {gi + 1} 组 · {list.length} 个 · 最大差异 {g.maxDistance}
                  </span>
                  <button
                    type="button"
                    className="link-btn danger"
                    onClick={() => void resolve(keep.id, rest)}
                    title="保留体积最大的，删除其余"
                  >
                    <Icon name="trash" size={11} /> 保留最大的，清理其余
                  </button>
                </div>
                <div className="dup-items">
                  {list.map((a) => {
                    const usedBy = report?.usage?.[a!.id] ?? []
                    return (
                      <div className="dup-item" key={a!.id}>
                        <div className="dup-thumb" onClick={() => window.pp.revealAsset(a!.id)}>
                          <img src={thumbUrl(a!)} alt="" loading="lazy" />
                          {a!.id === keep.id && <span className="keep-flag">保留</span>}
                        </div>
                        <div className="dup-meta">
                          {a!.width && a!.height ? `${a!.width}×${a!.height}` : '—'} · {formatBytes(a!.bytes)}
                        </div>
                        <div className="dup-used" title={usedBy.join('\n')}>
                          {usedBy.length ? `被 ${usedBy.length} 条记录引用` : '未被引用'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
