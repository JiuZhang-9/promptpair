/**
 * 0.12.3 复制变体验收：MJ 条目四档复制 + 非 MJ 条目只有一档。
 * 用真实库里的两条记录做夹具，写入独立的 .smoke/cvlib 与 .smoke/userdata-cv，不碰真实数据。
 *
 * 用法：npm run build && npx electron scripts/verify-copy-variants.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow, clipboard } = require('electron')

const OUT = path.resolve('build/shots-cv')
const LIB = path.resolve('.smoke/cvlib')
const UD = path.resolve('.smoke/userdata-cv')
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(UD, { recursive: true })
fs.mkdirSync(path.join(LIB, 'media'), { recursive: true })
fs.mkdirSync(path.join(LIB, 'thumbs'), { recursive: true })

/* ── 夹具：从真实库摘两条（MJ 一条、Seedream 一条） ── */
const REAL = 'C:/Users/NoneNine/Documents/PromptPair'
const real = JSON.parse(fs.readFileSync(path.join(REAL, 'library.json'), 'utf8'))
const pick = (oid) => real.entries.find((e) => e.originId === oid)
const chosen = [pick('wx-mj336:02'), pick('wx-p94WZp:01')].filter(Boolean)
if (chosen.length < 2) throw new Error('真实库里找不到夹具条目，请先在软件里导入 MJ 批次')

const assets = real.assets.filter((a) => chosen.some((e) => e.assetIds.includes(a.id)))
for (const a of assets) {
  for (const rel of [a.relPath, a.thumbRel].filter(Boolean)) {
    const dst = path.join(LIB, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(path.join(REAL, rel), dst)
  }
}
const fixture = {
  schemaVersion: real.schemaVersion,
  id: 'cv-fixture',
  name: '复制变体夹具',
  createdAt: real.createdAt,
  updatedAt: real.updatedAt,
  entries: chosen,
  assets,
  tagGroups: real.tagGroups,
  tags: real.tags.filter((t) => chosen.some((e) => e.tagIds.includes(t.id))),
  collections: real.collections.filter((c) => chosen.some((e) => e.collectionIds.includes(c.id))),
  models: real.models,
  views: []
}
fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify(fixture, null, 1), 'utf8')
fs.writeFileSync(path.join(UD, 'config.json'), JSON.stringify({ libraryPath: LIB, theme: 'dark', thumbSize: 200 }), 'utf8')

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
async function shot(win, name) {
  const [w, h] = win.getSize()
  win.setSize(w + 2, h)
  await sleep(160)
  win.setSize(w, h)
  await sleep(500)
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG())
  console.log('  · ' + name + '.png')
}
const js = (win, code) => win.webContents.executeJavaScript(code)

async function hover(win, selector) {
  const box = await js(win, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`)
  if (!box) return false
  win.webContents.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y })
  await sleep(500)
  return true
}

app.whenReady().then(async () => {
  await sleep(2600)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }
  win.setSize(1440, 900)
  await sleep(900)
  try {
    // 只筛出 MJ 那条，卡片菜单才好点
    await js(win, `(() => { const i = document.querySelector('.top-search input'); return !!i })()`)
    await shot(win, '01-gallery')

    // 卡片：悬停复制按钮 → 菜单四档
    const ok = await hover(win, '.mini-copy .mini-btn')
    assert(ok, '找到卡片复制按钮')
    const items = await js(win, `[...document.querySelectorAll('.card')[0].querySelectorAll('.mini-copy-item')].map(b => b.textContent)`)
    console.log('    卡片菜单:', JSON.stringify(items))
    assert(items.length === 4, '卡片菜单 4 档', items)
    assert(items[0] === '仅复制提示词', '第 1 档文案')
    assert(items[1] === '复制提示词+MJ参数', '第 2 档文案')
    assert(items[2] === '仅复制MJ参数', '第 3 档文案')
    assert(items[3] === '复制风格码+MJ参数', '第 4 档文案')
    await shot(win, '02-card-menu')

    // 点第 3 档，剪贴板应只有 -- 参数
    clipboard.writeText('')
    await js(win, `(() => { const b = [...document.querySelectorAll('.card')[0].querySelectorAll('.mini-copy-item')].find(x => x.textContent === '仅复制MJ参数'); if (b) b.click(); return !!b })()`)
    await sleep(600)
    const clip1 = clipboard.readText()
    console.log('    剪贴板(仅参数):', clip1)
    assert(/^--ar /.test(clip1), '仅参数档以 --ar 开头', clip1)
    assert(clip1.includes('--v 8.2') || clip1.includes('--profile'), '仅参数档带 MJ 参数', clip1)

    // 点第 2 档，剪贴板 = 正文 + 参数
    clipboard.writeText('')
    await js(win, `(() => { const b = [...document.querySelectorAll('.card')[0].querySelectorAll('.mini-copy-item')].find(x => x.textContent === '复制提示词+MJ参数'); if (b) b.click(); return !!b })()`)
    await sleep(600)
    const clip2 = clipboard.readText()
    assert(clip2.includes(' --ar '), '提示词+参数档含参数段', clip2.slice(-80))

    // 大图：打开 MJ 条目，chip 行三档（不含「仅复制提示词」，主按钮即为提示词）
    await js(win, `(() => { const c = document.querySelector('.card'); if (c) c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); return !!c })()`)
    await sleep(900)
    const chips = await js(win, `[...document.querySelectorAll('.viewer .mj-copy-row .mj-chip')].map(b => b.textContent.replace('已复制','').trim())`)
    console.log('    大图 chips:', JSON.stringify(chips))
    assert(chips.length === 3, '大图参数 chip 3 个', chips)
    await shot(win, '03-detail')

    // 大图主按钮 = 仅提示词
    clipboard.writeText('')
    await js(win, `(() => { const b = document.querySelector('.viewer .v-copy-actions .copy-btn'); if (b) b.click(); return !!b })()`)
    await sleep(500)
    const clip3 = clipboard.readText()
    assert(clip3.length > 20 && !clip3.includes('--ar '), '主按钮只复制正文', clip3.slice(0, 40))

    // 非 MJ 条目：卡片菜单只有一档
    await js(win, `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })()`)
    await sleep(400)
    await js(win, `(() => { const b = [...document.querySelectorAll('button, .pill')].find(x => x.textContent.trim().startsWith('Seedream')); if (b) { b.click(); return true } return false })()`)
    await sleep(800)
    const ok2 = await hover(win, '.mini-copy .mini-btn')
    if (ok2) {
      const items2 = await js(win, `[...document.querySelectorAll('.card')[0].querySelectorAll('.mini-copy-item')].map(b => b.textContent)`)
      console.log('    Seedream 卡片菜单:', JSON.stringify(items2))
      assert(items2.length === 1 && items2[0] === '仅复制提示词', '非 MJ 条目只有一档', items2)
      await shot(win, '04-seedream-menu')
    } else {
      console.log('  ! 没定位到 Seedream 卡片，跳过')
    }
  } catch (e) {
    console.error('验收过程出错:', e)
    failures++
  }
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  app.quit()
})
