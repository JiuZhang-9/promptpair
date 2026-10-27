import React from 'react'
import { Modal } from './ui'

const ROWS: [string, string][] = [
  ['tag:赛博朋克', '标签名包含「赛博朋克」'],
  ['tag:"电影感 夜景"', '标签名带空格时用引号'],
  ['model:即梦', '模型名包含「即梦」'],
  ['model:"即梦 3.0"', '精确到版本'],
  ['platform:即梦', '来源平台'],
  ['collection:客户A', '所属集合'],
  ['rating:>=4', '评分大于等于 4'],
  ['rating:4', '评分正好 4'],
  ['kind:video', '只要视频（也支持 image）'],
  ['is:favorite', '只看收藏（unrated / rated）'],
  ['has:negative', '有负向提示词（prompt / note）'],
  ['before:2026-10-20', '创建日期早于'],
  ['after:2026-10-01', '创建日期不早于'],
  ['赛博朋克 雨夜', '不带 key 的词照旧全文搜索']
]

export default function SearchHelp({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.ReactElement {
  return (
    <Modal open={open} onClose={onClose} width={620} label="搜索语法">
      <div className="mini-modal-head">
        <div className="mm-title">搜索语法</div>
        <div className="mm-sub">多个条件用空格隔开；不带 key 的词仍做全文搜索</div>
      </div>
      <div className="mini-modal-body">
        <div className="search-syntax-list">
          {ROWS.map(([code, desc]) => (
            <div className="search-syntax-row" key={code}>
              <code>{code}</code>
              <span>{desc}</span>
            </div>
          ))}
        </div>
        <div className="set-note" style={{ paddingTop: 12 }}>
          例：<code>tag:赛博朋克 model:即梦 rating:&gt;=4 is:favorite</code>
        </div>
      </div>
    </Modal>
  )
}
