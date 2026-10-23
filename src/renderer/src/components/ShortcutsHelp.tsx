import React from 'react'
import { useStore } from '../store'
import { Modal } from './ui'

const SEPARATORS = new Set(['/', '+'])

const ROWS: { keys: string[]; desc: string }[] = [
  { keys: ['Ctrl', '+', 'J', '/', 'Ctrl', '+', 'K', '/', '↑', '/', '↓'], desc: '上下移动焦点（不改变选中）' },
  { keys: ['Ctrl', '+', 'B'], desc: '收起 / 展开左栏' },
  { keys: ['Ctrl', '+', 'Shift', '+', 'B'], desc: '收起 / 展开右栏' },
  { keys: ['Ctrl', '+', 'C'], desc: '复制焦点卡片的提示词' },
  { keys: ['Shift', '+', '右键'], desc: '复制鼠标所指卡片的提示词' },
  { keys: ['Space'], desc: '切换当前项的选中' },
  { keys: ['1', '–', '5'], desc: '给选中项（或焦点卡片）打 N 星' },
  { keys: ['0'], desc: '清除评分' },
  { keys: ['F'], desc: '收藏 / 取消收藏' },
  { keys: ['E'], desc: '编辑当前项' },
  { keys: ['Ctrl', '+', 'T'], desc: '打开批量标签面板' },
  { keys: ['Ctrl', '+', 'A'], desc: '全选当前筛选结果' },
  { keys: ['Ctrl', '+', 'Shift', '+', 'E'], desc: '导出选中的记录' },
  { keys: ['?'], desc: '打开 / 关闭这份帮助' },
  { keys: ['Esc'], desc: '关闭浮层 / 清空选中' },
  { keys: ['Ctrl', '+', 'F'], desc: '定位到搜索框' },
  { keys: ['Ctrl', '+', 'N'], desc: '新建记录' },
  { keys: ['Delete'], desc: '删除选中的记录' },
  { keys: ['空白拖拽'], desc: '框选卡片；按住 Ctrl 拖拽追加选中' },
  { keys: ['空白单击'], desc: '取消选中并收起底部操作条' },
  { keys: ['Ctrl', '+', 'Enter'], desc: '在编辑窗口里保存' }
]

export default function ShortcutsHelp(): React.ReactElement {
  const open = useStore((s) => s.shortcutsOpen)
  const setOpen = useStore((s) => s.setShortcutsOpen)

  return (
    <Modal open={open} onClose={() => setOpen(false)} width={520} label="键盘快捷键">
      <div className="mini-modal-head">
        <div className="mm-title">键盘快捷键</div>
        <div className="mm-sub">在输入框里不会触发；按 ? 随时打开</div>
      </div>
      <div className="sc-list">
        {ROWS.map((row) => (
          <div className="sc-row" key={row.keys.join('')}>
            <div className="sc-keys">
              {row.keys.map((k, i) =>
                SEPARATORS.has(k) ? (
                  <span key={i} className="sc-sep">
                    {k}
                  </span>
                ) : (
                  <kbd key={i} className="kbd">
                    {k}
                  </kbd>
                )
              )}
            </div>
            <span className="sc-desc">{row.desc}</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
