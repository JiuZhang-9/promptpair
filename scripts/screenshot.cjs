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
  // 无头/离屏环境下窗口不会自动重绘，capturePage 会拿到旧帧。
  // 经验证：改一次尺寸再改回来能强制一次完整合成（invalidate 不够）。
  const [w, h] = win.getSize()
  win.setSize(w + 2, h)
  await sleep(160)
  win.setSize(w, h)
  await sleep(520)
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
    const dbg1 = await win.webContents.executeJavaScript(`
      (() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        const btns = [...document.querySelectorAll('.tb-actions .icon-btn')]
        if (btns.length) btns[btns.length - 1].click()
        return { iconBtns: btns.length }
      })()
    `)
    console.log('  诊断 设置点击:', JSON.stringify(dbg1))
    await sleep(800)
    const dbg2 = await win.webContents.executeJavaScript(`
      (() => ({
        setGroups: document.querySelectorAll('.set-group').length,
        theme: document.documentElement.dataset.theme,
        btns: [...document.querySelectorAll('.set-group .seg-btn')].map(b => b.textContent)
      }))()
    `)
    console.log('  诊断 面板状态:', JSON.stringify(dbg2))
    await shot(win, '05-settings')

    // 局部放大：检查开关与分段控件
    const [ww, hh] = win.getSize()
    win.setSize(ww + 2, hh)
    await sleep(160)
    win.setSize(ww, hh)
    await sleep(500)
    const full = await win.webContents.capturePage()
    const sz = full.getSize()
    // 设置面板在页面右侧 410px 宽，取它的左半部分放大看控件
    const zs = full.crop({
      x: Math.max(0, sz.width - 410),
      y: 46,
      width: Math.min(410, sz.width),
      height: Math.min(430, sz.height - 46)
    })
    fs.writeFileSync(path.join(OUT, '05b-settings-zoom.png'), zs.toPNG())
    console.log('  ✓ 05b-settings-zoom.png  (' + sz.width + 'x' + sz.height + ')')

    // 浅色主题
    const dbg3 = await win.webContents.executeJavaScript(`
      (() => {
        const segs = [...document.querySelectorAll('.set-group .seg-btn')]
        const light = segs.find(s => s.textContent.includes('浅色'))
        if (light) light.click()
        return { clicked: !!light }
      })()
    `)
    console.log('  诊断 浅色点击:', JSON.stringify(dbg3))
    await sleep(1000)
    const dbg4 = await win.webContents.executeJavaScript(
      `({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor })`
    )
    console.log('  诊断 主题结果:', JSON.stringify(dbg4))
    await shot(win, '06-light')
  } catch (e) {
    console.error('截图过程出错:', e)
  }

  // 收集渲染层报错
  await sleep(200)
  app.quit()
})
