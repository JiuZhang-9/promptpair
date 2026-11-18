/**
 * 0.13.1 分享包导入验收：
 *   - 进度浮层出现（解压 / 导入阶段）
 *   - 小包导入成功，纯提示词条目不再被跳过
 *   - 坏包显示应用内错误框，含日志路径，原库不被清空
 *
 * 用法：npm run build && npx electron scripts/verify-pack-import.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const zlib = require('node:zlib')
const { app, BrowserWindow } = require('electron')

const ROOT = path.resolve('.smoke/packimport')
const LIB = path.join(ROOT, 'lib')
const UD = path.join(ROOT, 'userdata')
const PACK = path.join(ROOT, 'test.promptpack')
fs.rmSync(ROOT, { recursive: true, force: true })
fs.mkdirSync(UD, { recursive: true })

// 用 zip.ts 的写包器造一个小包（stored，标准 ZIP）
const bundle = path.join(ROOT, 'zip.cjs')
require('esbuild').buildSync({
  entryPoints: ['src/main/zip.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
  logLevel: 'warning'
})
const { ZipWriter } = require(bundle)

// 1x1 PNG，只用于让 addFileToLibrary 有真实图片可处理
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const payload = {
  tagGroups: [{ name: '题材', color: '#a1a1aa', order: 0 }],
  tags: [{ name: '导入测试', group: '题材' }],
  collections: [{ name: '导入集合', color: '#a1a1aa' }],
  models: [],
  entries: [
    {
      originId: 'packimport-1',
      title: '带图条目',
      positive: 'with image',
      negative: '',
      note: '',
      tags: ['导入测试'],
      collections: ['导入集合'],
      params: {},
      source: {},
      assets: [{ rel: 'media/aa/pack-test.png', kind: 'image' }]
    },
    {
      originId: 'packimport-2',
      title: '纯提示词条目',
      positive: 'text only prompt',
      negative: '',
      note: '',
      tags: ['导入测试'],
      collections: ['导入集合'],
      params: {},
      source: {},
      assets: []
    }
  ]
}
const manifest = {
  magic: 'promptpair.pack',
  formatVersion: 2,
  packId: 'packimport-test',
  mode: 'full',
  appVersion: '0.13.1',
  exportedAt: new Date().toISOString(),
  counts: { entries: 2, assets: 1 },
  hasMedia: true,
  entry: 'data/prompts.json'
}
const z = new ZipWriter(PACK)
z.addBuffer('manifest.json', Buffer.from(JSON.stringify(manifest)))
z.addBuffer('data/prompts.json', Buffer.from(JSON.stringify(payload)))
z.addBuffer('media/aa/pack-test.png', PNG)
z.finish()

fs.writeFileSync(
  path.join(UD, 'config.json'),
  JSON.stringify({ libraryPath: LIB, theme: 'dark', thumbSize: 200 }, null, 2)
)
process.env.PP_PACK_IMPORT = PACK
process.env.PP_PACK_MODE = 'merge'

app.setPath('userData', UD)
require('../out/main/index.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function assert(cond, label, extra) {
  if (cond) console.log('  ✓ ' + label)
  else {
    console.log('  ✗ ' + label + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''))
    failures++
  }
}
const js = (win, code) => win.webContents.executeJavaScript(code)

async function triggerImport(win) {
  return js(
    win,
    `new Promise((resolve) => {
      const state = { overlay: false, error: false }
      const obs = new MutationObserver(() => {
        if (document.querySelector('[data-pack-import]')) state.overlay = true
        if (document.querySelector('.pack-error-box')) state.error = true
      })
      obs.observe(document.body, { childList: true, subtree: true })
      const trigger = [...document.querySelectorAll('.tb-actions .dd-trigger')].find(x => x.textContent.includes('录入'))
      if (trigger) trigger.click()
      setTimeout(() => {
        const item = [...document.querySelectorAll('.dd-item')].find(x => x.textContent.includes('导入分享包'))
        if (item) item.click()
      }, 100)
      setTimeout(() => { obs.disconnect(); resolve(state) }, 3500)
    })`
  )
}

app.whenReady().then(async () => {
  await sleep(2400)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('没有窗口')
    app.quit()
    return
  }
  win.setSize(1440, 900)
  await sleep(700)
  try {
    console.log('\n→ 正常包：进度 + 纯提示词条目')
    const state = await triggerImport(win)
    await sleep(1200)
    const lib = await js(win, `window.pp.getState().then(s => s.data)`)
    const titles = lib.entries.map((e) => e.title)
    console.log('  ', { overlay: state.overlay, entries: titles })
    assert(state.overlay, '导入时出现进度浮层')
    assert(lib.entries.length === 2, '两条记录都导入（含纯提示词）', titles)
    assert(titles.includes('纯提示词条目'), '纯提示词条目没有被跳过', titles)
    assert(lib.assets.length === 1, '媒体导入 1 个', lib.assets.length)
    assert(!state.error, '正常包不弹错误框')

    console.log('\n→ 坏包：错误框 + 日志路径 + 原库保留')
    fs.writeFileSync(PACK, Buffer.from('this is not a zip'))
    const bad = await triggerImport(win)
    await sleep(900)
    const err = await js(
      win,
      `(() => {
        const box = document.querySelector('.pack-error-box')
        const text = box?.querySelector('.pack-error-text')?.textContent || ''
        return { open: !!box, text, buttons: [...(box?.querySelectorAll('button') || [])].map(b => b.textContent.trim()) }
      })()`
    )
    const after = await js(win, `window.pp.getState().then(s => s.data.entries.length)`)
    fs.mkdirSync(path.resolve('build/shots-013'), { recursive: true })
    fs.writeFileSync(
      path.resolve('build/shots-013/pack-error.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    console.log('  ', { open: err.open, entriesAfterBad: after })
    assert(bad.error || err.open, '坏包弹出应用内错误框')
    assert(/日志：/.test(err.text), '错误框带日志路径', err.text.slice(0, 120))
    assert(err.buttons.some((x) => x.includes('打开日志文件夹')), '错误框有「打开日志文件夹」按钮', err.buttons)
    assert(after === 2, '坏包导入没有清空原库', after)
    assert(fs.existsSync(path.join(UD, 'logs', 'import-pack.log')), '失败日志已落盘')
    await js(win, `document.querySelector('.pack-error-actions .btn.primary')?.click()`)
    await sleep(200)
    assert(await js(win, `!document.querySelector('.pack-error-box')`), '错误框可关闭')

    console.log('\n→ 作为新库打开：成功后才切换')
    const z2 = new ZipWriter(PACK)
    z2.addBuffer('manifest.json', Buffer.from(JSON.stringify(manifest)))
    z2.addBuffer('data/prompts.json', Buffer.from(JSON.stringify(payload)))
    z2.addBuffer('media/aa/pack-test.png', PNG)
    z2.finish()
    process.env.PP_PACK_MODE = 'new'
    process.env.PP_PACK_TARGET = path.join(ROOT, 'newtarget')
    const opened = await triggerImport(win)
    await sleep(1200)
    const newState = await js(win, `window.pp.getState().then(s => ({ root: s.root, entries: s.data.entries.length, titles: s.data.entries.map(e => e.title) }))`)
    console.log('  ', { overlay: opened.overlay, root: newState.root, entries: newState.entries })
    assert(opened.overlay, '新库导入也显示进度浮层')
    assert(/newtarget[\\/]test$/.test(newState.root), '成功后切换到新库目录', newState.root)
    assert(newState.entries === 2, '新库包含完整两条记录', newState)
  } catch (e) {
    console.error('运行异常：', e)
    failures++
  }
  console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ 分享包导入验收通过')
  app.quit()
})
