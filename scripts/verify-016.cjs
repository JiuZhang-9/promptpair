/**
 * 0.16.0 验收：
 *   A/B 对比（滑杆 / 并排 / 闪烁 / 左右-上下）、同记录多图、同 prompt 跨记录、
 *   批量对比、卡片右键对比、导出 GIF、导出带提示词 PNG、压缩另存 JPG。
 *
 * 用法：node scripts/demo-seed.mjs && npm run build && npx electron scripts/verify-016.cjs
 * 只改 .smoke/lib（演示库），不碰真实素材库。
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const OUT = path.resolve('build/shots-016')
const LIB = path.resolve('.smoke/lib/library.json')
const UD = path.resolve('.smoke/userdata')
const PAIR_ID = 'test016pair000001'
const SIB_A_ID = 'test016sibA0000002'
const SIB_B_ID = 'test016sibB0000003'
const GIF_PATH = path.join(OUT, '016-compare.gif')
const PNG_PATH = path.join(OUT, '016-with-prompt.png')
const JPG_PATH = path.join(OUT, '016-compressed.jpg')
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(UD, { recursive: true })

if (!fs.existsSync(LIB)) {
  console.error('✗ 找不到 .smoke/lib，请先运行：node scripts/demo-seed.mjs')
  process.exit(1)
}
const lib = JSON.parse(fs.readFileSync(LIB, 'utf8'))
const base3 = lib.entries.find((e) => e.assetIds.length >= 3)
const base2 = lib.entries.find((e) => e.assetIds.length >= 2 && e.id !== base3?.id)
if (!base3 || !base2) {
  console.error('✗ 演示库条目不足，请重新运行：node scripts/demo-seed.mjs')
  process.exit(1)
}
const now = Date.now()
const iso = (n) => new Date(now - n).toISOString()
const clone = (e) => JSON.parse(JSON.stringify(e))
const SAME_PROMPT =
  'a quiet comparison subject, soft studio light, neutral background, sharp details, realistic materials, same composition and framing'

const pair = {
  ...clone(base3),
  id: PAIR_ID,
  originId: 'test016:pair',
  title: '0.16 测试 · 原图 ↔ 成图',
  positive: 'original and generated pair for slider comparison, cinematic window light, same composition',
  note: '第一张当 A，第二张当 B。',
  task: 't2i',
  rating: 4,
  favorite: true,
  assetIds: [...base3.assetIds.slice(0, 2)],
  params: { model: 'Midjourney' },
  createdAt: iso(0),
  updatedAt: iso(0)
}
const sibA = {
  ...clone(base2),
  id: SIB_A_ID,
  originId: 'test016:sibA',
  title: '同 prompt 对比 · Midjourney',
  positive: SAME_PROMPT,
  note: 'A 模型。',
  task: 't2i',
  rating: 4,
  favorite: false,
  assetIds: [base2.assetIds[0]],
  params: { model: 'Midjourney' },
  createdAt: iso(1000),
  updatedAt: iso(1000)
}
const sibB = {
  ...clone(base2),
  id: SIB_B_ID,
  originId: 'test016:sibB',
  title: '同 prompt 对比 · Seedream',
  positive: SAME_PROMPT,
  note: 'B 模型。',
  task: 't2i',
  rating: 3,
  favorite: false,
  assetIds: [base2.assetIds[1]],
  params: { model: 'Seedream' },
  createdAt: iso(2000),
  updatedAt: iso(2000)
}
lib.entries = [
  pair,
  sibA,
  sibB,
  ...lib.entries.filter((e) => ![PAIR_ID, SIB_A_ID, SIB_B_ID].includes(e.id))
]
fs.writeFileSync(LIB, JSON.stringify(lib, null, 2))
console.log('夹具：', { pair: PAIR_ID, sibA: SIB_A_ID, sibB: SIB_B_ID })

app.setPath('userData', UD)
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2 && !message.includes('Security Warning')) {
      console.log(`[renderer] ${message} (${String(source).split('/').pop()}:${line})`)
      rendererErrors.push(message)
    }
  })
  w.webContents.on('render-process-gone', (_e, d) => console.log('[gone]', JSON.stringify(d)))
})
require('../out/main/index.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const rendererErrors = []
function assert(cond, label, extra) {
  if (cond) console.log('  ✓ ' + label)
  else {
    console.log('  ✗ ' + label + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''))
    failures++
  }
}
const js = (win, code) => win.webContents.executeJavaScript(code)
async function shot(win, name, jiggle = true) {
  if (jiggle) {
    const [w, h] = win.getSize()
    win.setSize(w + 2, h)
    await sleep(150)
    win.setSize(w, h)
    await sleep(430)
  } else {
    await sleep(300)
  }
  const buf = (await win.webContents.capturePage()).toPNG()
  fs.writeFileSync(path.join(OUT, name + '.png'), buf)
  console.log('  ✓ ' + name + '.png  ' + (buf.length / 1024).toFixed(0) + ' KB')
}
const state = (win) => js(win, `window.pp.getState()`)

app.whenReady().then(async () => {
  await sleep(2400)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }
  win.setSize(1440, 860)
  try {
    win.webContents.setBackgroundThrottling(false)
  } catch {
    /* ignore */
  }
  win.setAlwaysOnTop(true)
  win.show()
  win.focus()
  await sleep(900)

  try {
    const snap = await state(win)
    const pairEntry = snap.data.entries.find((e) => e.id === PAIR_ID)
    const sibAEntry = snap.data.entries.find((e) => e.id === SIB_A_ID)
    const sibBEntry = snap.data.entries.find((e) => e.id === SIB_B_ID)
    const a1 = pairEntry.assetIds[0]
    const a2 = pairEntry.assetIds[1]
    const s1 = sibAEntry.assetIds[0]
    const s2 = sibBEntry.assetIds[0]
    assert(!!a1 && !!a2 && !!s1 && !!s2, '夹具资产齐全', { a1, a2, s1, s2 })
    const originalBytes = snap.data.assets.find((a) => a.id === a1)?.bytes || 0

    console.log('\n→ 查看器：同记录多图对比…')
    await js(win, `document.querySelector('.card[data-id="${PAIR_ID}"]')?.click()`)
    await sleep(700)
    const viewerBtn = await js(
      win,
      `!!document.querySelector('.v-actions [title="对比本条的多张产物"]')`
    )
    assert(viewerBtn, '查看器出现「对比本条的多张产物」按钮')
    await js(win, `document.querySelector('.v-actions [title="对比本条的多张产物"]')?.click()`)
    await sleep(700)
    const cmp = await js(
      win,
      `(() => ({
        open: !!document.querySelector('.cmp'),
        mode: document.querySelector('.cmp')?.getAttribute('data-mode'),
        split: Number(document.querySelector('.cmp')?.getAttribute('data-split')),
        a: !!document.querySelector('.cmp-layer.a img'),
        b: !!document.querySelector('.cmp-layer.b img'),
        badgeA: document.querySelector('.cmp-badge.left')?.textContent || '',
        badgeB: document.querySelector('.cmp-badge.right')?.textContent || ''
      }))()`
    )
    assert(cmp.open && cmp.mode === 'slider' && cmp.a && cmp.b, '打开滑杆对比', cmp)
    assert(cmp.badgeA.includes('产物 1') && cmp.badgeB.includes('产物 2'), 'A/B 默认第 1/2 张', cmp)
    await shot(win, '01-compare-slider')

    const dragged = await js(
      win,
      `new Promise((resolve) => {
        const s = document.querySelector('.cmp-stage')
        const r = s.getBoundingClientRect()
        const x = r.left + r.width * 0.28
        const y = r.top + r.height / 2
        s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 3 }))
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 3 }))
        setTimeout(() => resolve(Number(document.querySelector('.cmp').getAttribute('data-split'))), 140)
      })`
    )
    assert(dragged > 20 && dragged < 40, '拖动中线改变分割位置', dragged)
    await js(win, `document.querySelector('[data-cmp-mode="side"]')?.click()`)
    await sleep(300)
    assert(await js(win, `document.querySelectorAll('.cmp-side .cmp-pane').length === 2`), '并排模式两栏')
    await shot(win, '02-compare-side', false)
    await js(win, `document.querySelector('[data-cmp-mode="blink"]')?.click()`)
    await sleep(300)
    const blink = await js(
      win,
      `(() => ({
        open: !!document.querySelector('.cmp-blink'),
        img: !!document.querySelector('.cmp-blink img'),
        label: document.querySelector('.cmp-badge')?.textContent || ''
      }))()`
    )
    assert(blink.open && blink.img && blink.label.includes('A'), '闪烁模式显示 A 帧', blink)
    await shot(win, '03-compare-blink', false)
    await js(win, `document.querySelector('[data-cmp-mode="slider"]')?.click()`)
    await sleep(250)
    await js(win, `document.querySelector('[data-cmp-action="orient"]')?.click()`)
    await sleep(250)
    const horiz = await js(
      win,
      `(() => ({
        h: document.querySelector('.cmp-stage')?.classList.contains('h'),
        divider: document.querySelector('.cmp-divider')?.classList.contains('h'),
        label: [...document.querySelectorAll('.cmp-top .cmp-btn')].map(x => x.textContent.trim()).find(x => x === '上下' || x === '左右')
      }))()`
    )
    assert(horiz.h && horiz.divider && horiz.label === '上下', '切换成上下分割', horiz)
    await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(300)
    assert(await js(win, `!document.querySelector('.cmp') && !document.querySelector('.viewer')`), 'Esc 关闭对比')

    console.log('\n→ 同 prompt 跨记录对比…')
    await js(win, `document.querySelector('.card[data-id="${SIB_A_ID}"]')?.click()`)
    await sleep(650)
    const sibBtn = await js(
      win,
      `!!document.querySelector('.v-actions [title^="同 prompt 对比"]')`
    )
    assert(sibBtn, '查看器出现同 prompt 对比按钮')
    await js(win, `document.querySelector('.v-actions [title^="同 prompt 对比"]')?.click()`)
    await sleep(650)
    const sibCmp = await js(
      win,
      `(() => ({
        open: !!document.querySelector('.cmp'),
        match: document.querySelector('.cmp-match')?.textContent?.trim(),
        cls: document.querySelector('.cmp-match')?.className,
        selects: document.querySelectorAll('.cmp-foot select').length
      }))()`
    )
    assert(sibCmp.open && sibCmp.match === '同一提示词', '同 prompt 跨记录对比', sibCmp)
    assert(sibCmp.selects === 2, '底部 A/B 选择器', sibCmp.selects)
    await shot(win, '04-cross-model', false)
    await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(300)

    console.log('\n→ 批量对比…')
    await js(
      win,
      `(() => {
        const a = document.querySelector('.card[data-id="${SIB_A_ID}"]')
        const b = document.querySelector('.card[data-id="${SIB_B_ID}"]')
        a?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
        b?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
        return true
      })()`
    )
    await sleep(400)
    assert(await js(win, `!!document.querySelector('[data-batch-compare]')`), '选中两条出现批量对比按钮')
    await js(win, `document.querySelector('[data-batch-compare]')?.click()`)
    await sleep(650)
    assert(
      await js(win, `!!document.querySelector('.cmp') && document.querySelector('.cmp-match')?.textContent?.trim() === '同一提示词'`),
      '批量对比打开同 prompt 两条记录'
    )
    await js(win, `document.querySelector('[data-cmp-action="swap"]')?.click()`)
    await sleep(200)
    assert(await js(win, `!!document.querySelector('.cmp')`), '交换 A/B 后仍在对比')
    await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(300)

    console.log('\n→ 卡片右键对比…')
    await js(
      win,
      `(() => {
        const c = document.querySelector('.card[data-id="${PAIR_ID}"]')
        c?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 360, clientY: 260 }))
        return true
      })()`
    )
    await sleep(300)
    assert(await js(win, `!!document.querySelector('[data-ctx-compare]')`), '卡片菜单有对比多张产物')
    await js(win, `document.querySelector('[data-ctx-compare]')?.click()`)
    await sleep(650)
    assert(await js(win, `!!document.querySelector('.cmp')`), '卡片菜单打开对比')
    await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(300)

    console.log('\n→ 图片工具：GIF / 带提示词 PNG / 压缩 JPG…')
    const gif = await js(
      win,
      `window.pp.exportCompareGif(${JSON.stringify(a1)}, ${JSON.stringify(a2)}, 'test-compare', ${JSON.stringify(GIF_PATH)})`
    )
    const gifBuf = fs.readFileSync(GIF_PATH)
    assert(gif && gif.frames === 2 && gifBuf.length > 1000, '导出两帧 GIF', { gif, bytes: gifBuf.length })
    assert(gifBuf.subarray(0, 3).toString('ascii') === 'GIF', 'GIF 文件头正确', gifBuf.subarray(0, 6).toString('ascii'))

    const png = await js(
      win,
      `window.pp.exportAssetWithPrompt(${JSON.stringify(a1)}, 'PROMPT: comparison test prompt\\nPARAMS: --ar 1:1', 'test-prompt', ${JSON.stringify(PNG_PATH)})`
    )
    const pngBuf = fs.readFileSync(PNG_PATH)
    assert(png && pngBuf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', '导出 PNG', png)
    const txt = pngBuf.toString('utf8')
    assert(txt.includes('iTXt') && txt.includes('PROMPT: comparison test prompt'), 'PNG 写入提示词 iTXt', {
      size: pngBuf.length
    })

    const jpg = await js(
      win,
      `window.pp.exportCompressedAsset(${JSON.stringify(a1)}, 80, 'test-compressed', ${JSON.stringify(JPG_PATH)})`
    )
    const jpgBuf = fs.readFileSync(JPG_PATH)
    assert(jpg && jpgBuf[0] === 0xff && jpgBuf[1] === 0xd8, '压缩导出 JPG', jpg)
    assert(jpg.bytes < originalBytes, 'JPG 小于原图', { jpg: jpg.bytes, original: originalBytes })

    console.log('\n→ 查看器右键图片工具入口…')
    await js(win, `document.querySelector('.card[data-id="${PAIR_ID}"]')?.click()`)
    await sleep(650)
    await js(
      win,
      `document.querySelector('.v-stage')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400 }))`
    )
    await sleep(300)
    const menu = await js(
      win,
      `[...document.querySelectorAll('.ctx-menu .ctx-item')].map(x => x.textContent.trim())`
    )
    assert(menu.some((x) => x.includes('另存为图片')), '菜单有另存为图片', menu)
    assert(menu.some((x) => x.includes('带提示词')), '菜单有导出带提示词 PNG', menu)
    assert(menu.some((x) => x.includes('压缩另存')), '菜单有压缩另存 JPG', menu)
    await shot(win, '05-image-tools-menu', false)
    await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(250)

    assert(rendererErrors.length === 0, '渲染层无报错', rendererErrors)
  } catch (e) {
    console.error('验收过程出错:', e)
    failures++
  }

  console.log('\n' + (failures ? `✗ ${failures} 项失败` : '✓ 全部通过'))
  await sleep(300)
  app.exit(failures ? 1 : 0)
})
