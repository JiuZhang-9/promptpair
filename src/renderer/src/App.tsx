import React, { useEffect } from 'react'
import { selectEntries, useStore } from './store'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import Gallery from './components/Gallery'
import DetailPanel from './components/DetailPanel'
import EntryEditor from './components/EntryEditor'
import BatchBar from './components/BatchBar'
import DupPanel from './components/DupPanel'
import TagManager from './components/TagManager'
import ModelManager from './components/ModelManager'
import SettingsPanel from './components/SettingsPanel'
import ShortcutsHelp from './components/ShortcutsHelp'
import { Icon, copyText } from './components/ui'

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
  const startEdit = useStore((s) => s.startEdit)
  const detailId = useStore((s) => s.detailId)
  const openDetail = useStore((s) => s.openDetail)
  const editorOpen = useStore((s) => s.editorOpen)
  const batchTagModal = useStore((s) => s.batchTagModal)
  const setBatchTagModal = useStore((s) => s.setBatchTagModal)
  const shortcutsOpen = useStore((s) => s.shortcutsOpen)
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen)
  const moveFocus = useStore((s) => s.moveFocus)
  const toggleFocusSelection = useStore((s) => s.toggleFocusSelection)
  const selectAllFiltered = useStore((s) => s.selectAllFiltered)
  const patchEntries = useStore((s) => s.patchEntries)
  const exportPack = useStore((s) => s.exportPack)
  const toast = useStore((s) => s.toast)
  const panel = useStore((s) => s.panel)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const rightPanelCollapsed = useStore((s) => s.rightPanelCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const toggleRightPanel = useStore((s) => s.toggleRightPanel)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (typing) return

      const mod = e.ctrlKey || e.metaKey

      // 布局开关在弹窗打开时也生效，方便随时收起/展开
      if (mod && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleRightPanel()
        return
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
        return
      }

      // 帮助浮层：只处理 Esc，避免底层快捷键穿透
      if (shortcutsOpen) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setShortcutsOpen(false)
        }
        return
      }
      // 编辑器和批量标签弹层有自己的键位，不抢
      if (editorOpen || batchTagModal !== 'none') return
      // 任何浮层（编辑器 / 批量标签 / AI / 合并 / 设置）打开时，不让底层快捷键穿透
      if (document.querySelector('.overlay')) return

      if (e.key === 'Escape') {
        if (detailId) openDetail(null)
        else if (selectedIds.length) clearSelection()
        return
      }

      if (mod && e.key.toLowerCase() === 'c') {
        const state = useStore.getState()
        const list = selectEntries(state)
        const target =
          state.focusIndex != null
            ? list[state.focusIndex]
            : list.find((x) => x.id === state.selectedIds[0])
        if (target?.positive) {
          e.preventDefault()
          void copyText(target.positive)
            .then(() => toast('已复制提示词', 'ok'))
            .catch(() => toast('复制失败，请手动选中文本', 'err'))
        }
        return
      }

      if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        if (selectedIds.length) void exportPack(selectedIds, true)
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        selectAllFiltered()
        return
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        startCreate()
        return
      }
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        moveFocus(1)
        return
      }
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        moveFocus(-1)
        return
      }
      if (mod && e.key.toLowerCase() === 't') {
        if (selectedIds.length) setBatchTagModal('add')
        else toast('先选中记录，再打开标签面板', 'info')
        return
      }
      if (mod || e.altKey) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveFocus(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveFocus(-1)
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        toggleFocusSelection()
        return
      }
      if (e.key >= '1' && e.key <= '5') {
        const state = useStore.getState()
        const list = selectEntries(state)
        const ids = state.selectedIds.length
          ? state.selectedIds
          : state.focusIndex != null && list[state.focusIndex]
            ? [list[state.focusIndex].id]
            : []
        if (ids.length) {
          e.preventDefault()
          void patchEntries(ids, { rating: Number(e.key) }, { optimistic: true, quiet: true })
        } else {
          toast('先选中记录，或把鼠标移到卡片上', 'info')
        }
        return
      }
      if (e.key === '0') {
        const state = useStore.getState()
        const list = selectEntries(state)
        const ids = state.selectedIds.length
          ? state.selectedIds
          : state.focusIndex != null && list[state.focusIndex]
            ? [list[state.focusIndex].id]
            : []
        if (ids.length) {
          e.preventDefault()
          void patchEntries(ids, { rating: 0 }, { optimistic: true, quiet: true })
        }
        return
      }
      if (e.key.toLowerCase() === 'f') {
        const state = useStore.getState()
        const list = selectEntries(state)
        const ids = state.selectedIds.length
          ? state.selectedIds
          : state.focusIndex != null && list[state.focusIndex]
            ? [list[state.focusIndex].id]
            : []
        if (ids.length) {
          const chosen = state.data.entries.filter((x) => ids.includes(x.id))
          const next = !(chosen.length > 0 && chosen.every((x) => x.favorite))
          e.preventDefault()
          void patchEntries(ids, { favorite: next }, { optimistic: true, quiet: true })
        }
        return
      }
      if (e.key.toLowerCase() === 'e') {
        const state = useStore.getState()
        const list = selectEntries(state)
        const id =
          state.focusIndex != null ? list[state.focusIndex]?.id : state.selectedIds[0]
        if (id) startEdit(id)
        return
      }
      if (e.key === '?') {
        setShortcutsOpen(true)
        return
      }
      if (e.key === 'Delete' && selectedIds.length) {
        e.preventDefault()
        if (window.confirm(`删除选中的 ${selectedIds.length} 条记录？`)) void removeEntries(selectedIds)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [
    selectedIds,
    detailId,
    editorOpen,
    clearSelection,
    removeEntries,
    startCreate,
    startEdit,
    openDetail,
    batchTagModal,
    setBatchTagModal,
    shortcutsOpen,
    setShortcutsOpen,
    moveFocus,
    toggleFocusSelection,
    selectAllFiltered,
    patchEntries,
    exportPack,
    toast,
    toggleSidebar,
    toggleRightPanel
  ])

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

  const rightOpen = !!detailId || panel === 'dups' || panel === 'tags' || panel === 'models'

  return (
    <div className="app">
      <TopBar />
      <div className={'main' + (sidebarCollapsed ? ' sidebar-collapsed' : '')}>
        <Sidebar />
        <Gallery />
        <div
          className={
            'right-dock' +
            (rightOpen ? ' open' : '') +
            (rightPanelCollapsed ? ' collapsed' : '')
          }
        >
          <DetailPanel />
          <DupPanel />
          <TagManager />
          <ModelManager />
        </div>
      </div>
      <BatchBar />
      <EntryEditor />
      <SettingsPanel />
      <ShortcutsHelp />
      <Toasts />
      <ImportOverlay />
    </div>
  )
}
