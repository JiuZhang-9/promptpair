/**
 * 0.13.0 性能验收：1000 条记录 / 900 个标签的合成库，测评分延迟。
 * 关键回归：标签面板关闭时不再在后台跑 900×900 相似度（旧版单次约 500ms）。
 *
 * 用法：npm run build && npx electron scripts/verify-perf.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const ROOT = path.resolve('.smoke/perf')
const LIB = path.join(ROOT, 'lib')
const USERDATA = path.join(ROOT, 'userdata')
fs.rmSync(ROOT, { recursive: true, force: true })
fs.mkdirSync(LIB, { recursive: true })
fs.mkdirSync(USERDATA, { recursive: true })

const now = Date.now()
const iso = (n) => new Date(now - n * 1000).toISOString()
const tags = Array.from({ length: 900 }, (_, i) => ({
  id: `t${i}`,
  name: `标签${String(i).padStart(3, '0')}`,
  groupId: 'g1'
}))
const entries = Array.from({ length: 1000 }, (_, i) => {
  const tagIds = Array.from({ length: 5 }, (_, k) => tags[(i * 7 + k * 13) % tags.length].id)
  return {
    id: `e${i}`,
    title: `性能测试 ${i}`,
    positive: `performance test entry ${i}, cinematic lighting, detailed`,
    negative: '',
    note: '',
    rating: 0,
    favorite: false,
    collectionIds: [i % 2 ? 'c1' : 'c2'],
    tagIds,
    assetIds: [],
    params: {
      model: 'Midjourney',
      extra: {
        mjCodes: `--profile code${i}`,
        mjCodeparam: `--ar 1:1 --v 8.2 --profile code${i}`,
        mjCodeMode: 'solo',
        mjCodeCount: '1'
      }
    },
    source: { platform: 'Midjourney' },
    createdAt: iso(i * 60),
    updatedAt: iso(i * 60)
  }
})
fs.writeFileSync(
  path.join(LIB, 'library.json'),
  JSON.stringify(
    {
      schemaVersion: 2,
      id: 'perf',
      name: '性能库',
      createdAt: iso(0),
      updatedAt: iso(0),
      entries,
      assets: [],
      tagGroups: [{ id: 'g1', name: '题材', color: '#a1a1aa', order: 0 }],
      tags,
      collections: [
        { id: 'c1', name: '集合A', color: '#a1a1aa', createdAt: iso(0) },
        { id: 'c2', name: '集合B', color: '#71717a', createdAt: iso(0) }
      ],
      models: [],
      views: []
    },
    null,
    2
  ),
  'utf8'
)
fs.writeFileSync(
  path.join(USERDATA, 'config.json'),
  JSON.stringify({ libraryPath: LIB, theme: 'dark', thumbSize: 200 }, null, 2)
)

app.setPath('userData', USERDATA)
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

app.whenReady().then(async () => {
  await sleep(2600)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('没有窗口')
    app.quit()
    return
  }
  win.setSize(1440, 860)
  await sleep(800)

  console.log('\n→ 1000 条 / 900 标签')
  const loaded = await js(win, `({ cards: document.querySelectorAll('.card').length, count: document.querySelector('.count-chip')?.textContent })`)
  assert(loaded.cards > 0, '画廊渲染卡片', loaded)
  assert((loaded.count || '').includes('1000'), '1000 条记录在库', loaded.count)

  const measureStar = () =>
    js(
      win,
      `new Promise((resolve) => {
        const star = document.querySelector('.card .stars .star[data-star="5"]')
        const t0 = performance.now()
        star.click()
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)))
      })`
    )

  console.log('\n→ 评分（标签面板关闭）…')
  const ms1 = await measureStar()
  console.log(`    ${ms1.toFixed(1)} ms`)
  assert(ms1 < 120, '评分无明显卡顿（<120ms）', ms1)

  console.log('\n→ 打开标签面板…')
  const openMs = await js(
    win,
    `new Promise((resolve) => {
      const t0 = performance.now()
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, shiftKey: true, bubbles: true }))
      const tick = () => {
        if (document.querySelector('.tm-row')) resolve(performance.now() - t0)
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      setTimeout(() => resolve(-1), 5000)
    })`
  )
  console.log(`    标签面板打开：${openMs.toFixed(1)} ms`)
  assert(openMs > 0, '标签面板可打开', openMs)

  console.log('\n→ 评分（标签面板打开）…')
  const ms2 = await measureStar()
  console.log(`    ${ms2.toFixed(1)} ms`)
  assert(ms2 < 150, '标签面板打开时评分仍不卡（<150ms）', ms2)

  console.log('\n→ 风格码搜索…')
  const searchMs = await js(
    win,
    `new Promise((resolve) => {
      const input = document.querySelector('.search input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const t0 = performance.now()
      setter.call(input, 'code:code999')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        ms: performance.now() - t0,
        cards: document.querySelectorAll('.card').length
      })))
    })`
  )
  console.log(`    ${searchMs.ms.toFixed(1)} ms，结果 ${searchMs.cards} 条`)
  assert(searchMs.cards === 1, 'code: 精确命中 1 条', searchMs)
  assert(searchMs.ms < 150, '搜索无卡顿（<150ms）', searchMs.ms)

  console.log('\n' + (failures ? `✗ ${failures} 项失败` : '✅ 性能验收通过'))
  app.quit()
})
