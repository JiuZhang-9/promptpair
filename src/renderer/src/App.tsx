import React, { useEffect } from 'react'
import type { PromptEntry } from '../../shared/types'
import { selectEntries, useStore } from './store'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import Gallery from './components/Gallery'
import Viewer from './components/Viewer'
import Compare from './components/Compare'
import EntryEditor from './components/EntryEditor'
import BatchBar from './components/BatchBar'
import DupPanel from './components/DupPanel'
import TagManager from './components/TagManager'
import ModelManager from './components/ModelManager'
import SettingsPanel from './components/SettingsPanel'
import ShortcutsHelp from './components/ShortcutsHelp'
import { Icon, Modal, copyText } from './components/ui'
import { copyVariants } from './copyVariants'

function allTextForEntry(entry: PromptEntry): string {
  const rows: [string, string][] = []
  if (entry.params?.model) rows.push(['模型', entry.params.model])
  if (entry.params?.width && entry.params?.height)
    rows.push(['尺寸', `${entry.params.width} × ${entry.params.height}`])
  if (entry.params?.seed) rows.push(['Seed', entry.params.seed])
  if (entry.params?.steps) rows.push(['步数', String(entry.params.steps)])
  if (entry.params?.cfg) rows.push(['CFG', String(entry.params.cfg)])
  if (entry.params?.sampler) rows.push(['采样器', entry.params.sampler])
  const parts: string[] = []
  if (entry.positive) parts.push(entry.positive)
  if (entry.negative) parts.push('Negative: ' + entry.negative)
  if (entry.note) parts.push('备注：' + entry.note)
  if (rows.length) parts.push(rows.map(([k, v]) => `${k}: ${v}`).join('\n'))
  return parts.join('\n\n')
}

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

function CopyTip(): React.ReactElement | null {
  const tip = useStore((s) => s.tip)
  if (!tip) return null
  const left = Math.max(8, Math.min((window.innerWidth || 1200) - 260, tip.x + 14))
  const top = Math.max(8, Math.min((window.innerHeight || 800) - 48, tip.y - 38))
  return (
    <div className={'copy-tip ' + tip.kind} style={{ left, top }} role="status" aria-live="polite">
      <Icon name="check" size={13} strokeWidth={2.4} />
      <span>{tip.text}</span>
    </div>
  )
}

function ConfirmHost(): React.ReactElement | null {
  const confirm = useStore((s) => s.confirm)
  const closeConfirm = useStore((s) => s.closeConfirm)
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    setBusy(false)
  }, [confirm])

  if (!confirm) return null
  const run = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await confirm.onConfirm()
      closeConfirm()
    } catch (e) {
      toast('操作失败：' + (e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onClose={busy ? () => undefined : closeConfirm}
      width={430}
      label={confirm.title}
      zIndex={650}
    >
      <div className="confirm-box">
        <div className="confirm-title">{confirm.title}</div>
        <div className="confirm-msg">{confirm.message}</div>
        <div className="confirm-foot">
          <button type="button" className="btn" disabled={busy} onClick={closeConfirm}>
            取消
          </button>
          <button
            type="button"
            className={'btn ' + (confirm.danger ? 'danger' : 'primary')}
            disabled={busy}
            onClick={() => void run()}
            data-confirm-ok
          >
            {busy ? '处理中…' : confirm.confirmLabel || '确认'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function PackImportOverlay(): React.ReactElement | null {
  const p = useStore((s) => s.packImport)
  if (!p?.active) return null
  const pct = p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0
  const label =
    p.stage === 'extract'
      ? '解压分享包'
      : p.stage === 'import'
        ? '导入媒体与记录'
        : p.stage === 'done'
          ? '完成'
          : '准备中'
  const detail =
    p.stage === 'import' && p.entriesTotal
      ? `记录 ${p.entriesDone ?? 0} / ${p.entriesTotal} · 媒体 ${p.done} / ${p.total}`
      : p.stage === 'extract' && p.total
        ? `文件 ${p.done} / ${p.total}`
        : '大分享包需要几分钟，请不要关闭窗口'
  return (
    <div className="import-overlay pack-import" data-pack-import>
      <div className="import-card">
        <div className="import-head">
          <div className="spinner" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="import-title">正在导入分享包…</div>
            <div className="import-sub">{label}</div>
          </div>
          {p.total > 0 ? <div className="import-pct">{pct}%</div> : null}
        </div>
        <div className="import-track">
          <div
            className={'import-bar' + (p.total > 0 ? '' : ' indeterminate')}
            style={p.total > 0 ? { width: `${pct}%` } : undefined}
          />
        </div>
        <div className="import-note pack-import-detail">{detail}</div>
        <div className="pack-import-file ellipsis" title={p.current}>
          {p.current || '准备中…'}
        </div>
      </div>
    </div>
  )
}

function PackErrorDialog(): React.ReactElement | null {
  const err = useStore((s) => s.packError)
  const setErr = useStore((s) => s.setPackError)
  const showTip = useStore((s) => s.showTip)
  const toast = useStore((s) => s.toast)
  if (!err) return null
  return (
    <Modal open onClose={() => setErr(null)} width={620} label="分享包导入失败">
      <div className="pack-error-box">
        <div className="mm-title">分享包导入失败</div>
        <div className="mm-sub">原始库没有被切换；合并模式会自动回滚到导入前的数据。</div>
        <pre className="pack-error-text">{err.message}</pre>
        <div className="pack-error-actions">
          <button
            type="button"
            className="btn"
            onClick={() =>
              void window.pp.openLogs().then((r) => {
                if (!r.ok) toast(r.message || '打开日志文件夹失败', 'err')
              })
            }
          >
            <Icon name="folder" size={13} /> 打开日志文件夹
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void copyText(err.message)
                .then(() => showTip('已复制错误信息'))
                .catch(() => toast('复制失败，请手动选中', 'err'))
            }
          >
            <Icon name="copy" size={13} /> 复制错误
          </button>
          <div className="pack-error-spacer" />
          <button type="button" className="btn primary" onClick={() => setErr(null)}>
            关闭
          </button>
        </div>
      </div>
    </Modal>
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
  const viewerId = useStore((s) => s.viewerId)
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
  const exportHtml = useStore((s) => s.exportHtml)
  const importDialog = useStore((s) => s.importDialog)
  const applyConfig = useStore((s) => s.applyConfig)
  const setPanel = useStore((s) => s.setPanel)
  const scanDups = useStore((s) => s.scanDups)
  const toggleFavoriteFilter = useStore((s) => s.toggleFavorite)
  const toast = useStore((s) => s.toast)
  const showTip = useStore((s) => s.showTip)
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
      // 大图查看器 / A-B 对比有自己的键位（Esc / 方向键 / 缩放），不让底层快捷键穿透
      if (document.querySelector('.viewer') || document.querySelector('.cmp')) return

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
        if (selectedIds.length) clearSelection()
        return
      }

      // 回车打开当前焦点 / 选中项的大图（焦点落在按钮上时让按钮自己处理）
      if (e.key === 'Enter') {
        const el = e.target as HTMLElement
        if (el.closest('button, a, input, textarea, [contenteditable="true"]')) return
        const state = useStore.getState()
        const list = selectEntries(state)
        const id =
          state.focusIndex != null ? list[state.focusIndex]?.id : state.selectedIds[0]
        if (id) {
          e.preventDefault()
          state.openViewer(id)
        }
        return
      }

      const targetIds = (): string[] => {
        const state = useStore.getState()
        if (state.selectedIds.length) return state.selectedIds
        const list = selectEntries(state)
        return state.focusIndex != null && list[state.focusIndex]
          ? [list[state.focusIndex].id]
          : []
      }

      if (mod && e.key === ',') {
        e.preventDefault()
        setPanel('settings')
        return
      }
      if (mod && e.key === '/') {
        e.preventDefault()
        setShortcutsOpen(true)
        return
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void importDialog(e.shiftKey ? 'folder' : 'files')
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        const ids = targetIds()
        if (ids.length) void exportHtml(ids, 'thumb')
        else toast('先选中记录，再导出单页 HTML', 'info')
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        const state = useStore.getState()
        const ids = targetIds()
        const targets = state.data.entries.filter((x) => ids.includes(x.id))
        if (targets.length) {
          void copyText(targets.map(allTextForEntry).join('\n\n---\n\n'))
            .then(() => showTip('已复制全部内容'))
            .catch(() => toast('复制失败，请手动选中文本', 'err'))
        }
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        toggleFavoriteFilter()
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        setPanel('models')
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        setPanel('tags')
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        void scanDups()
        setPanel('dups')
        return
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        const cur = Math.round((useStore.getState().config.uiScale ?? 1) * 100)
        const next = Math.min(110, cur + 5)
        void applyConfig({ uiScale: next / 100 })
        toast(`界面大小 ${next}%`, 'info')
        return
      }
      if (mod && e.key === '-') {
        e.preventDefault()
        const cur = Math.round((useStore.getState().config.uiScale ?? 1) * 100)
        const next = Math.max(90, cur - 5)
        void applyConfig({ uiScale: next / 100 })
        toast(`界面大小 ${next}%`, 'info')
        return
      }
      if (mod && e.key === '0') {
        e.preventDefault()
        void applyConfig({ uiScale: 1 })
        toast('界面大小 100%', 'info')
        return
      }

      if (mod && !e.shiftKey && e.key.toLowerCase() === 'c') {
        const state = useStore.getState()
        const list = selectEntries(state)
        const target =
          state.focusIndex != null
            ? list[state.focusIndex]
            : list.find((x) => x.id === state.selectedIds[0])
        if (target?.positive) {
          e.preventDefault()
          void copyText(copyVariants(target)[0].text)
            .then(() => showTip('已复制提示词'))
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
    viewerId,
    editorOpen,
    clearSelection,
    removeEntries,
    startCreate,
    startEdit,
    batchTagModal,
    setBatchTagModal,
    shortcutsOpen,
    setShortcutsOpen,
    moveFocus,
    toggleFocusSelection,
    selectAllFiltered,
    patchEntries,
    exportPack,
    exportHtml,
    importDialog,
    applyConfig,
    setPanel,
    scanDups,
    toggleFavoriteFilter,
    toast,
    showTip,
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

  const rightOpen = panel === 'dups' || panel === 'tags' || panel === 'models'

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
          <DupPanel />
          <TagManager />
          <ModelManager />
        </div>
      </div>
      <BatchBar />
      <EntryEditor />
      <SettingsPanel />
      <ShortcutsHelp />
      <Viewer />
      <Compare />
      <Toasts />
      <CopyTip />
      <ConfirmHost />
      <PackImportOverlay />
      <PackErrorDialog />
      <ImportOverlay />
    </div>
  )
}
