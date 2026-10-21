import React, { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon, Modal, Toggle } from './ui'

function Row({
  label,
  desc,
  children
}: {
  label: string
  desc?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="set-row">
      <div className="set-label">
        <div>{label}</div>
        {desc && <small>{desc}</small>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  )
}

export default function SettingsPanel(): React.ReactElement {
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen)
  const config = useStore((s) => s.config)
  const applyConfig = useStore((s) => s.applyConfig)
  const root = useStore((s) => s.root)
  const version = useStore((s) => s.version)
  const update = useStore((s) => s.update)
  const capturePort = useStore((s) => s.capturePort)
  const refresh = useStore((s) => s.refresh)
  const toast = useStore((s) => s.toast)

  const [info, setInfo] = useState<{ electron: string; chrome: string; node: string; userData: string } | null>(
    null
  )
  const [capTest, setCapTest] = useState<string>('')
  const [aiDraft, setAiDraft] = useState({
    baseUrl: config.aiBaseUrl,
    apiKey: config.aiApiKey,
    model: config.aiModel
  })
  const [aiTestMsg, setAiTestMsg] = useState('')
  const [aiTesting, setAiTesting] = useState(false)

  useEffect(() => {
    setAiDraft({ baseUrl: config.aiBaseUrl, apiKey: config.aiApiKey, model: config.aiModel })
  }, [config.aiBaseUrl, config.aiApiKey, config.aiModel])

  useEffect(() => {
    if (panel !== 'settings') return
    void window.pp.info().then((i) => setInfo(i as typeof info))
  }, [panel])

  const switchLibrary = async (): Promise<void> => {
    const dir = await window.pp.chooseLibraryRoot()
    if (!dir) return
    if (
      !window.confirm(
        `切换到库：\n${dir}\n\n当前库不会被删除，随时可以切回来。继续吗？`
      )
    )
      return
    const snap = await window.pp.switchLibrary(dir)
    await refresh(snap)
    toast('已切换素材库', 'ok')
  }

  return (
    <Modal
      open={panel === 'settings'}
      onClose={() => setPanel('none')}
      width={780}
      className="settings-modal"
      label="设置"
    >
      <div className="detail-head">
        <div className="dh-text">
          <div className="dh-title">设置</div>
          <div className="dh-sub">v{version}</div>
        </div>
        <button type="button" className="icon-btn" onClick={() => setPanel('none')} title="关闭">
          <Icon name="close" size={15} strokeWidth={2.2} />
        </button>
      </div>

      <div className="detail-scroll settings">
        <div className="set-group">
          <div className="set-group-title">素材库</div>
          <Row label="库位置" desc={root}>
            <button type="button" className="btn small" onClick={() => void switchLibrary()}>
              更换
            </button>
          </Row>
          <Row label="打开库文件夹">
            <button type="button" className="btn small" onClick={() => void window.pp.revealLibrary()}>
              <Icon name="folder" size={12} /> 打开
            </button>
          </Row>
          <Row label="修复缩略图" desc="给老资源补齐缩略图与感知哈希">
            <button
              type="button"
              className="btn small"
              onClick={async () => {
                const r = await window.pp.repairAssets()
                await refresh()
                toast(`已修复 ${r.fixed} 个资源`, 'ok')
              }}
            >
              <Icon name="refresh" size={12} /> 执行
            </button>
          </Row>
        </div>

        <div className="set-group">
          <div className="set-group-title">外观</div>
          <Row label="主题">
            <div className="seg">
              {(
                [
                  ['system', '跟随系统'],
                  ['dark', '深色'],
                  ['light', '浅色']
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={'seg-btn' + (config.theme === v ? ' on' : '')}
                  onClick={() => void applyConfig({ theme: v })}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="默认缩略图大小" desc={`${config.thumbSize}px`}>
            <input
              type="range"
              min={120}
              max={380}
              step={20}
              value={config.thumbSize}
              onChange={(e) => void applyConfig({ thumbSize: Number(e.target.value) })}
            />
          </Row>
        </div>

        <div className="set-group">
          <div className="set-group-title">导入规则</div>
          <Row label="按文件夹名自动打标签" desc="父文件夹名命中已有标签会自动打上">
            <Toggle
              label=""
              checked={config.autoTagFromFolder}
              onChange={(v) => void applyConfig({ autoTagFromFolder: v })}
            />
          </Row>
          <Row label="允许自动创建标签" desc="文件夹名里没见过的词自动建成新标签">
            <Toggle
              label=""
              checked={config.autoCreateTags}
              onChange={(v) => void applyConfig({ autoCreateTags: v })}
            />
          </Row>
          <Row label="读取同名提示词文件" desc="支持 .txt 旁车、PNG 内嵌参数、ComfyUI .json">
            <Toggle
              label=""
              checked={config.autoReadSidecar}
              onChange={(v) => void applyConfig({ autoReadSidecar: v })}
            />
          </Row>
          <Row label="连号文件合并" desc="xxx_1 xxx_2 → 合并成一条一对多记录">
            <Toggle
              label=""
              checked={config.autoGroupByStem}
              onChange={(v) => void applyConfig({ autoGroupByStem: v })}
            />
          </Row>
        </div>

        <div className="set-group">
          <div className="set-group-title">重复检测</div>
          <Row label="相似判定阈值" desc="0 最严格（几乎完全一致），16 很宽松">
            <div className="thr">
              <input
                type="range"
                min={0}
                max={16}
                value={config.duplicateThreshold}
                onChange={(e) => void applyConfig({ duplicateThreshold: Number(e.target.value) })}
              />
              <b>{config.duplicateThreshold}</b>
            </div>
          </Row>
        </div>

        <div className="set-group">
          <div className="set-group-title">浏览器插件采集</div>
          <Row label="接收端口" desc={capturePort ? `127.0.0.1:${capturePort} 监听中` : '未启动'}>
            <button
              type="button"
              className="btn small"
              onClick={async () => {
                const r = await window.pp.captureTest()
                setCapTest(r.ok ? `连接正常（端口 ${r.port}）` : `连接失败：${r.message ?? '未知'}`)
              }}
            >
              测试连接
            </button>
          </Row>
          {capTest && <div className="set-note">{capTest}</div>}
          <Row label="插件目录">
            <button
              type="button"
              className="btn small"
              onClick={async () => {
                const r = await window.pp.openExtensionFolder()
                if (!r.ok) toast(r.message ?? '找不到插件目录', 'err')
              }}
            >
              <Icon name="folder" size={12} /> 打开
            </button>
          </Row>
          <div className="set-help">
            <b>怎么装：</b>
            <ol>
              <li>点上面的「打开」，记下文件夹路径</li>
              <li>
                浏览器地址栏输入 <code>chrome://extensions</code> （Edge 用{' '}
                <code>edge://extensions</code>）
              </li>
              <li>右上角打开「开发者模式」</li>
              <li>点「加载已解压的扩展程序」，选中刚才那个文件夹</li>
              <li>在任意网页选中提示词文字 → 右键「用 PromptPair 采集」</li>
            </ol>
          </div>
        </div>

        <div className="set-group">
          <div className="set-group-title">AI 打标（可选）</div>
          <Row label="启用" desc="不填 Key 时功能整体隐藏；Key 只保存在本机配置里">
            <Toggle
              label=""
              checked={config.aiEnabled}
              onChange={(v) => void applyConfig({ aiEnabled: v })}
            />
          </Row>
          {config.aiEnabled && (
            <>
              <Row label="接口地址" desc="OpenAI 兼容，通常以 /v1 结尾">
                <input
                  className="set-input"
                  value={aiDraft.baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChange={(e) => setAiDraft((d) => ({ ...d, baseUrl: e.target.value }))}
                  onBlur={() => void applyConfig({ aiBaseUrl: aiDraft.baseUrl.trim() })}
                />
              </Row>
              <Row label="API Key" desc="明文保存在本机 config.json，不进入素材库">
                <input
                  className="set-input"
                  type="password"
                  value={aiDraft.apiKey}
                  placeholder="sk-…"
                  onChange={(e) => setAiDraft((d) => ({ ...d, apiKey: e.target.value }))}
                  onBlur={() => void applyConfig({ aiApiKey: aiDraft.apiKey.trim() })}
                />
              </Row>
              <Row label="模型" desc="需要支持图片输入（多模态）">
                <input
                  className="set-input"
                  value={aiDraft.model}
                  placeholder="gpt-4o-mini"
                  onChange={(e) => setAiDraft((d) => ({ ...d, model: e.target.value }))}
                  onBlur={() => void applyConfig({ aiModel: aiDraft.model.trim() })}
                />
              </Row>
              <Row label="连接测试" desc={aiTestMsg}>
                <button
                  type="button"
                  className="btn small"
                  disabled={aiTesting}
                  onClick={async () => {
                    setAiTesting(true)
                    setAiTestMsg('')
                    try {
                      await applyConfig({
                        aiBaseUrl: aiDraft.baseUrl.trim(),
                        aiApiKey: aiDraft.apiKey.trim(),
                        aiModel: aiDraft.model.trim()
                      })
                      const r = await window.pp.aiTest()
                      setAiTestMsg(r.message)
                    } catch (e) {
                      setAiTestMsg(
                        (e as Error).message.replace(
                          /^Error invoking remote method '[^']+':\s*(Error:\s*)?/,
                          ''
                        )
                      )
                    } finally {
                      setAiTesting(false)
                    }
                  }}
                >
                  <Icon name="refresh" size={12} />
                  {aiTesting ? '测试中…' : '测试连接'}
                </button>
              </Row>
              <div className="set-help">
                <b>说明：</b>
                <ul>
                  <li>选中记录后，在底部批量栏点「AI 打标」；候选确认后才写入。</li>
                  <li>Key 以明文保存在本机，不会随素材库或分享包分发。</li>
                </ul>
              </div>
            </>
          )}
        </div>

        <div className="set-group">
          <div className="set-group-title">数据</div>
          <Row label="导出全部数据 JSON" desc="纯数据备份，方便迁移">
            <button
              type="button"
              className="btn small"
              onClick={async () => {
                const p = await window.pp.exportJson()
                if (p) toast('已导出', 'ok')
              }}
            >
              导出
            </button>
          </Row>
          <Row label="导出提示词清单 CSV" desc="Excel 可直接打开">
            <button
              type="button"
              className="btn small"
              onClick={async () => {
                const p = await window.pp.exportCsv()
                if (p) toast('已导出', 'ok')
              }}
            >
              导出
            </button>
          </Row>
          <Row label="标签管理" desc="批量重命名、合并、清理近似重复">
            <button type="button" className="btn small" onClick={() => setPanel('tags')}>
              <Icon name="tag" size={12} /> 打开
            </button>
          </Row>
        </div>

        <div className="set-group">
          <div className="set-group-title">帮助</div>
          <Row label="键盘快捷键" desc="J/K 移动焦点，Space 选中，1–5 评分，? 查看全部">
            <button type="button" className="btn small" onClick={() => setShortcutsOpen(true)}>
              查看
            </button>
          </Row>
        </div>

        <div className="set-group">
          <div className="set-group-title">更新</div>
          <Row
            label="当前版本"
            desc={update.message || (update.state === 'idle' ? '启动后会自动检查' : '')}
          >
            <button
              type="button"
              className="btn small"
              disabled={update.state === 'checking'}
              onClick={() => void useStore.getState().checkUpdate()}
            >
              <Icon name="refresh" size={12} />
              {update.state === 'checking' ? '检查中…' : '检查更新'}
            </button>
          </Row>
          {update.state === 'downloaded' && (
            <Row label={`新版本 ${update.version} 已就绪`} desc="重启完成安装，素材库不受影响">
              <button type="button" className="btn small accent" onClick={() => void window.pp.installUpdate()}>
                立即重启
              </button>
            </Row>
          )}
        </div>

        <div className="set-group">
          <div className="set-group-title">关于</div>
          <div className="about">
            <div className="about-name">PromptPair</div>
            <div className="about-desc">
              把提示词和它的产物配成一对，本地管理、打标分类、打包分享。
            </div>
            <div className="about-kv">
              <span>版本</span>
              <b>{version}</b>
              <span>Electron</span>
              <b>{info?.electron ?? '—'}</b>
              <span>Chromium</span>
              <b>{info?.chrome ?? '—'}</b>
              <span>数据目录</span>
              <b className="mono">{info?.userData ?? '—'}</b>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
