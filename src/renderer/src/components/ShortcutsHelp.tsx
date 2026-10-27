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
  { keys: ['Ctrl', '+', 'Shift', '+', 'H'], desc: '导出单页 HTML' },
  { keys: ['Ctrl', '+', 'Shift', '+', 'C'], desc: '复制全部（正向 + 负向 + 参数）' },
  { keys: ['Ctrl', '+', 'Shift', '+', 'F'], desc: '只看收藏 / 取消收藏筛选' },
  { keys: ['Ctrl', '+', 'Shift', '+', 'M'], desc: '打开模型管理' },
  { keys: ['Ctrl', '+', 'Shift', '+', 'G'], desc: '打开标签管理' },
  { keys: ['Ctrl', '+', 'Shift', '+', 'D'], desc: '打开重复图检测' },
  { keys: ['Ctrl', '+', 'O'], desc: '导入文件' },
  { keys: ['Ctrl', '+', 'Shift', '+', 'O'], desc: '导入文件夹' },
  { keys: ['Ctrl', '+', '='], desc: '界面放大 5%' },
  { keys: ['Ctrl', '+', '-'], desc: '界面缩小 5%' },
  { keys: ['Ctrl', '+', '0'], desc: '界面恢复 100%' },
  { keys: ['[', '/', ']'], desc: '详情上一张 / 下一张产物' },
  { keys: ['Ctrl', '+', ','], desc: '打开设置' },
  { keys: ['?', '/', 'Ctrl', '+', '/'], desc: '打开 / 关闭这份帮助' },
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
