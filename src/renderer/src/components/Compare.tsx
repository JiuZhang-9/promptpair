import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Asset } from '../../../shared/types'
import { assetMap, mediaUrl, useStore } from '../store'
import { Icon } from './ui'

type CompareMode = 'slider' | 'side' | 'blink'
type Orientation = 'v' | 'h'

const MODE_LABEL: Record<CompareMode, string> = {
  slider: '滑杆',
  side: '并排',
  blink: '闪烁'
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function normPrompt(s: string | undefined): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function assetName(a: Asset | undefined): string {
  if (!a) return '缺失'
  return a.relPath.split('/').pop() || a.id
}

/**
 * A/B 对比浮层（0.16.0）。
 *
 * - 同一记录：默认比较第 1 / 第 2 个产物（MJ码图是原图↔成图）；
 * - 两条记录：默认比较各自封面，用于同 prompt 跨模型；
 * - 滑杆（左右 / 上下）、并排、闪烁三种看法；导出 GIF 走主进程。
 */
export default function Compare(): React.ReactElement | null {
  const compare = useStore((s) => s.compare)
  const data = useStore((s) => s.data)
  const closeCompare = useStore((s) => s.closeCompare)
  const toast = useStore((s) => s.toast)

  const assets = useMemo(() => assetMap(data), [data.assets])
  const entryA = useMemo(
    () => (compare ? data.entries.find((e) => e.id === compare.a.entryId) : undefined),
    [compare, data.entries]
  )
  const entryB = useMemo(
    () => (compare ? data.entries.find((e) => e.id === compare.b.entryId) : undefined),
    [compare, data.entries]
  )

  const [aId, setAId] = useState('')
  const [bId, setBId] = useState('')
  const [mode, setMode] = useState<CompareMode>('slider')
  const [orient, setOrient] = useState<Orientation>('v')
  const [split, setSplit] = useState(50)
  const [showA, setShowA] = useState(true)
  const [playing, setPlaying] = useState(true)
  const [busy, setBusy] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  const imageIds = (entryId: string | undefined): string[] => {
    const e = data.entries.find((x) => x.id === entryId)
    if (!e) return []
    return e.assetIds.filter((id) => assets.get(id)?.kind === 'image')
  }

  useEffect(() => {
    if (!compare) return
    const imagesA = imageIds(compare.a.entryId)
    const imagesB = imageIds(compare.b.entryId)
    const a = imagesA.includes(compare.a.assetId) ? compare.a.assetId : imagesA[0] ?? ''
    let b = imagesB.includes(compare.b.assetId) ? compare.b.assetId : imagesB[0] ?? ''
    if (a && a === b && imagesB.length > 1) b = imagesB.find((id) => id !== a) ?? b
    setAId(a)
    setBId(b)
    setSplit(50)
    setShowA(true)
    setPlaying(true)
    // imageIds 只依赖当前 store 快照；打开对比时取一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare])

  useEffect(() => {
    if (!compare) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeCompare()
        return
      }
      if (e.key === ' ' && mode === 'blink') {
        e.preventDefault()
        setPlaying((v) => !v)
        return
      }
      if (mode === 'slider' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        setSplit((v) => clamp(v + (e.key === 'ArrowRight' ? 4 : -4), 2, 98))
      }
      if (mode === 'blink' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        setShowA((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [compare, closeCompare, mode])

  useEffect(() => {
    if (!compare || mode !== 'blink' || !playing) return
    const t = window.setInterval(() => setShowA((v) => !v), 720)
    return () => window.clearInterval(t)
  }, [compare, mode, playing])

  if (!compare || !entryA || !entryB) return null

  const a = assets.get(aId)
  const b = assets.get(bId)
  const aOptions = imageIds(entryA.id)
  const bOptions = imageIds(entryB.id)
  const sameEntry = entryA.id === entryB.id
  const samePrompt = !!normPrompt(entryA.positive) && normPrompt(entryA.positive) === normPrompt(entryB.positive)
  const aIdx = entryA.assetIds.indexOf(aId) + 1
  const bIdx = entryB.assetIds.indexOf(bId) + 1
  const current = mode === 'blink' ? (showA ? a : b) : a

  const onDividerPointerDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const update = (clientX: number, clientY: number): void => {
      const r = stage.getBoundingClientRect()
      const p = orient === 'v' ? (clientX - r.left) / r.width : (clientY - r.top) / r.height
      setSplit(clamp(p * 100, 2, 98))
    }
    update(e.clientX, e.clientY)
    const move = (ev: PointerEvent): void => update(ev.clientX, ev.clientY)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const swap = (): void => {
    const nextA = bId
    const nextB = aId
    setAId(nextA)
    setBId(nextB)
  }

  const exportGif = async (): Promise<void> => {
    if (!a || !b || busy) return
    setBusy(true)
    try {
      const name = `${entryA.title || 'A'} vs ${entryB.title || 'B'}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
      const out = await window.pp.exportCompareGif(a.id, b.id, name)
      if (out) toast('已导出 GIF：' + out.path, 'ok')
    } catch (e) {
      toast('导出 GIF 失败：' + (e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const labelA = `${sameEntry ? `产物 ${aIdx}` : entryA.title || 'A'}`
  const labelB = `${sameEntry ? `产物 ${bIdx}` : entryB.title || 'B'}`

  return (
    <div className="cmp" data-cmp data-mode={mode} data-split={split}>
      <header className="cmp-top">
        <div className="cmp-title">
          <Icon name="swap" size={15} />
          <b>A / B 对比</b>
          <span className={'cmp-match ' + (sameEntry ? 'same' : samePrompt ? 'prompt' : 'diff')}>
            {sameEntry ? '同一条记录' : samePrompt ? '同一提示词' : '不同提示词'}
          </span>
        </div>
        <div className="cmp-top-spacer" />
        <div className="cmp-modes">
          {(['slider', 'side', 'blink'] as CompareMode[]).map((m) => (
            <button
              key={m}
              type="button"
              data-cmp-mode={m}
              className={'cmp-mode' + (mode === m ? ' on' : '')}
              onClick={() => setMode(m)}
              title={m === 'slider' ? '拖动中线对比' : m === 'side' ? '左右并排' : 'A/B 闪烁'}
            >
              <Icon name={m === 'slider' ? 'swap' : m === 'side' ? 'grid' : 'eye'} size={12} />
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        {mode === 'slider' && (
          <button
            type="button"
            className="cmp-btn"
            data-cmp-action="orient"
            onClick={() => setOrient((v) => (v === 'v' ? 'h' : 'v'))}
            title={orient === 'v' ? '切换为上下对比' : '切换为左右对比'}
          >
            <Icon name="swap" size={12} className={orient === 'h' ? 'cmp-rot' : ''} />
            {orient === 'v' ? '左右' : '上下'}
          </button>
        )}
        {mode === 'blink' && (
          <button
            type="button"
            className="cmp-btn"
            data-cmp-action="pause"
            onClick={() => setPlaying((v) => !v)}
            title="空格切换"
          >
            <Icon name={playing ? 'minus' : 'play'} size={12} />
            {playing ? '暂停' : '播放'}
          </button>
        )}
        <button type="button" className="cmp-btn" data-cmp-action="swap" onClick={swap} title="交换 A / B">
          <Icon name="swap" size={12} /> 交换
        </button>
        <button
          type="button"
          className="cmp-btn primary"
          data-cmp-action="gif"
          onClick={() => void exportGif()}
          disabled={busy || !a || !b}
          title="把 A/B 两帧导出成循环 GIF"
        >
          <Icon name="download" size={13} /> {busy ? '导出中…' : '导出 GIF'}
        </button>
        <button type="button" className="icon-btn" onClick={closeCompare} title="关闭 (Esc)">
          <Icon name="close" size={15} strokeWidth={2.2} />
        </button>
      </header>

      <div className="cmp-body">
        {mode === 'slider' ? (
          <div
            className={'cmp-stage ' + (orient === 'v' ? 'v' : 'h')}
            ref={stageRef}
            onPointerDown={onDividerPointerDown}
          >
            <div className="cmp-layer b">
              {b ? <img src={mediaUrl(b)} alt={labelB} draggable={false} /> : <div className="cmp-empty">B 没有图片</div>}
            </div>
            <div
              className="cmp-layer a"
              style={orient === 'v' ? { clipPath: `inset(0 ${100 - split}% 0 0)` } : { clipPath: `inset(0 0 ${100 - split}% 0)` }}
            >
              {a ? <img src={mediaUrl(a)} alt={labelA} draggable={false} /> : <div className="cmp-empty">A 没有图片</div>}
            </div>
            <div
              className={'cmp-divider ' + (orient === 'v' ? 'v' : 'h')}
              style={orient === 'v' ? { left: `${split}%` } : { top: `${split}%` }}
            >
              <span className="cmp-handle">
                <Icon name="swap" size={14} />
              </span>
            </div>
            <span className="cmp-badge left">A · {labelA}</span>
            <span className="cmp-badge right">B · {labelB}</span>
            <span className="cmp-hint">拖动中线对比 · {split.toFixed(0)}%</span>
          </div>
        ) : mode === 'side' ? (
          <div className="cmp-side">
            <div className="cmp-pane">
              <div className="cmp-pane-head">
                <span className="cmp-ab">A</span>
                <span className="ellipsis" title={labelA}>{labelA}</span>
                <em>{entryA.params?.model || ''}</em>
              </div>
              {a ? <img src={mediaUrl(a)} alt={labelA} draggable={false} /> : <div className="cmp-empty">A 没有图片</div>}
            </div>
            <div className="cmp-pane">
              <div className="cmp-pane-head">
                <span className="cmp-ab">B</span>
                <span className="ellipsis" title={labelB}>{labelB}</span>
                <em>{entryB.params?.model || ''}</em>
              </div>
              {b ? <img src={mediaUrl(b)} alt={labelB} draggable={false} /> : <div className="cmp-empty">B 没有图片</div>}
            </div>
          </div>
        ) : (
          <div className="cmp-blink" onClick={() => setShowA((v) => !v)}>
            {current ? <img src={mediaUrl(current)} alt={showA ? labelA : labelB} draggable={false} /> : <div className="cmp-empty">没有图片</div>}
            <span className="cmp-badge left">{showA ? 'A' : 'B'} · {showA ? labelA : labelB}</span>
            <span className="cmp-hint">点击图片切换 A / B · 空格暂停</span>
          </div>
        )}
      </div>

      <footer className="cmp-foot">
        <label className="cmp-select">
          <span>A</span>
          <select value={aId} onChange={(e) => setAId(e.target.value)}>
            {aOptions.map((id, i) => (
              <option key={id} value={id}>
                第 {entryA.assetIds.indexOf(id) + 1} 张 · {assetName(assets.get(id))}
              </option>
            ))}
          </select>
          <em>{entryA.title || '未命名'}</em>
        </label>
        <label className="cmp-select">
          <span>B</span>
          <select value={bId} onChange={(e) => setBId(e.target.value)}>
            {bOptions.map((id) => (
              <option key={id} value={id}>
                第 {entryB.assetIds.indexOf(id) + 1} 张 · {assetName(assets.get(id))}
              </option>
            ))}
          </select>
          <em>{entryB.title || '未命名'}</em>
        </label>
        <div className="cmp-foot-spacer" />
        <span className="cmp-meta">
          {sameEntry ? '同一条记录 · 默认第 1 / 第 2 张' : samePrompt ? '同一提示词 · 跨模型 / 跨记录' : '提示词不同'}
        </span>
      </footer>
    </div>
  )
}
