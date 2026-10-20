/**
 * 视觉验收脚本：启动已构建的应用 → 依次截图关键界面 → 退出。
 * 用法：npx electron scripts/screenshot.cjs
 * 只在开发期使用，不参与打包。
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const OUT = path.resolve('build/shots')
fs.mkdirSync(OUT, { recursive: true })

// 让应用使用演示库的 userData，避免污染真实配置
app.setPath('userData', path.resolve('.smoke/userdata'))

// 在窗口创建前就挂上监听，否则会漏掉首屏报错
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('console-message', (_ev, level, message, line, source) => {
    console.log(`[renderer:${level}] ${message}  (${String(source).split('/').pop()}:${line})`)
  })
  w.webContents.on('did-fail-load', (_ev, code, desc, url) => {
    console.log(`[did-fail-load] ${code} ${desc} ${url}`)
  })
  w.webContents.on('preload-error', (_ev, p, err) => {
    console.log('[preload-error]', p, err && err.message)
  })
})

// 加载真正的主进程入口
require('../out/main/index.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(win, name) {
  const img = await win.webContents.capturePage()
  const buf = img.toPNG()
  fs.writeFileSync(path.join(OUT, name + '.png'), buf)
  console.log('  ✓ ' + name + '.png  ' + (buf.length / 1024).toFixed(0) + ' KB')
}

app.whenReady().then(async () => {
  await sleep(600)
  const winEarly = BrowserWindow.getAllWindows()[0]
  if (winEarly) {
    winEarly.webContents.on('console-message', (_e, level, message, line, source) => {
      console.log(`[renderer:${level}] ${message}  (${String(source).split('/').pop()}:${line})`)
    })
    winEarly.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.log(`[did-fail-load] ${code} ${desc} ${url}`)
    })
    winEarly.webContents.on('render-process-gone', (_e, details) => {
      console.log('[render-process-gone]', JSON.stringify(details))
    })
    winEarly.webContents.on('preload-error', (_e, p, err) => {
      console.log('[preload-error]', p, err && err.message)
    })
  }

  await sleep(2200)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }
  win.setSize(1440, 860)

  try {
    await shot(win, '01-gallery')

    // 局部放大：检查卡片排版细节
    const zoom = await win.webContents.capturePage({ x: 180, y: 70, width: 460, height: 340 })
    fs.writeFileSync(path.join(OUT, '01b-cards-zoom.png'), zoom.toPNG())
    console.log('  ✓ 01b-cards-zoom.png')

    // 打开第一条记录的详情面板
    await win.webContents.executeJavaScript(`
      (() => {
        const c = document.querySelector('.card')
        if (c) c.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return !!c
      })()
    `)
    await sleep(900)
    await shot(win, '02-detail')

    // 关闭详情，打开编辑器
    await win.webContents.executeJavaScript(`
      (() => {
        const x = document.querySelector('.detail .detail-head .icon-btn')
        if (x) x.click()
        return true
      })()
    `)
    await sleep(300)

    await win.webContents.executeJavaScript(`
      (() => {
        const t = document.querySelector('.tb-actions .dd-trigger')
        if (t) t.click()
        return !!t
      })()
    `)
    await sleep(350)
    await win.webContents.executeJavaScript(`
      (() => {
        const items = [...document.querySelectorAll('.dd-item')]
        const it = items.find(i => i.textContent.includes('手动新建'))
        if (it) it.click()
        return !!it
      })()
    `)
    await sleep(700)
    await shot(win, '03-editor')

    // 关闭编辑器，测试多选 + 批量条
    await win.webContents.executeJavaScript(`
      (() => {
        const b = [...document.querySelectorAll('.ed-foot .btn')].find(x=>x.textContent.includes('取消'))
        if (b) b.click()
        return true
      })()
    `)
    await sleep(400)

    await win.webContents.executeJavaScript(`
      (() => {
        const cards = [...document.querySelectorAll('.card')]
        cards[0].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
        cards[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
        cards[2].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
        return cards.length
      })()
    `)
    await sleep(600)
    await shot(win, '04-batch')

    // 设置面板
    await win.webContents.executeJavaScript(`
      (() => {
        const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        document.dispatchEvent(esc)
        const btns = [...document.querySelectorAll('.tb-actions .icon-btn')]
        if (btns.length) btns[btns.length-1].click()
        return true
      })()
    `)
    await sleep(700)
    await shot(win, '05-settings')

    // 浅色主题
    await win.webContents.executeJavaScript(`
      (() => {
        const segs = [...document.querySelectorAll('.set-group .seg-btn')]
        const light = segs.find(s => s.textContent.includes('浅色'))
        if (light) light.click()
        return !!light
      })()
    `)
    await sleep(900)
    await shot(win, '06-light')
  } catch (e) {
    console.error('截图过程出错:', e)
  }

  // 收集渲染层报错
  await sleep(200)
  app.quit()
})
