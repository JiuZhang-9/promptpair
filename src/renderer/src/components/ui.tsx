import React, { useEffect, useRef } from 'react'

/* ───────────── 图标：内联 SVG，不引外部依赖 ───────────── */

const PATHS: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm10 17-5.2-5.2',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm9 4v6m-3-3h6',
  tag: 'M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z',
  image: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  video: 'M15 10l6-4v12l-6-4Zm-12-5h12v14H3z',
  star: 'M12 3l2.7 5.9 6.3.7-4.7 4.3 1.3 6.1L12 16.9 6.4 20l1.3-6.1L3 9.6l6.3-.7L12 3Z',
  trash: 'M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13',
  edit: 'M4 20h4l10-10-4-4L4 16v4Zm12-14 2-2 4 4-2 2-4-4Z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2-1.2L15 3H9l-.5 2.6a8 8 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A8 8 0 0 0 4 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2 1.2L9 21h6l.5-2.6a8 8 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  download: 'M12 4v10m0 0 4-4m-4 4-4-4M4 18h16',
  upload: 'M12 20V10m0 0-4 4m4-4 4 4M4 6h16',
  check: 'M4 12l5 5L20 6',
  copy: 'M9 9h10v12H9zM5 15V3h10',
  link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
  layers: 'M12 3l9 5-9 5-9-5 9-5Zm9 9-9 5-9-5m18 4-9 5-9-5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  refresh: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5',
  external: 'M14 4h6v6M20 4l-9 9M10 4H5v15h15v-5',
  dots: 'M6 12h.01M12 12h.01M18 12h.01',
  sparkles: 'M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3ZM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15Z',
  alert: 'M12 3l9 16H3l9-16Zm0 6v4m0 3h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13h.01M12 11v6',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.9-12a3 3 0 1 1 5.4 1.7c-.8.8-2.5 1.3-2.5 3.3M12 17h.01',
  panelLeft: 'M4 4h16v16H4zM9 4v16',
  panelRight: 'M4 4h16v16H4zM15 4v16',
  eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  swap: 'M7 8h10l-3-3m3 11H7l3 3',
  play: 'M8 5l11 7-11 7V5Z',
  package: 'M12 3l9 5v8l-9 5-9-5V8l9-5Zm0 0v18M3 8l9 5 9-5'
}

export function Icon({
  name,
  size = 16,
  className = '',
  strokeWidth = 1.7
}: {
  name: keyof typeof PATHS | string
  size?: number
  className?: string
  strokeWidth?: number
}): React.ReactElement {
  const d = PATHS[name] ?? PATHS.info
  return (
    <svg
      className={'ico ' + className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

/* ───────────── 弹层 ───────────── */

export function Modal({
  open,
  onClose,
  children,
  width = 720,
  className = '',
  label
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  width?: number
  className?: string
  label?: string
}): React.ReactElement | null {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div className={'modalbox ' + className} style={{ width }} ref={ref}>
        {children}
      </div>
    </div>
  )
}

/* ───────────── 小组件 ───────────── */

export function Stars({
  value,
  onChange,
  size = 14,
  readOnly = false
}: {
  value: number
  onChange?: (v: number) => void
  size?: number
  readOnly?: boolean
}): React.ReactElement {
  return (
    <div className={'stars' + (readOnly ? ' ro' : '')}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          className={'star' + (i <= value ? ' on' : '')}
          disabled={readOnly}
          onClick={(e) => {
            e.stopPropagation()
            if (!readOnly) onChange?.(value === i ? 0 : i)
          }}
          title={readOnly ? undefined : `${i} 星`}
        >
          <Icon name="star" size={size} strokeWidth={1.4} />
        </button>
      ))}
    </div>
  )
}

export function TagChip({
  name,
  active,
  count,
  onClick,
  onContextMenu,
  small
}: {
  name: string
  color?: string
  active?: boolean
  count?: number
  onClick?: (e: React.MouseEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
  small?: boolean
}): React.ReactElement {
  // 单色设计：标签不再按组上色，选中态用「反白」表达，避免调色盘效应
  return (
    <button
      type="button"
      className={'tagchip' + (active ? ' on' : '') + (small ? ' sm' : '')}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={count !== undefined ? `${name} · ${count} 条` : name}
    >
      <span>{name}</span>
      {count !== undefined && <span className="tagcount">{count}</span>}
    </button>
  )
}

export function hexAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

function brighten(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return hex
  const mix = (v: number): number => Math.round(v + (255 - v) * 0.35)
  const r = mix(parseInt(h.slice(0, 2), 16))
  const g = mix(parseInt(h.slice(2, 4), 16))
  const b = mix(parseInt(h.slice(4, 6), 16))
  return `rgb(${r},${g},${b})`
}

export function Empty({
  icon = 'sparkles',
  title,
  desc,
  children
}: {
  icon?: string
  title: string
  desc?: string
  children?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="empty">
      <div className="empty-ico">
        <Icon name={icon} size={30} strokeWidth={1.4} />
      </div>
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
      {children && <div className="empty-actions">{children}</div>}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  grow
}: {
  label: string
  hint?: string
  children: React.ReactNode
  grow?: boolean
}): React.ReactElement {
  return (
    <label className={'field' + (grow ? ' grow' : '')}>
      <span className="field-label">
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}): React.ReactElement {
  return (
    <button
      type="button"
      className={'toggle-row' + (checked ? ' on' : '')}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className="toggle-track">
        <span className="toggle-dot" />
      </span>
      <span className="toggle-label">{label}</span>
    </button>
  )
}

export async function copyText(text: string): Promise<void> {
  if (!text) throw new Error('没有可复制的内容')
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // file:// 等场景可能拒绝异步剪贴板，继续走 execCommand 回退
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '-1000px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } finally {
    document.body.removeChild(ta)
  }
  if (!ok) throw new Error('剪贴板不可用')
}

export function formatBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`
}

export function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
