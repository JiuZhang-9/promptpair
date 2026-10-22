import React from 'react'
import { Modal } from './ui'

export default function ShareHelp({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.ReactElement {
  return (
    <Modal open={open} onClose={onClose} width={620} label="分享说明">
      <div className="mini-modal-head">
        <div className="mm-title">分享说明</div>
        <div className="mm-sub">对方不需要安装 PromptPair，也能看图、复制提示词</div>
      </div>
      <div className="mini-modal-body">
        <div className="set-help">
          <b>分享包 .promptpack（可导回）</b>
          <ol>
            <li>导出后发给对方；对方把后缀改成 .zip，或用 7-Zip 解压。</li>
            <li>双击解压出来的 index.html，用浏览器打开。</li>
            <li>
              点卡片看大图/视频；卡片上有「复制提示词」，详情里可复制负向和全部参数。
            </li>
            <li>要导回软件：录入 → 导入分享包。</li>
          </ol>
        </div>

        <div className="set-help">
          <b>单页 HTML（最省事）</b>
          <ol>
            <li>导出后是一个 .html 文件，不用解压，双击就能看。</li>
            <li>默认嵌缩略图，文件小；选「含原图」会大很多，视频只放封面。</li>
            <li>页面离线可用，卡片上直接复制提示词；不能导回软件。</li>
          </ol>
        </div>

        <div className="set-help">
          <b>怎么选</b>
          <ul>
            <li>要保留原图/视频、以后还能导回：用 .promptpack。</li>
            <li>只想把提示词和图发给别人看：用单页 HTML（缩略图）。</li>
            <li>需要对方看到原图细节：用单页 HTML（含原图）。</li>
          </ul>
        </div>
      </div>
    </Modal>
  )
}
