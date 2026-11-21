/**
 * 0.14.0 视觉自检：启动已构建的应用，截取全屏编辑器 / 查看器关键界面。
 * 用法：npx electron scripts/screenshot-014.cjs
 * 只在开发期使用，不参与打包。
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const OUT = path.resolve('build/shots-014')
fs.mkdirSync(OUT, { recursive: true })
app.setPath('userData', path.resolve('.smoke/userdata'))
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('console-message', (_ev, level, message, line, source) => {
    if (level >= 2) console.log(`[renderer:${level}] ${message} (${String(source).split('/').pop()}:${line})`)
  })
  w.webContents.on('did-fail-load', (_ev, code, desc, url) => {
    console.log(`[did-fail-load] ${code} ${desc} ${url}`)
  })
})
require('../out/main/index.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(win, name, { jiggle = true } = {}) {
  if (jiggle) {
    const [w, h] = win.getSize()
    win.setSize(w + 2, h)
    await sleep(160)
    win.setSize(w, h)
    await sleep(480)
  } else {
    await sleep(260)
  }
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG())
  console.log('  ✓ ' + name + '.png  ' + (img.toPNG().length / 1024).toFixed(0) + ' KB')
}

app.whenReady().then(async () => {
  await sleep(1600)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }
  win.setSize(1440, 900)
  await sleep(900)
  const js = (code) => win.webContents.executeJavaScript(code)

  try {
    await shot(win, '014-01-gallery')

    // 打开第一条（fixture）的编辑器
    await js(`
      (() => {
        const c = document.querySelector('.card')
        c?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }))
        return !!c
      })()
    `)
    await sleep(900)
    const ed = await js(`(() => ({
      screen: !!document.querySelector('.es-screen'),
      side: !!document.querySelector('.es-side'),
      title: document.querySelector('.es-title')?.value,
      p: !!document.querySelector('.pe-field[aria-label="P 值"]'),
      coll: document.querySelector('.cp-chips')?.textContent?.trim(),
      stars: document.querySelectorAll('#edStars .star').length,
      fav: !!document.querySelector('.es-basics .fav'),
      model: document.querySelector('.mp-trigger')?.textContent?.trim()
    }))()`)
    console.log('  editor:', JSON.stringify(ed))
    await shot(win, '014-02-editor')

    // 模型弹层：先 jiggle 再打开，避免 resize 关掉弹层
    await js(`(() => { const [w,h]=[0,0]; return true })()`)
    const [ww, hh] = win.getSize()
    win.setSize(ww + 2, hh)
    await sleep(160)
    win.setSize(ww, hh)
    await sleep(450)
    await js(`document.querySelector('.mp-trigger')?.click()`)
    await sleep(450)
    await shot(win, '014-03-model-pop', { jiggle: false })
    const menu = await js(`(() => ({
      open: !!document.querySelector('.mp-pop'),
      items: document.querySelectorAll('.mp-item').length,
      width: document.querySelector('.mp-pop')?.getBoundingClientRect().width
    }))()`)
    console.log('  model pop:', JSON.stringify(menu))
    await js(`document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)

    // 集合区滚到可见，再打开弹层
    await js(`
      (() => {
        const sec = [...document.querySelectorAll('.es-side .es-sec')].find(s => s.textContent.includes('所属集合'))
        sec?.scrollIntoView({ block: 'center' })
        return !!sec
      })()
    `)
    await sleep(400)
    await js(`document.querySelector('.cp-add')?.click()`)
    await sleep(400)
    await shot(win, '014-04-collections-pop', { jiggle: false })
    const cp = await js(`(() => ({
      open: !!document.querySelector('.cp-pop'),
      rows: document.querySelectorAll('.cp-row').length,
      chips: document.querySelector('.cp-chips')?.textContent?.trim()
    }))()`)
    console.log('  collection pop:', JSON.stringify(cp))

    // 星星点击
    await js(`document.querySelector('#edStars .star[data-star="5"]')?.click()`)
    await sleep(300)
    const star = await js(`(() => { const s=document.querySelector('#edStars .star[data-star="5"] .ico'); return s ? { fill: getComputedStyle(s).fill, color: getComputedStyle(s).color } : null })()`)
    console.log('  star 5:', JSON.stringify(star))
    await shot(win, '014-05-stars')

    // 关闭编辑器（有改动会弹确认，点放弃）
    await js(`
      (() => {
        const b=[...document.querySelectorAll('.es-top .btn')].find(x=>x.textContent.includes('取消'))
        b?.click(); return !!b
      })()
    `)
    await sleep(350)
    await js(`document.querySelector('[data-confirm-ok]')?.click()`)
    await sleep(400)

    // 打开查看器
    await js(`document.querySelector('.card')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`)
    await sleep(800)
    await shot(win, '014-06-viewer')
    const v = await js(`(() => ({
      viewer: !!document.querySelector('.viewer'),
      title: document.querySelector('.v-title-input')?.value,
      p: document.querySelector('.pe-field[aria-label="P 值"] input')?.value,
      ell: document.querySelector('.v-hint')?.textContent,
      cols: document.querySelector('.cp-chips')?.textContent?.trim()
    }))()`)
    console.log('  viewer:', JSON.stringify(v))

    // 右键菜单
    await js(`
      (() => {
        const s=document.querySelector('.v-stage')
        s?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 620, clientY: 420 }))
        return !!s
      })()
    `)
    await sleep(350)
    await shot(win, '014-07-viewer-menu', { jiggle: false })
    const vm = await js(`(() => ({ menu: !!document.querySelector('.ctx-menu'), items: [...document.querySelectorAll('.ctx-menu .ctx-item')].map(x=>x.textContent.trim()) }))()`)
    console.log('  viewer menu:', JSON.stringify(vm))

    // 水平翻转 + 去色
    await js(`
      (() => {
        const items=[...document.querySelectorAll('.ctx-menu .ctx-item')]
        items.find(x=>x.textContent.includes('水平翻转'))?.click()
        items.find(x=>x.textContent.includes('去色'))?.click()
        return true
      })()
    `)
    await sleep(400)
    const tf = await js(`(() => ({
      chip: !!document.querySelector('.v-transchip'),
      filter: document.querySelector('.v-img')?.style.filter,
      transform: document.querySelector('.v-img')?.style.transform
    }))()`)
    console.log('  transform:', JSON.stringify(tf))
    await shot(win, '014-08-viewer-flip')

    // 滚轮切换 / Ctrl+滚轮缩放
    await js(`document.querySelector('.ctx-backdrop')?.click()`)
    await sleep(200)
    await js(`document.querySelector('.v-stage')?.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))`)
    await sleep(300)
    const idx = await js(`document.querySelector('.viewer .v-pill')?.textContent`)
    console.log('  wheel idx:', idx)
    await js(`document.querySelector('.v-stage')?.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: 700, clientY: 400, bubbles: true, cancelable: true }))`)
    await sleep(200)
    const z = await js(`document.querySelector('.v-pct')?.textContent`)
    console.log('  ctrl zoom:', z)
    await shot(win, '014-09-viewer-zoom', { jiggle: false })

    // 单击图片关闭
    await js(`document.querySelector('.v-stage')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 500, clientY: 400 }))`)
    await sleep(300)
    const closed = await js(`!document.querySelector('.viewer')`)
    console.log('  click close:', closed)
  } catch (e) {
    console.error('截图过程出错:', e)
  }
  await sleep(300)
  app.quit()
})
