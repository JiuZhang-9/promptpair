import React, { useEffect, useRef, useState } from 'react'
import { selectEntries, useStore } from '../store'
import { Icon } from './ui'

function Dropdown({
  trigger,
  children,
  align = 'right',
  width = 240
}: {
  trigger: (open: boolean) => React.ReactNode
  children: (close: () => void) => React.ReactNode
  align?: 'left' | 'right'
  width?: number
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="dd" ref={ref}>
      <button type="button" className="dd-trigger" onClick={() => setOpen((v) => !v)}>
        {trigger(open)}
      </button>
      {open && (
        <div className={'dd-menu ' + align} style={{ width }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export default function TopBar(): React.ReactElement {
  const q = useStore((s) => s.q)
  const setQ = useStore((s) => s.setQ)
  const sort = useStore((s) => s.sort)
  const setSort = useStore((s) => s.setSort)
  const thumbSize = useStore((s) => s.thumbSize)
  const setThumbSize = useStore((s) => s.setThumbSize)
  const data = useStore((s) => s.data)
  const version = useStore((s) => s.version)
  const update = useStore((s) => s.update)
  const selectedIds = useStore((s) => s.selectedIds)
  const collectionId = useStore((s) => s.collectionId)
  const tagIds = useStore((s) => s.tagIds)
  const panel = useStore((s) => s.panel)

  const importDialog = useStore((s) => s.importDialog)
  const importPackDialog = useStore((s) => s.importPackDialog)
  const exportPack = useStore((s) => s.exportPack)
  const startCreate = useStore((s) => s.startCreate)
  const setPanel = useStore((s) => s.setPanel)
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const rightPanelCollapsed = useStore((s) => s.rightPanelCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const toggleRightPanel = useStore((s) => s.toggleRightPanel)
  const checkUpdate = useStore((s) => s.checkUpdate)
  const installUpdate = useStore((s) => s.installUpdate)
  const toast = useStore((s) => s.toast)
  const count = useStore((s) => selectEntries(s).length)

  const [searchFocus, setSearchFocus] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (document.querySelector('.overlay')) return
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const collName = data.collections.find((c) => c.id === collectionId)?.name

  const updateBadge = (): React.ReactNode => {
    if (update.state === 'downloaded')
      return (
        <button type="button" className="btn accent pulse" onClick={() => void installUpdate()}>
          <Icon name="refresh" size={13} /> 重启更新
        </button>
      )
    if (update.state === 'downloading')
      return (
        <div className="upd-progress" title={update.message}>
          <div className="upd-bar" style={{ width: `${update.percent ?? 0}%` }} />
          <span>{update.percent ?? 0}%</span>
        </div>
      )
    if (update.state === 'available')
      return (
        <button
          type="button"
          className="btn ghost"
          title={update.message}
          onClick={() => void checkUpdate()}
        >
          <Icon name="download" size={13} /> {update.version}
        </button>
      )
    return null
  }

  return (
    <>
      <header className="titlebar">
        <div className="brand">
          <div className="brand-mark">
            <span />
            <span />
          </div>
          <div className="brand-text">
            <b>PromptPair</b>
            <i>提示词配对</i>
          </div>
        </div>

        <div className="tb-fill" />

        <div className="tb-actions">
          {updateBadge()}

          <Dropdown
            width={272}
            trigger={() => (
              <span className="btn primary">
                <Icon name="plus" size={14} strokeWidth={2.2} /> 录入
                <Icon name="chevronDown" size={12} />
              </span>
            )}
          >
            {(close) => (
              <>
                <button
                  type="button"
                  className="dd-item"
                  onClick={() => {
                    close()
                    startCreate()
                  }}
                >
                  <Icon name="edit" size={14} />
                  <div>
                    <div>手动新建</div>
                    <small>粘贴提示词，再拖入图片/视频</small>
                  </div>
                </button>
                <div className="dd-sep" />
                <button
                  type="button"
                  className="dd-item"
                  onClick={() => {
                    close()
                    void importDialog('files')
                  }}
                >
                  <Icon name="upload" size={14} />
                  <div>
                    <div>选择文件导入</div>
                    <small>可多选，自动配对同名提示词</small>
                  </div>
                </button>
                <button
                  type="button"
                  className="dd-item"
                  onClick={() => {
                    close()
                    void importDialog('folder')
                  }}
                >
                  <Icon name="folderPlus" size={14} />
                  <div>
                    <div>导入整个文件夹</div>
                    <small>递归扫描，按文件夹名自动打标</small>
                  </div>
                </button>
                <div className="dd-sep" />
                <button
                  type="button"
                  className="dd-item"
                  onClick={() => {
                    close()
                    void importPackDialog()
                  }}
                >
                  <Icon name="package" size={14} />
                  <div>
                    <div>导入分享包</div>
                    <small>.promptpack 文件，可合并或作为新库</small>
                  </div>
                </button>
                <button
                  type="button"
                  className="dd-item"
                  onClick={() => {
                    close()
                    setPanel('settings')
                    toast('在设置里可以看到浏览器采集的接入状态', 'info')
                  }}
                >
                  <Icon name="link" size={14} />
                  <div>
                    <div>从浏览器采集</div>
                    <small>需安装配套插件，见设置页</small>
                  </div>
                </button>
              </>
            )}
          </Dropdown>

          <Dropdown
            width={280}
            trigger={() => (
              <span className="btn">
                <Icon name="package" size={14} />
                导出
                <Icon name="chevronDown" size={12} />
              </span>
            )}
          >
            {(close) => (
              <>
                <div className="dd-label">
                  {selectedIds.length > 0
                    ? `已选中 ${selectedIds.length} 条`
                    : `当前筛选 ${count} 条`}
                </div>
                {selectedIds.length > 0 && (
                  <button
                    type="button"
                    className="dd-item"
                    onClick={() => {
                      close()
                      void exportPack(selectedIds, true, collName)
                    }}
                  >
                    <Icon name="check" size={14} />
                    <div>
                      <div>只导出选中的 {selectedIds.length} 条</div>
                      <small>含媒体 + 自带浏览页，双击即看</small>
                    </div>
                  </button>
                )}
                <button
                  type="button"
                  className="dd-item"
                  onClick={() => {
                    close()
                    void exportPack(
                      selectEntries(useStore.getState()).map((e) => e.id),
                      true,
                      collName
                    )
                  }}
                >
                  <Icon name="filter" size={14} />
                  <div>
                    <div>导出当前筛选结果</div>
                    <small>共 {count} 条</small>
                  </div>
                </button>
                <button
                  type="button"
                  className="dd-item"
                  onClick={() => {
                    close()
                    void exportPack(
                      data.entries.map((e) => e.id),
                      true,
                      data.name
                    )
                  }}
                >
                  <Icon name="layers" size={14} />
                  <div>
                    <div>导出整个库</div>
                    <small>{data.entries.length} 条</small>
                  </div>
                </button>
                <div className="dd-sep" />
                <button
                  type="button"
                  className="dd-item"
                  onClick={async () => {
                    close()
                    const p = await window.pp.exportCsv()
                    if (p) toast('CSV 已导出', 'ok')
                  }}
                >
                  <Icon name="grid" size={14} />
                  <div>
                    <div>导出提示词清单 CSV</div>
                    <small>Excel 可直接打开</small>
                  </div>
                </button>
                <button
                  type="button"
                  className="dd-item"
                  onClick={async () => {
                    close()
                    const p = await window.pp.exportJson()
                    if (p) toast('JSON 备份已导出', 'ok')
                  }}
                >
                  <Icon name="download" size={14} />
                  <div>
                    <div>导出全部数据 JSON</div>
                    <small>纯数据备份，不含媒体文件</small>
                  </div>
                </button>
              </>
            )}
          </Dropdown>

          <button
            type="button"
            className={'icon-btn' + (sidebarCollapsed ? ' on' : '')}
            title={sidebarCollapsed ? '展开左栏 (Ctrl+B)' : '收起左栏 (Ctrl+B)'}
            onClick={toggleSidebar}
          >
            <Icon name="panelLeft" size={16} />
          </button>

          <button
            type="button"
            className={'icon-btn' + (rightPanelCollapsed ? ' on' : '')}
            title={rightPanelCollapsed ? '展开右栏 (Ctrl+Shift+B)' : '收起右栏 (Ctrl+Shift+B)'}
            onClick={toggleRightPanel}
          >
            <Icon name="panelRight" size={16} />
          </button>

          <button
            type="button"
            className="icon-btn"
            title="键盘快捷键 (?)"
            onClick={() => setShortcutsOpen(true)}
          >
            <Icon name="help" size={16} />
          </button>

          <button
            type="button"
            className={'icon-btn' + (panel === 'settings' ? ' on' : '')}
            title="设置"
            onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
          >
            <Icon name="settings" size={16} />
          </button>
        </div>

        <div className="tb-native" />
      </header>

      <div className="toolbar">
        <div className={'search' + (searchFocus ? ' focus' : '')}>
          <Icon name="search" size={15} />
          <input
            ref={searchRef}
            value={q}
            placeholder="搜索提示词、标题、标签、模型…（Ctrl+F）"
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setSearchFocus(true)}
            onBlur={() => setSearchFocus(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQ('')
                ;(e.target as HTMLInputElement).blur()
              }
            }}
          />
          {q && (
            <button type="button" className="search-clear" onClick={() => setQ('')} title="清空">
              <Icon name="close" size={12} strokeWidth={2.4} />
            </button>
          )}
        </div>

        <div className="tb-right">
          <div className="count-chip">
            {count} 条
            {tagIds.length > 0 && <span className="dot-sep" />}
            {tagIds.length > 0 && `${tagIds.length} 个标签`}
          </div>

          <div className="size-ctl" title="缩略图大小">
            <Icon name="grid" size={13} />
            <input
              type="range"
              min={120}
              max={380}
              step={20}
              value={thumbSize}
              onChange={(e) => setThumbSize(Number(e.target.value))}
            />
          </div>

          <select
            className="select"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            title="排序"
          >
            <option value="newest">最新添加</option>
            <option value="oldest">最早添加</option>
            <option value="rating">评分最高</option>
            <option value="title">标题 A→Z</option>
            <option value="assets">产物最多</option>
          </select>

          <div className="ver-chip" title={`PromptPair ${version}`}>
            v{version}
          </div>
        </div>
      </div>
    </>
  )
}
