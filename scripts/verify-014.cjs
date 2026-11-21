/**
 * 0.14.0 验收：
 *   全屏左图右参数编辑器、P 值 / MJ 参数、紧凑模型选择、集合只显示已选、
 *   实心星与点击回弹、收藏小按钮、查看器内联编辑、单击关闭、滚轮切换、
 *   Ctrl+滚轮缩放、中键平移、右键翻转 / 去色、保存为新产物。
 *
 * 用法：node scripts/demo-seed.mjs && npm run build && npx electron scripts/verify-014.cjs
 * 只改 .smoke/lib（演示库），不碰真实素材库。
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const OUT = path.resolve('build/shots-014')
const LIB = path.resolve('.smoke/lib/library.json')
const UD = path.resolve('.smoke/userdata')
const FIXTURE_ID = 'testmj0140000001'
const FIXTURE_ONE_ID = 'testmj0140000002'
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(UD, { recursive: true })

/* ── 夹具：克隆演示库里一条 3 图记录，补上 MJ 参数 / P 值 ── */
if (!fs.existsSync(LIB)) {
  console.error('✗ 找不到 .smoke/lib，请先运行：node scripts/demo-seed.mjs')
  process.exit(1)
}
const lib = JSON.parse(fs.readFileSync(LIB, 'utf8'))
const base = lib.entries.find((e) => e.assetIds.length >= 3 && e.params && e.params.model)
if (!base) {
  console.error('✗ 演示库里没有 3 图条目，请重新运行：node scripts/demo-seed.mjs')
  process.exit(1)
}
const now = new Date().toISOString()
const fixture = {
  ...JSON.parse(JSON.stringify(base)),
  id: FIXTURE_ID,
  originId: 'test-mj-014',
  title: '0.14 测试 · 冷调二次元插画·记忆碎片',
  positive:
    'anime style digital illustration of a young anime girl with long, dark blue hair featuring light blue undersides. she has striking bright blue eyes and a small mole beneath her left eye. she wears a dark blue japanese sailor uniform dress with cross stitch details on the cuffs and a blue necktie. she stands surrounded by hanging polaroid style photos attached to strings with wooden clothespins.',
  negative: '',
  note: '【解读】总有一段记忆，让你眼里有光。\n\n【中文译文】一幅动漫风格的数字插画，一位年轻动漫少女，深蓝色长发。她把一张照片举在脸前，照片上是一只发光的白蝴蝶停驻在蓝花上。',
  rating: 4,
  favorite: true,
  params: {
    model: 'Midjourney',
    extra: {
      aspect: '7:10',
      version: '8.2',
      profile: '8ks9epn p3mma3l',
      p: '60',
      raw: 'true',
      hd: 'true',
      mjCodeparam: '--ar 7:10 --raw --profile 8ks9epn p3mma3l --hd --v 8.2 --p 60',
      mjCodes: '--profile 8ks9epn p3mma3l'
    }
  },
  createdAt: now,
  updatedAt: now
}
const one = {
  ...JSON.parse(JSON.stringify(fixture)),
  id: FIXTURE_ONE_ID,
  originId: 'test-mj-014-one',
  title: '0.14 测试 · 单图记录',
  rating: 3,
  favorite: false,
  assetIds: [fixture.assetIds[0]],
  createdAt: new Date(Date.now() - 1000).toISOString(),
  updatedAt: new Date(Date.now() - 1000).toISOString()
}
lib.entries = [fixture, one, ...lib.entries.filter((e) => e.id !== FIXTURE_ID && e.id !== FIXTURE_ONE_ID)]
fs.writeFileSync(LIB, JSON.stringify(lib, null, 2))
console.log('夹具：', fixture.title, '资产', fixture.assetIds.length, '；单图夹具', one.assetIds.length)

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
    await sleep(160)
    win.setSize(w, h)
    await sleep(460)
  } else {
    await sleep(360)
  }
  const buf = (await win.webContents.capturePage()).toPNG()
  fs.writeFileSync(path.join(OUT, name + '.png'), buf)
  console.log('  ✓ ' + name + '.png  ' + (buf.length / 1024).toFixed(0) + ' KB')
}
async function setInput(win, selector, value) {
  await js(
    win,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return false
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`
  )
  await sleep(260)
}
const entryState = (win) =>
  js(win, `window.pp.getState().then(s => s.data.entries.find(e => e.id === ${JSON.stringify(FIXTURE_ID)}))`)
const libState = (win) => js(win, `window.pp.getState()`)

app.whenReady().then(async () => {
  await sleep(2400)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }
  win.setSize(1440, 860)
  await sleep(800)

  try {
    console.log('\n→ 卡片单击进入详情…')
    await js(win, `document.querySelector('.card')?.click()`)
    await sleep(450)
    assert(await js(win, `!!document.querySelector('.viewer')`), '单击卡片直接打开查看器')
    await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(320)
    assert(await js(win, `!document.querySelector('.viewer')`), 'Esc 关闭查看器')

    console.log('\n→ 编辑器布局…')
    await js(
      win,
      `(() => {
        const c = document.querySelector('.card')
        c?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }))
        return !!c
      })()`
    )
    await sleep(800)
    const layout = await js(
      win,
      `(() => {
        const st = document.querySelector('.es-stage')?.getBoundingClientRect()
        const side = document.querySelector('.es-side')?.getBoundingClientRect()
        const fav = document.querySelector('.es-basics .fav')
        const favIcon = document.querySelector('.es-basics .fav.on .ico')
        return {
          screen: !!document.querySelector('.es-screen'),
          st: st ? [st.left, st.width] : null,
          side: side ? [side.left, side.width] : null,
          favText: fav ? fav.textContent.trim() : null,
          favW: fav ? fav.getBoundingClientRect().width : null,
          favColor: favIcon ? getComputedStyle(favIcon).color : null,
          title: document.querySelector('.es-title')?.value
        }
      })()`
    )
    assert(layout.screen, '打开全屏编辑器')
    assert(layout.st && layout.side && layout.st[0] < layout.side[0], '图片在左、参数在右', layout)
    assert(layout.side && layout.side[1] >= 330 && layout.side[1] <= 440, '右栏是一根窄竖列', layout.side && layout.side[1])
    assert(layout.favText === '' && layout.favW <= 34, '收藏是 30px 小图标', layout)
    assert(layout.favColor === 'rgb(229, 72, 77)', '收藏是红心', layout.favColor)
    assert(layout.title && layout.title.includes('0.14 测试'), '标题载入', layout.title)
    await shot(win, '01-editor')

    console.log('\n→ P 值 / MJ 参数…')
    const pInfo = await js(
      win,
      `(() => {
        const p = document.querySelector('input[aria-label="P 值"]')
        const v = document.querySelector('input[aria-label="版本"]')
        return { p: p?.value, v: v?.value, raw: document.querySelector('.pe-raw')?.value }
      })()`
    )
    assert(pInfo.p === '60', 'P 值字段读到 60', pInfo.p)
    assert(pInfo.v === '8.2', '版本字段读到 8.2', pInfo.v)
    assert((pInfo.raw || '').includes('--p 60'), '整串包含 --p 60', pInfo.raw)
    await setInput(win, 'input[aria-label="P 值"]', '75')
    await setInput(win, 'input[aria-label="版本"]', '8.3')
    const pAfter = await js(
      win,
      `(() => ({
        p: document.querySelector('input[aria-label="P 值"]')?.value,
        v: document.querySelector('input[aria-label="版本"]')?.value,
        raw: document.querySelector('.pe-raw')?.value
      }))()`
    )
    assert(pAfter.p === '75' && pAfter.v === '8.3', '字段改动即时生效', pAfter)
    assert((pAfter.raw || '').includes('--p 75') && (pAfter.raw || '').includes('--v 8.3'), '整串自动重建', pAfter.raw)
    await shot(win, '02-params')

    console.log('\n→ 紧凑模型选择器…')
    await js(win, `document.querySelector('.mp-trigger')?.click()`)
    await sleep(320)
    const mp = await js(
      win,
      `(() => {
        const pop = document.querySelector('.mp-pop')
        const grid = document.querySelector('.mp-grid')
        return {
          open: !!pop,
          width: pop?.getBoundingClientRect().width,
          cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
          items: document.querySelectorAll('.mp-item').length
        }
      })()`
    )
    assert(mp.open, '模型弹层打开', mp)
    assert(mp.width <= 340 && mp.width >= 280, '弹层收窄到 320 左右', mp.width)
    assert(mp.cols === 2, '模型两列排布', mp.cols)
    assert(mp.items > 0, '模型候选存在', mp.items)
    await shot(win, '03-model-pop', false)
    await js(win, `document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
    await sleep(200)

    console.log('\n→ 集合只显示已选…')
    const collBefore = await js(
      win,
      `(() => {
        const chips = document.querySelector('.cp-chips')?.textContent || ''
        const add = document.querySelector('.cp-add')
        add?.scrollIntoView({ block: 'center' })
        return { chips, hasAdd: !!add }
      })()`
    )
    assert(collBefore.chips.includes('视觉实验'), '当前集合显示', collBefore.chips)
    assert(!collBefore.chips.includes('客户A'), '没有把所有集合铺出来', collBefore.chips)
    await sleep(250)
    await js(win, `document.querySelector('.cp-add')?.click()`)
    await sleep(320)
    const collPop = await js(
      win,
      `(() => ({
        open: !!document.querySelector('.cp-pop'),
        rows: [...document.querySelectorAll('.cp-row')].map(x => x.textContent.trim())
      }))()`
    )
    assert(collPop.open, '加入集合弹层打开', collPop)
    assert(collPop.rows.some((x) => x.includes('客户A')), '弹层里可以选其它集合', collPop.rows)
    await shot(win, '04-collections', false)
    await js(win, `document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
    await sleep(200)

    console.log('\n→ 实心星 + 点击回弹…')
    const starBefore = await js(
      win,
      `(() => {
        const s = document.querySelector('.es-rating .star[data-star="4"] .ico')
        return s ? { fill: getComputedStyle(s).fill, on: document.querySelectorAll('.es-rating .star.on').length } : null
      })()`
    )
    assert(starBefore && starBefore.fill !== 'none' && starBefore.fill !== 'rgba(0, 0, 0, 0)', '已选星是实心填充', starBefore)
    await js(win, `document.querySelector('.es-rating .star[data-star="5"]')?.click()`)
    // 等颜色过渡 + 回弹动画结束，避免读到中间色
    await sleep(460)
    const starAfter = await js(
      win,
      `(() => ({
        on: document.querySelectorAll('.es-rating .star.on').length,
        pop: document.querySelectorAll('.es-rating .star.pop').length,
        colors: [1,2,3,4,5].map(i => {
          const s = document.querySelector('.es-rating .star[data-star="' + i + '"] .ico')
          return s ? getComputedStyle(s).fill : null
        })
      }))()`
    )
    assert(starAfter.on === 5, '点第 5 颗后 5 颗实心', starAfter)
    assert(starAfter.pop > 0, '点击回弹动画触发', starAfter)
    assert(new Set(starAfter.colors).size === 5, '1–5 星冷暖各不相同', starAfter.colors)
    assert(starAfter.colors[4] === 'rgb(255, 213, 74)', '5 星是亮黄色', starAfter.colors[4])
    await shot(win, '05-stars')

    console.log('\n→ 保存记录…')
    await js(win, `document.querySelector('.es-top .btn.primary')?.click()`)
    await sleep(700)
    const closed = await js(win, `!document.querySelector('.es-screen')`)
    assert(closed, '保存后关闭编辑器')
    const saved = await entryState(win)
    assert(saved && saved.params && saved.params.extra && saved.params.extra.p === '75', 'P 值 75 已保存', saved && saved.params && saved.params.extra)
    assert(saved && saved.params.extra.version === '8.3', '版本 8.3 已保存', saved && saved.params.extra && saved.params.extra.version)
    assert(saved && saved.rating === 5, '评分 5 已保存', saved && saved.rating)

    console.log('\n→ 查看器内联编辑…')
    await js(win, `document.querySelector('.card')?.click()`)
    await sleep(800)
    const vOpen = await js(
      win,
      `(() => {
        const side = document.querySelector('.viewer-shell')?.getBoundingClientRect()
        return {
          viewer: !!document.querySelector('.viewer'),
          sideW: side ? side.width : null,
          p: document.querySelector('input[aria-label="P 值"]')?.value,
          v: document.querySelector('input[aria-label="版本"]')?.value
        }
      })()`
    )
    assert(vOpen.viewer, '单击卡片打开查看器', vOpen)
    assert(vOpen.p === '75' && vOpen.v === '8.3', '查看器读到最新参数', vOpen)
    const vSide = await js(win, `document.querySelector('.v-info')?.getBoundingClientRect().width`)
    assert(vSide && vSide <= 400, '查看器右栏不超过 400px', vSide)
    await shot(win, '06-viewer')

    await setInput(win, 'input[aria-label="版本"]', '9.0')
    await setInput(win, 'input[aria-label="P 值"]', '80')
    await setInput(win, '.v-note-edit[data-field="note"]', '在线改备注：这条记录值得留。')
    await sleep(900)
    const vEdited = await entryState(win)
    assert(vEdited && vEdited.params.extra.version === '9.0', '查看器改版本已写入', vEdited && vEdited.params.extra.version)
    assert(vEdited && vEdited.params.extra.p === '80', '查看器改 P 值已写入', vEdited && vEdited.params.extra.p)
    assert(vEdited && vEdited.note.includes('在线改备注'), '查看器改备注已写入', vEdited && vEdited.note)

    console.log('\n→ 查看器交互：滚轮 / Ctrl+滚轮 / 中键 / 右键…')
    await js(win, `document.querySelector('.v-stage')?.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))`)
    await sleep(300)
    const idx1 = await js(win, `document.querySelector('.viewer .v-pill')?.textContent`)
    assert(idx1 && idx1.trim().startsWith('2 /'), '滚轮切到第 2 张', idx1)
    await js(
      win,
      `document.querySelector('.v-stage')?.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: 700, clientY: 400, bubbles: true, cancelable: true }))`
    )
    await sleep(250)
    const pct = await js(win, `document.querySelector('.v-pct')?.textContent`)
    assert(pct && parseInt(pct, 10) > 100, 'Ctrl+滚轮放大', pct)

    const beforePan = await js(win, `document.querySelector('.v-img')?.style.transform`)
    await js(
      win,
      `(() => {
        const s = document.querySelector('.v-stage')
        s.dispatchEvent(new PointerEvent('pointerdown', { button: 1, clientX: 700, clientY: 400, bubbles: true, cancelable: true, pointerId: 7 }))
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 760, clientY: 450, bubbles: true, pointerId: 7 }))
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: 760, clientY: 450, bubbles: true, pointerId: 7 }))
        return true
      })()`
    )
    await sleep(200)
    const afterPan = await js(win, `document.querySelector('.v-img')?.style.transform`)
    assert(beforePan !== afterPan, '中键拖动平移', { beforePan, afterPan })
    const stillOpen = await js(win, `!!document.querySelector('.viewer')`)
    assert(stillOpen, '中键拖动不会误关闭查看器')

    await js(
      win,
      `(() => {
        const s = document.querySelector('.v-stage')
        s.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 620, clientY: 420 }))
        return true
      })()`
    )
    await sleep(300)
    const menu = await js(
      win,
      `(() => ({
        open: !!document.querySelector('.ctx-menu'),
        items: [...document.querySelectorAll('.ctx-menu .ctx-item')].map(x => x.textContent.trim())
      }))()`
    )
    assert(menu.open, '右键菜单打开', menu)
    assert(menu.items.some((x) => x.includes('水平翻转')), '菜单有翻转', menu.items)
    assert(menu.items.some((x) => x.includes('去色')), '菜单有去色', menu.items)
    assert(menu.items.some((x) => x.includes('保存为新产物')), '菜单有保存为新产物', menu.items)
    await shot(win, '07-viewer-menu', false)

    await js(
      win,
      `(() => {
        const items = [...document.querySelectorAll('.ctx-menu .ctx-item')]
        items.find(x => x.textContent.includes('水平翻转'))?.click()
        items.find(x => x.textContent.includes('去色'))?.click()
        return true
      })()`
    )
    await sleep(350)
    const trans = await js(
      win,
      `(() => ({
        chip: !!document.querySelector('.v-transchip'),
        filter: document.querySelector('.v-img')?.style.filter,
        transform: document.querySelector('.v-img')?.style.transform
      }))()`
    )
    assert(trans.chip, '变换预览条出现', trans)
    assert(trans.filter === 'grayscale(1)' && /scaleX\(-1\)/.test(trans.transform || ''), '翻转+去色即时预览', trans)
    await shot(win, '08-viewer-flip')

    const beforeAssets = (await entryState(win)).assetIds.length
    await js(win, `document.querySelector('.v-transchip .save')?.click()`)
    await sleep(1600)
    const after = await entryState(win)
    assert(after && after.assetIds.length === beforeAssets + 1, '保存为新产物（资产 +1）', {
      before: beforeAssets,
      after: after && after.assetIds.length
    })
    const snap = await libState(win)
    assert(snap.data.assets.length > 0, '新资产进入库')
    const idxAfter = await js(win, `document.querySelector('.viewer .v-pill')?.textContent`)
    assert(idxAfter && idxAfter.trim().includes('/ 4'), '查看器切到新产物（4 / 4）', idxAfter)
    await shot(win, '09-saved-asset')

    console.log('\n→ 单击图片关闭…')
    await js(
      win,
      `document.querySelector('.v-stage')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 500, clientY: 400 }))`
    )
    await sleep(350)
    const gone = await js(win, `!document.querySelector('.viewer')`)
    assert(gone, '单击图片 / 空白处关闭查看器')

    console.log('\n→ 单图记录滚轮翻记录 + 关闭按钮命中区…')
    await js(win, `document.querySelector('.card[data-id="${FIXTURE_ONE_ID}"]')?.click()`)
    await sleep(650)
    const oneOpen = await js(
      win,
      `(() => ({
        viewer: !!document.querySelector('.viewer'),
        pill: document.querySelector('.viewer .v-pill')?.textContent || '',
        title: document.querySelector('.v-title-input')?.value || ''
      }))()`
    )
    assert(oneOpen.viewer && oneOpen.pill.includes('记录'), '单图条目顶部显示记录序号', oneOpen)
    await js(
      win,
      `document.querySelector('.v-stage')?.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))`
    )
    await sleep(600)
    const afterRecord = await js(win, `document.querySelector('.v-title-input')?.value || ''`)
    assert(afterRecord && afterRecord !== oneOpen.title, '单图条目滚轮翻到相邻记录', {
      before: oneOpen.title,
      after: afterRecord
    })
    const panelHit = await js(
      win,
      `(() => {
        const b = document.querySelector('[data-viewer-close="panel"]')
        if (!b) return null
        const r = b.getBoundingClientRect()
        const pts = [
          [r.left + r.width / 2, r.top + r.height / 2],
          [r.left + 6, r.top + 6],
          [r.right - 6, r.bottom - 6]
        ]
        return {
          size: [Math.round(r.width), Math.round(r.height)],
          hits: pts.map(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-viewer-close]') === b)
        }
      })()`
    )
    assert(panelHit && panelHit.size[0] >= 32 && panelHit.size[1] >= 32, '详情页 X 关闭按钮至少 32×32', panelHit)
    assert(panelHit && panelHit.hits.every(Boolean), '详情页 X 关闭按钮边缘也能点中', panelHit)
    await js(win, `document.querySelector('[data-viewer-close="panel"]')?.click()`)
    await sleep(350)
    assert(await js(win, `!document.querySelector('.viewer')`), '详情页顶部 X 关闭查看器')

    await js(win, `document.querySelector('.card[data-id="testmj0140000002"]')?.click()`)
    await sleep(600)
    const stageHit = await js(
      win,
      `(() => {
        const b = document.querySelector('[data-viewer-close="stage"]')
        if (!b) return null
        const r = b.getBoundingClientRect()
        const pts = [
          [r.left + r.width / 2, r.top + r.height / 2],
          [r.left + 6, r.top + 6],
          [r.right - 6, r.bottom - 6]
        ]
        return {
          size: [Math.round(r.width), Math.round(r.height)],
          hits: pts.map(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-viewer-close]') === b)
        }
      })()`
    )
    assert(stageHit && stageHit.size[1] >= 30, '图片右上角关闭按钮命中区足够', stageHit)
    assert(stageHit && stageHit.hits.every(Boolean), '图片右上角关闭按钮边缘也能点中', stageHit)
    await js(win, `document.querySelector('[data-viewer-close="stage"]')?.click()`)
    await sleep(350)
    assert(await js(win, `!document.querySelector('.viewer')`), '图片右上角关闭查看器')

    console.log('\n→ 编辑器未保存确认…')
    await js(
      win,
      `(() => {
        const c = document.querySelector('.card')
        c?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }))
        return true
      })()`
    )
    await sleep(700)
    await setInput(win, '.es-title', '不保存的标题')
    await js(win, `document.querySelector('.es-top .btn.ghost')?.click()`)
    await sleep(350)
    const confirm = await js(
      win,
      `(() => {
        const o = document.querySelector('.overlay')
        return { open: !!o, text: o ? o.textContent : '', z: o ? getComputedStyle(o).zIndex : null }
      })()`
    )
    assert(confirm.open && confirm.text.includes('放弃'), '关闭时弹出未保存确认', confirm.text.slice(0, 80))
    assert(confirm.z && Number(confirm.z) > 90, '确认框盖在全屏编辑器之上', confirm.z)
    await js(win, `document.querySelector('[data-confirm-ok]')?.click()`)
    await sleep(400)
    const titleAfter = (await entryState(win)).title
    assert(!titleAfter.includes('不保存的标题'), '放弃后标题没落库', titleAfter)

    console.log('\n→ 落盘检查…')
    await sleep(600)
    const disk = JSON.parse(fs.readFileSync(LIB, 'utf8'))
    const diskEntry = disk.entries.find((e) => e.id === FIXTURE_ID)
    assert(diskEntry && diskEntry.params.extra.p === '80', 'library.json 已落盘 P 值 80', diskEntry && diskEntry.params.extra)
    assert(diskEntry && diskEntry.params.extra.version === '9.0', 'library.json 已落盘版本 9.0', diskEntry && diskEntry.params.extra)
    assert(diskEntry && diskEntry.assetIds.length === beforeAssets + 1, 'library.json 已落盘新产物', diskEntry && diskEntry.assetIds.length)

    assert(rendererErrors.length === 0, '渲染层无报错', rendererErrors)
  } catch (e) {
    console.error('验收过程出错:', e)
    failures++
  }

  console.log('\n' + (failures ? `✗ ${failures} 项失败` : '✓ 全部通过'))
  await sleep(300)
  app.exit(failures ? 1 : 0)
})
