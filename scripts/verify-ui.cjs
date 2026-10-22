/**
 * 0.4.0 第一批交互验收：
 *   设置弹窗、左右栏收起、卡片复制、Ctrl+C、Ctrl+滚轮、框选、点空白取消。
 * 只操作演示库（.smoke/lib），不碰真实数据。
 *
 * 用法：node scripts/demo-seed.mjs && npx electron scripts/verify-ui.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow, clipboard } = require('electron')

const OUT = path.resolve('build/shots')
fs.mkdirSync(OUT, { recursive: true })
app.setPath('userData', path.resolve('.smoke/userdata'))

app.on('browser-window-created', (_e, w) => {
  w.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 2) console.log('[renderer] ' + message)
  })
})

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
  await sleep(520)
  const buf = (await win.webContents.capturePage()).toPNG()
  fs.writeFileSync(path.join(OUT, name + '.png'), buf)
  console.log('  ✓ ' + name + '.png  ' + (buf.length / 1024).toFixed(0) + ' KB')
}

async function press(win, key, opts = {}) {
  const init = JSON.stringify({ key, bubbles: true, cancelable: true, ...opts })
  await win.webContents.executeJavaScript(`
    (() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', ${init}))
      return true
    })()
  `)
  await sleep(260)
}

const js = (win, code) => win.webContents.executeJavaScript(code)

app.whenReady().then(async () => {
  await sleep(2400)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }
  win.setSize(1440, 860)
  await sleep(600)

  try {
    console.log('\n→ 设置弹窗…')
    const settingsOpened = await js(win, `
      (() => {
        const item = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.trim() === '设置')
        if (item) item.click()
        return !!item
      })()
    `)
    await sleep(500)
    const modal = await js(win, `!!document.querySelector('.overlay .settings-modal')`)
    assert(settingsOpened && modal, '设置以居中弹窗打开', { settingsOpened, modal })
    const asideCount = await js(win, `document.querySelectorAll('.main .detail').length`)
    assert(asideCount === 0, '设置不再占右侧栏', asideCount)
    await press(win, 'Escape')
    assert(!(await js(win, `!!document.querySelector('.overlay')`)), 'Esc 关闭设置弹窗')

    const modelChips = await js(win, `document.querySelectorAll('.mini-tag.model').length`)
    assert(modelChips > 0, '卡片显示生成模型徽标', modelChips)

    console.log('\n→ 左右栏收起…')
    await press(win, 'b', { ctrlKey: true })
    await sleep(280)
    assert(
      await js(win, `document.querySelector('.main').classList.contains('sidebar-collapsed')`),
      'Ctrl+B 收起左栏'
    )
    const cfgSide = await js(win, `window.pp.getConfig().then(c => c.sidebarCollapsed)`)
    assert(cfgSide === true, '左栏状态写入配置', cfgSide)
    await shot(win, '17-sidebar-collapsed')
    await press(win, 'b', { ctrlKey: true })
    await sleep(280)
    assert(
      !(await js(win, `document.querySelector('.main').classList.contains('sidebar-collapsed')`)),
      'Ctrl+B 展开左栏'
    )

    const beforeCardW = await js(
      win,
      `document.querySelector('.card').getBoundingClientRect().width`
    )
    await js(win, `document.querySelector('.card')?.click()`)
    await sleep(80)
    const clickW1 = await js(win, `document.querySelector('.card').getBoundingClientRect().width`)
    await sleep(140)
    const clickW2 = await js(win, `document.querySelector('.card').getBoundingClientRect().width`)
    await sleep(260)
    const clickW3 = await js(win, `document.querySelector('.card').getBoundingClientRect().width`)
    assert(
      clickW1 === beforeCardW && clickW2 === beforeCardW && clickW3 === beforeCardW,
      '点卡片打开详情时卡片不缩放',
      { beforeCardW, clickW1, clickW2, clickW3 }
    )
    assert(
      await js(win, `!!document.querySelector('.right-dock.open .detail')`),
      '点卡片打开右侧详情'
    )
    const dhSub = await js(
      win,
      `document.querySelector('.right-dock .dh-sub')?.textContent || ''`
    )
    assert(
      /即梦|MJ|SDXL|可灵/.test(dhSub),
      '详情头部显示生成模型',
      dhSub
    )

    await press(win, 'b', { ctrlKey: true, shiftKey: true })
    await sleep(280)
    assert(
      await js(win, `document.querySelector('.right-dock').classList.contains('collapsed')`),
      'Ctrl+Shift+B 收起右栏'
    )
    const cfgRight = await js(win, `window.pp.getConfig().then(c => c.rightPanelCollapsed)`)
    assert(cfgRight === true, '右栏状态写入配置', cfgRight)
    await shot(win, '18-right-collapsed')
    await press(win, 'b', { ctrlKey: true, shiftKey: true })
    await sleep(280)
    assert(
      !(await js(win, `document.querySelector('.right-dock').classList.contains('collapsed')`)),
      'Ctrl+Shift+B 展开右栏'
    )

    console.log('\n→ 复制提示词…')
    win.show()
    win.focus()
    win.webContents.focus()
    await sleep(250)
    const positive = await js(win, `window.pp.getState().then(s => s.data.entries[0].positive)`)
    assert(!!positive, '演示数据有提示词')
    clipboard.writeText('sentinel')
    const cardCopy = await js(win, `
      (() => {
        const b = document.querySelector('.card .mini-btn[title="复制提示词"]')
        if (b) b.click()
        return !!b
      })()
    `)
    await sleep(350)
    assert(cardCopy, '卡片上有复制按钮')
    assert(clipboard.readText() === positive, '卡片复制写入剪贴板', clipboard.readText())

    await js(win, `document.querySelector('.card')?.click()`)
    await sleep(300)
    win.focus()
    win.webContents.focus()
    await sleep(150)
    clipboard.writeText('sentinel')
    await press(win, 'c', { ctrlKey: true })
    await sleep(250)
    assert(clipboard.readText() === positive, 'Ctrl+C 复制焦点卡片提示词', clipboard.readText())

    console.log('\n→ Shift+右键复制…')
    win.focus()
    win.webContents.focus()
    await sleep(150)
    clipboard.writeText('sentinel')
    const shiftRight = await js(win, `
      (() => {
        const c = document.querySelector('.card')
        if (!c) return false
        c.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, shiftKey: true, clientX: 20, clientY: 20
        }))
        return true
      })()
    `)
    await sleep(350)
    assert(
      shiftRight && clipboard.readText() === positive,
      'Shift+右键复制提示词',
      clipboard.readText()
    )

    console.log('\n→ 收起动画不抖动…')
    const beforeW = await js(win, `document.querySelector('.card').getBoundingClientRect().width`)
    await js(win, `
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'b', ctrlKey: true, bubbles: true, cancelable: true
      }))
    `)
    await sleep(60)
    const w60 = await js(win, `document.querySelector('.card').getBoundingClientRect().width`)
    await sleep(60)
    const w120 = await js(win, `document.querySelector('.card').getBoundingClientRect().width`)
    await sleep(60)
    const w180 = await js(win, `document.querySelector('.card').getBoundingClientRect().width`)
    await sleep(500)
    const wEnd = await js(win, `document.querySelector('.card').getBoundingClientRect().width`)
    assert(
      w60 === beforeW && w120 === beforeW && w180 === beforeW,
      '收起动画期间卡片尺寸不抖动',
      { beforeW, w60, w120, w180 }
    )
    assert(wEnd > 0, '动画结束后完成一次重排', wEnd)
    await js(win, `
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'b', ctrlKey: true, bubbles: true, cancelable: true
      }))
    `)
    await sleep(650)

    console.log('\n→ Ctrl+滚轮缩放…')
    win.focus()
    win.webContents.focus()
    await sleep(150)
    const beforeSize = await js(win, `window.pp.getConfig().then(c => c.thumbSize)`)
    await js(win, `
      (() => {
        const el = document.querySelector('.gallery-scroll')
        const r = el.getBoundingClientRect()
        el.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true, ctrlKey: true, deltaY: -120,
          clientX: r.left + 100, clientY: r.top + 100
        }))
        return true
      })()
    `)
    await sleep(450)
    const afterSize = await js(win, `window.pp.getConfig().then(c => c.thumbSize)`)
    assert(afterSize > beforeSize, 'Ctrl+滚轮放大卡片', { beforeSize, afterSize })

    console.log('\n→ 框选…')
    await js(win, `
      (() => {
        const el = document.querySelector('.gallery-scroll')
        const r = el.getBoundingClientRect()
        const opt = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0 }
        el.dispatchEvent(new PointerEvent('pointerdown', { ...opt, clientX: r.left + 4, clientY: r.top + 4 }))
        window.dispatchEvent(new PointerEvent('pointermove', { ...opt, clientX: r.left + 600, clientY: r.top + 500 }))
        return true
      })()
    `)
    await sleep(300)
    const marqueeCount = await js(win, `document.querySelectorAll('.card.sel').length`)
    await shot(win, '19-marquee')
    await js(win, `
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0,
        clientX: 0, clientY: 0
      }))
    `)
    await sleep(350)
    assert(marqueeCount > 0, '拖拽框选选中卡片', marqueeCount)
    assert(!(await js(win, `!!document.querySelector('.marquee')`)), '松手后选择框消失')

    console.log('\n→ 点空白取消…')
    await js(win, `document.querySelector('.card')?.click()`)
    await sleep(350)
    assert(await js(win, `!!document.querySelector('.batchbar')`), '选中后出现底部条')
    await js(win, `
      (() => {
        const el = document.querySelector('.gallery-scroll')
        const r = el.getBoundingClientRect()
        const opt = { bubbles: true, cancelable: true, pointerId: 2, pointerType: 'mouse', button: 0 }
        const x = r.left + 4
        const y = r.top + 200
        el.dispatchEvent(new PointerEvent('pointerdown', { ...opt, clientX: x, clientY: y }))
        window.dispatchEvent(new PointerEvent('pointerup', { ...opt, clientX: x, clientY: y }))
        return true
      })()
    `)
    await sleep(350)
    assert(!(await js(win, `!!document.querySelector('.batchbar')`)), '点空白收起底部条')
    assert(!(await js(win, `!!document.querySelector('.detail')`)), '点空白关闭详情')
  } catch (e) {
    console.error('\n❌ 验收异常：', e.message)
    failures++
  }

  console.log('')
  if (failures === 0) console.log('✅ 布局与卡片交互全部断言通过')
  else console.log(`❌ 有 ${failures} 项断言失败`)

  await sleep(200)
  app.quit()
})
