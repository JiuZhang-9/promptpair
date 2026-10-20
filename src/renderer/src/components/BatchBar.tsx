import React, { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { groupMap, selectEntries, useStore } from '../store'
import { Icon, Modal, Stars } from './ui'

export default function BatchBar(): React.ReactElement | null {
  const selectedIds = useStore((s) => s.selectedIds)
  const data = useStore((s) => s.data)
  const clearSelection = useStore((s) => s.clearSelection)
  const selectMany = useStore((s) => s.selectMany)
  const patchEntries = useStore((s) => s.patchEntries)
  const removeEntries = useStore((s) => s.removeEntries)
  const exportPack = useStore((s) => s.exportPack)
  const refresh = useStore((s) => s.refresh)
  const toast = useStore((s) => s.toast)

  const groups = useMemo(() => groupMap(data), [data])
  const [tagModal, setTagModal] = useState<null | 'add' | 'remove'>(null)
  const [collModal, setCollModal] = useState(false)
  const [q, setQ] = useState('')
  const [newTag, setNewTag] = useState('')

  const entries = useStore(useShallow(selectEntries))

  // 注意：这个 useMemo 必须在任何条件返回之前，否则选中数从 0→1 时 hook 数量不一致
  const filteredTags = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return data.tags
      .filter((t) => (needle ? t.name.toLowerCase().includes(needle) : true))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
      .slice(0, 120)
  }, [data.tags, q])

  if (selectedIds.length < 1) return null

  const total = entries.length
  const allSelected = selectedIds.length > 0 && selectedIds.length === total

  const applyTags = async (tagIds: string[]): Promise<void> => {
    if (!tagIds.length) return
    if (tagModal === 'add') await patchEntries(selectedIds, { addTagIds: tagIds })
    else await patchEntries(selectedIds, { removeTagIds: tagIds })
    setTagModal(null)
    setQ('')
  }

  const createAndApply = async (): Promise<void> => {
    const name = newTag.trim()
    if (!name) return
    try {
      const t = await window.pp.createTag(name, '')
      setNewTag('')
      await refresh()
      await applyTags([t.id])
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  return (
    <>
      <div className="batchbar">
        <div className="bb-count">
          <b>{selectedIds.length}</b> 条已选中
        </div>
        <div className="bb-sep" />
        <button
          type="button"
          className="bb-btn"
          onClick={() => {
            if (allSelected) clearSelection()
            else selectMany(entries.map((e) => e.id))
          }}
        >
          <Icon name="check" size={13} />
          {allSelected ? '取消全选' : '全选结果'}
        </button>
        <button type="button" className="bb-btn" onClick={() => setTagModal('add')}>
          <Icon name="plus" size={13} /> 加标签
        </button>
        <button type="button" className="bb-btn" onClick={() => setTagModal('remove')}>
          <Icon name="minus" size={13} /> 移标签
        </button>
        <button type="button" className="bb-btn" onClick={() => setCollModal(true)}>
          <Icon name="folder" size={13} /> 归入集合
        </button>
        <div className="bb-stars">
          <Stars
            value={0}
            size={13}
            onChange={(v) => void patchEntries(selectedIds, { rating: v })}
          />
        </div>
        <button
          type="button"
          className="bb-btn"
          onClick={() => void patchEntries(selectedIds, { favorite: true })}
        >
          <Icon name="star" size={13} /> 收藏
        </button>
        <div className="bb-spacer" />
        <button type="button" className="bb-btn accent" onClick={() => void exportPack(selectedIds, true)}>
          <Icon name="package" size={13} /> 导出为分享包
        </button>
        <button
          type="button"
          className="bb-btn danger"
          onClick={() => {
            if (window.confirm(`删除选中的 ${selectedIds.length} 条记录？\n不再被引用的媒体文件会被一起清理。`))
              void removeEntries(selectedIds)
          }}
        >
          <Icon name="trash" size={13} /> 删除
        </button>
        <button type="button" className="icon-btn" onClick={clearSelection} title="取消选择 (Esc)">
          <Icon name="close" size={15} strokeWidth={2.2} />
        </button>
      </div>

      <Modal
        open={tagModal !== null}
        onClose={() => setTagModal(null)}
        width={440}
        label="批量标签"
      >
        <div className="mini-modal-head">
          <div className="mm-title">{tagModal === 'add' ? '批量加标签' : '批量移标签'}</div>
          <div className="mm-sub">将应用到选中的 {selectedIds.length} 条记录</div>
        </div>
        <div className="mini-modal-body">
          <div className="tp-input">
            <Icon name="tag" size={13} />
            <input
              autoFocus
              value={q}
              placeholder="搜索已有标签…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filteredTags[0]) void applyTags([filteredTags[0].id])
              }}
            />
          </div>

          {tagModal === 'add' && (
            <div className="tp-input" style={{ marginTop: 8 }}>
              <Icon name="plus" size={13} />
              <input
                value={newTag}
                placeholder="没有的话，直接新建一个标签名"
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createAndApply()
                }}
              />
              {newTag.trim() && (
                <button type="button" className="tp-create" onClick={() => void createAndApply()}>
                  新建并应用
                </button>
              )}
            </div>
          )}

          <div className="tag-pick-list">
            {filteredTags.map((t) => {
              const color = groups.get(t.groupId)?.color ?? '#8b95a8'
              const cnt = selectedIds.filter((id) => {
                const e = data.entries.find((x) => x.id === id)
                return e?.tagIds.includes(t.id)
              }).length
              return (
                <button
                  key={t.id}
                  type="button"
                  className="tag-pick-row"
                  onClick={() => void applyTags([t.id])}
                >
                  <span className="gdot" style={{ background: color }} />
                  <span className="ellipsis">{t.name}</span>
                  {cnt > 0 && (
                    <em>
                      已含 {cnt}/{selectedIds.length}
                    </em>
                  )}
                  <Icon name={tagModal === 'add' ? 'plus' : 'minus'} size={12} />
                </button>
              )
            })}
            {filteredTags.length === 0 && <div className="muted pad">没有匹配的标签</div>}
          </div>
        </div>
      </Modal>

      <Modal open={collModal} onClose={() => setCollModal(false)} width={420} label="归入集合">
        <div className="mini-modal-head">
          <div className="mm-title">归入集合</div>
          <div className="mm-sub">选中的 {selectedIds.length} 条会加入所选集合</div>
        </div>
        <div className="mini-modal-body">
          {data.collections.length === 0 && (
            <div className="muted pad">还没有集合。先在左侧「集合」里新建。</div>
          )}
          {data.collections.map((c) => (
            <button
              key={c.id}
              type="button"
              className="tag-pick-row"
              onClick={async () => {
                await patchEntries(selectedIds, { addCollectionIds: [c.id] })
                setCollModal(false)
              }}
            >
              <span className="gdot" style={{ background: c.color }} />
              <span className="ellipsis">{c.name}</span>
              <Icon name="plus" size={12} />
            </button>
          ))}
        </div>
      </Modal>
    </>
  )
}
