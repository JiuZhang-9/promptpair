import React, { useEffect } from 'react'
import { useStore } from './store'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import Gallery from './components/Gallery'
import DetailPanel from './components/DetailPanel'
import EntryEditor from './components/EntryEditor'
import BatchBar from './components/BatchBar'
import DupPanel from './components/DupPanel'
import SettingsPanel from './components/SettingsPanel'
import { Icon } from './components/ui'

function Toasts(): React.ReactElement {
  const toasts = useStore((s) => s.toasts)
  const drop = useStore((s) => s.dropToast)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind} onClick={() => drop(t.id)}>
          <Icon
            name={t.kind === 'ok' ? 'check' : t.kind === 'err' ? 'alert' : 'info'}
            size={14}
            strokeWidth={2.2}
          />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

function ImportOverlay(): React.ReactElement | null {
  const imp = useStore((s) => s.importing)
  if (!imp.active) return null
  const pct = imp.total > 0 ? Math.round((imp.done / imp.total) * 100) : 0
  return (
    <div className="import-overlay">
      <div className="import-card">
        <div className="import-head">
          <div className="spinner" />
          <div>
            <div className="import-title">正在导入…</div>
            <div className="import-sub ellipsis">{imp.current || '准备中'}</div>
          </div>
          <div className="import-pct">{pct}%</div>
        </div>
        <div className="import-track">
          <div className="import-bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="import-note">
          文件按内容哈希入库，重复文件会自动跳过。请勿关闭窗口。
        </div>
      </div>
    </div>
  )
}

export default function App(): React.ReactElement {
  const ready = useStore((s) => s.ready)
  const fatal = useStore((s) => s.fatal)
  const init = useStore((s) => s.init)
  const selectedIds = useStore((s) => s.selectedIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const removeEntries = useStore((s) => s.removeEntries)
  const startCreate = useStore((s) => s.startCreate)
  const detailId = useStore((s) => s.detailId)
  const openDetail = useStore((s) => s.openDetail)
  const editorOpen = useStore((s) => s.editorOpen)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (typing) return

      if (e.key === 'Escape') {
        if (editorOpen) return
        if (detailId) openDetail(null)
        else if (selectedIds.length) clearSelection()
        return
      }
      if (e.key === 'Delete' && selectedIds.length) {
        e.preventDefault()
        if (window.confirm(`删除选中的 ${selectedIds.length} 条记录？`)) void removeEntries(selectedIds)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        startCreate()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedIds, detailId, editorOpen, clearSelection, removeEntries, startCreate, openDetail])

  if (!ready) {
    return (
      <div className="boot">
        <div className="boot-mark">
          <span />
          <span />
        </div>
        <div className="boot-text">正在打开素材库…</div>
      </div>
    )
  }

  if (fatal) {
    return (
      <div className="boot">
        <div className="fatal">
          <Icon name="alert" size={28} />
          <h2>素材库打开失败</h2>
          <pre>{fatal}</pre>
          <p>可以把库文件夹里的 library.json.bak 改名成 library.json 再试一次。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <Sidebar />
        <Gallery />
        <DetailPanel />
        <DupPanel />
        <SettingsPanel />
      </div>
      <BatchBar />
      <EntryEditor />
      <Toasts />
      <ImportOverlay />
    </div>
  )
}
