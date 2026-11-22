/**
 * 0.17.0 验收：
 *   窗口大小/位置记忆、最大化状态、原生窗口按钮安全区、开机自启开关、
 *   关闭窗口到托盘、--hidden 后台启动。
 *
 * 单阶段执行器，由 verify-017.cjs 连着重启 4 次（普通 → 恢复窗口 → 后台启动）。
 * 只改 .smoke/userdata-017。
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const ROOT = path.resolve('.smoke')
const UD = path.join(ROOT, 'userdata-017')
const LIB = path.resolve('.smoke/lib/library.json')
const OUT = path.resolve('build/shots-017')
const CFG = path.join(UD, 'config.json')
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(UD, { recursive: true })

if (!fs.existsSync(LIB)) {
  console.error('✗ 找不到 .smoke/lib，请先运行：node scripts/demo-seed.mjs')
  process.exit(1)
}

const phase = process.env.PP_017_PHASE || 'first'
const START = { x: 80, y: 60, width: 1100, height: 700 }
const NEXT = { x: 120, y: 90, width: 1160, height: 710 }

if (phase === 'first') {
  fs.writeFileSync(
    CFG,
    JSON.stringify(
      {
        libraryPath: path.dirname(LIB),
        theme: 'dark',
        thumbSize: 200,
        winBounds: START,
        winMaximized: false,
        minimizeToTray: false,
        launchAtLogin: false,
        startMinimized: false
      },
      null,
      2
    )
  )
} else {
  // 保留上一阶段写入的窗口状态
  const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'))
  cfg.minimizeToTray = false
  cfg.launchAtLogin = false
  cfg.startMinimized = false
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2))
}
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
async function shot(win, name) {
  await sleep(300)
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG())
  console.log('  · ' + name + '.png')
}
function readCfg() {
  try {
    return JSON.parse(fs.readFileSync(CFG, 'utf8'))
  } catch {
    return {}
  }
}
function safeZone() {
  return 146 // CSS px at 100%；测试固定 100%
}
async function measure(win, selector) {
  return js(
    win,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { right: r.right, left: r.left, inner: innerWidth, safe: innerWidth - ${safeZone()} }
    })()`
  )
}
async function cleanup() {
  try {
    const cfg = readCfg()
    cfg.minimizeToTray = false
    cfg.launchAtLogin = false
    cfg.startMinimized = false
    fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2))
  } catch {
    /* ignore */
  }
}

app.whenReady().then(async () => {
  await sleep(2600)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }
  win.setAlwaysOnTop(true)
  try {
    win.webContents.setBackgroundThrottling(false)
  } catch {
    /* ignore */
  }
  if (phase !== 'hidden') {
    win.show()
    win.focus()
  }
  await sleep(700)

  try {
    if (phase === 'first') {
      console.log('\n→ 窗口大小记忆…')
      const got = win.getBounds()
      assert(got.width === START.width && got.height === START.height, '首次启动使用保存的窗口大小', got)
      assert(got.x === START.x && got.y === START.y, '首次启动使用保存的窗口位置', got)

      win.setBounds(NEXT)
      await sleep(900)
      const saved = readCfg().winBounds
      assert(
        saved && saved.width === NEXT.width && saved.height === NEXT.height,
        '调整大小后写入 config.json',
        saved
      )
      assert(saved && saved.x === NEXT.x && saved.y === NEXT.y, '移动后写入窗口位置', saved)

      console.log('\n→ 设置页启动开关…')
      await js(win, `document.querySelector('[title="设置 (Ctrl+,)"]')?.click()`)
      await sleep(500)
      const startup = await js(
        win,
        `(() => {
          const el = document.getElementById('set-startup')
          if (!el) return null
          el.scrollIntoView({ block: 'start' })
          return {
            text: el.textContent,
            toggles: el.querySelectorAll('.toggle-row').length,
            disabled: [...el.querySelectorAll('.toggle-row')].filter(x => x.disabled).length
          }
        })()`
      )
      assert(startup && startup.text.includes('开机自动启动') && startup.text.includes('关闭窗口时最小化到托盘'), '设置页有启动与窗口分组', startup)
      assert(startup && startup.toggles === 3, '三个启动/托盘开关', startup)
      assert(startup && startup.disabled === 1, '未开启自启时后台启动置灰', startup)
      await shot(win, '01-settings-startup')

      const trayRow = await js(
        win,
        `(() => {
          const row = [...document.querySelectorAll('#set-startup .set-row')].find(x => x.textContent.includes('关闭窗口时最小化到托盘'))
          const t = row?.querySelector('.toggle-row')
          t?.click()
          return !!t
        })()`
      )
      await sleep(400)
      assert(trayRow && (await js(win, `window.pp.getConfig()`)).minimizeToTray === true, '托盘开关可点击并写入配置')
      await js(
        win,
        `(() => {
          const row = [...document.querySelectorAll('#set-startup .set-row')].find(x => x.textContent.includes('关闭窗口时最小化到托盘'))
          row?.querySelector('.toggle-row')?.click()
        })()`
      )
      await sleep(300)
      await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      await sleep(300)

      console.log('\n→ 关闭到托盘…')
      await js(win, `window.pp.patchConfig({ minimizeToTray: true })`)
      await sleep(300)
      win.close()
      await sleep(700)
      assert(!win.isDestroyed(), '关闭窗口后进程仍在')
      assert(!win.isVisible(), '关闭窗口后主窗口隐藏')
      assert(BrowserWindow.getAllWindows().length === 1, '托盘模式下窗口对象保留', BrowserWindow.getAllWindows().length)
      win.show()
      await sleep(500)
      assert(win.isVisible(), '可以从托盘恢复主窗口')
      await js(win, `window.pp.patchConfig({ minimizeToTray: false })`)
      await sleep(300)

      console.log('\n→ 开机自启…')
      await js(win, `window.pp.patchConfig({ launchAtLogin: true })`)
      await sleep(500)
      const login = app.getLoginItemSettings()
      assert(
        login.openAtLogin || login.executableWillLaunchAtLogin || login.launchItems.length > 0,
        '登录项已写入系统',
        login
      )
      await js(win, `window.pp.patchConfig({ launchAtLogin: false, startMinimized: false })`)
      await sleep(500)
      assert(app.getLoginItemSettings().launchItems.length === 0, '关闭自启后登录项已清理')

      console.log('\n→ 原生窗口按钮安全区…')
      await js(win, `document.querySelector('.card')?.click()`)
      await sleep(700)
      const vx = await measure(win, '.v-close-x')
      assert(vx && vx.right <= vx.safe, '查看器信息栏 X 避开原生窗口按钮', vx)
      await shot(win, '02-viewer-safe')
      await js(win, `document.querySelector('.v-close-x')?.click()`)
      await sleep(400)

      await js(
        win,
        `(() => {
          const c = document.querySelector('.card')
          c?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }))
        })()`
      )
      await sleep(800)
      const es = await measure(win, '.es-top .btn.primary')
      assert(es && es.right <= es.safe, '编辑器保存按钮避开原生窗口按钮', es)
      await shot(win, '03-editor-safe')
      await js(win, `document.querySelector('.es-top .btn.ghost')?.click()`)
      await sleep(500)

      const multiId = await js(
        win,
        `(async () => {
          const s = await window.pp.getState()
          const imgs = (e) => e.assetIds.filter(id => s.data.assets.find(a => a.id === id)?.kind === 'image')
          return s.data.entries.find(e => imgs(e).length >= 2)?.id || null
        })()`
      )
      if (multiId) {
        await js(win, `document.querySelector('.card[data-id="${multiId}"]')?.click()`)
        await sleep(700)
        await js(win, `document.querySelector('.v-actions [title="对比本条的多张产物"]')?.click()`)
        await sleep(700)
        const cx = await measure(win, '.cmp-top > .icon-btn')
        assert(cx && cx.right <= cx.safe, '对比浮层关闭按钮避开原生窗口按钮', cx)
        await shot(win, '04-compare-safe')
        await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
        await sleep(300)
      } else {
        console.log('  ! 演示库没有多图条目，跳过对比安全区')
      }
    }

    if (phase === 'restore') {
      console.log('\n→ 第二次启动恢复窗口…')
      const got = win.getBounds()
      assert(got.width === NEXT.width && got.height === NEXT.height, '重启后恢复窗口大小', got)
      assert(got.x === NEXT.x && got.y === NEXT.y, '重启后恢复窗口位置', got)

      win.maximize()
      await sleep(900)
      const maxCfg = readCfg()
      assert(maxCfg.winMaximized === true, '最大化状态写入配置', maxCfg.winMaximized)
      assert(
        maxCfg.winBounds && maxCfg.winBounds.width === NEXT.width,
        '最大化时仍保存还原尺寸',
        maxCfg.winBounds
      )
      win.unmaximize()
      await sleep(900)
      assert(readCfg().winMaximized === false, '取消最大化后状态更新')

      win.maximize()
      await sleep(900)
      assert(readCfg().winMaximized === true, '再次最大化，准备验证重启恢复')
    }

    if (phase === 'max') {
      console.log('\n→ 第三次启动恢复最大化…')
      assert(win.isMaximized(), '重启后恢复最大化状态')
      const normal = win.getNormalBounds()
      assert(
        normal.width === NEXT.width && normal.height === NEXT.height,
        '最大化窗口的还原尺寸保持正确',
        normal
      )
      win.unmaximize()
      await sleep(900)
      assert(!win.isMaximized(), '取消最大化成功')
      assert(readCfg().winMaximized === false, '取消最大化后配置更新')
    }

    if (phase === 'hidden') {
      console.log('\n→ --hidden 后台启动…')
      assert(!win.isVisible(), '后台启动时不显示主窗口')
      assert(BrowserWindow.getAllWindows().length === 1, '后台启动仍创建窗口对象')
      win.show()
      await sleep(500)
      assert(win.isVisible(), '可以从托盘/任务栏恢复')
      cleanup()
      console.log('\n' + (failures ? `✗ ${failures} 项失败` : '✓ 全部通过'))
      await sleep(200)
      app.exit(failures ? 1 : 0)
      return
    }
  } catch (e) {
    console.error('验收过程出错:', e)
    failures++
  }

  cleanup()
  console.log('\n' + (failures ? `✗ ${failures} 项失败` : '✓ 全部通过'))
  await sleep(300)
  app.exit(failures ? 1 : 0)
})
