/**
 * 0.6.0「看得清」验收：
 *   C 方案字号 / 卡片信息区、卡片打星、收藏、标签筛选、点击打开详情、
 *   90–110% 界面比例。
 *
 * 用法：node scripts/demo-seed.mjs && npx electron scripts/verify-readability.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

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
const js = (win, code) => win.webContents.executeJavaScript(code, true)

async function shot(win, name) {
  const [w, h] = win.getSize()
  win.setSize(w + 2, h)
  await sleep(140)
  win.setSize(w, h)
  await sleep(420)
  const buf = (await win.webContents.capturePage()).toPNG()
  fs.writeFileSync(path.join(OUT, name + '.png'), buf)
  console.log('  · ' + name + '.png  ' + (buf.length / 1024).toFixed(0) + ' KB')
}

app.whenReady().then(async () => {
  await sleep(2200)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }
  win.setSize(1440, 900)
  await sleep(600)
  win.show()
  win.focus()
  win.webContents.focus()

  try {
    console.log('\n→ C 方案字号')
    const metrics = await js(win, `(async () => {
      const cfg = await window.pp.getConfig()
      const card = document.querySelector('.card')
      const title = card.querySelector('.card-title')
      const prompt = card.querySelector('.card-prompt')
      const info = card.querySelector('.card-info')
      const tag = card.querySelector('button.mini-tag')
      return {
        uiScale: cfg.uiScale,
        title: getComputedStyle(title).fontSize,
        titleLh: getComputedStyle(title).lineHeight,
        prompt: getComputedStyle(prompt).fontSize,
        promptLh: getComputedStyle(prompt).lineHeight,
        info: getComputedStyle(info).height,
        tag: tag && getComputedStyle(tag).fontSize,
        stars: card.querySelectorAll('.card-stars .star').length
      }
    })()`)
    console.log('  ', metrics)
    assert(metrics.title === '13.5px' && metrics.titleLh === '19px', '卡片标题 13.5/19', metrics)
    assert(metrics.prompt === '12.5px' && metrics.promptLh === '18px', '卡片提示词 12.5/18', metrics)
    assert(metrics.info === '100px', '卡片信息区 100px', metrics.info)
    assert(metrics.tag === '10.5px', '卡片标签 10.5px', metrics.tag)
    assert(metrics.stars === 5, '卡片有 5 颗可点星', metrics.stars)
    await shot(win, '20-readability-c')

    console.log('\n→ 卡片打星 / 清除')
    const clearDisplay = await js(
      win,
      `getComputedStyle(document.querySelector('.card .card-clear')).display`
    )
    assert(clearDisplay === 'none', '清除 × 默认隐藏', clearDisplay)
    const firstId = await js(win, `document.querySelector('.card').dataset.id`)
    await js(win, `document.querySelector('.card [data-star="5"]').click()`)
    await sleep(350)
    let rating = await js(win, `window.pp.getState().then(s => s.data.entries.find(e => e.id === ${JSON.stringify(firstId)}).rating)`)
    assert(rating === 5, '点第 5 颗星写入 5 星', rating)
    assert(!(await js(win, `!!document.querySelector('.right-dock.open .detail')`)), '打星不打开详情')
    await js(win, `document.querySelector('.card [data-star="5"]').click()`)
    await sleep(250)
    rating = await js(win, `window.pp.getState().then(s => s.data.entries.find(e => e.id === ${JSON.stringify(firstId)}).rating)`)
    assert(rating === 5, '再点同一颗仍为 5 星', rating)
    await js(win, `document.querySelector('.card .card-clear')?.click()`)
    await sleep(300)
    rating = await js(win, `window.pp.getState().then(s => s.data.entries.find(e => e.id === ${JSON.stringify(firstId)}).rating)`)
    assert(rating === 0, '× 清除评分', rating)

    console.log('\n→ 收藏 / 标签筛选')
    const beforeFav = await js(win, `window.pp.getState().then(s => s.data.entries.find(e => e.id === ${JSON.stringify(firstId)}).favorite)`)
    await js(win, `document.querySelector('.card .card-fav').click()`)
    await sleep(300)
    const afterFav = await js(win, `window.pp.getState().then(s => s.data.entries.find(e => e.id === ${JSON.stringify(firstId)}).favorite)`)
    assert(afterFav === !beforeFav, '卡片收藏可切换', { beforeFav, afterFav })
    assert(!(await js(win, `!!document.querySelector('.right-dock.open .detail')`)), '收藏不打开详情')

    const beforeCount = await js(win, `document.querySelectorAll('.card').length`)
    await js(win, `document.querySelector('.card button.mini-tag')?.click()`)
    await sleep(350)
    const tagState = await js(win, `(() => ({
      count: document.querySelectorAll('.card').length,
      active: document.querySelectorAll('.tagchip.on').length,
      detail: !!document.querySelector('.right-dock.open .detail')
    }))()`)
    console.log('  ', { beforeCount, ...tagState })
    assert(tagState.count < beforeCount, '点标签后结果变少', tagState.count)
    assert(tagState.active >= 1, '左栏标签同步选中', tagState.active)
    assert(tagState.detail === false, '点标签不打开详情')
    await js(win, `document.querySelector('.card button.mini-tag')?.click()`)
    await sleep(250)

    console.log('\n→ 点卡片打开详情')
    const open = await js(win, `(() => {
      const c = document.querySelector('.card')
      c.click()
      return new Promise(resolve => setTimeout(() => resolve({
        open: !!document.querySelector('.right-dock.open .detail'),
        selected: c.classList.contains('sel')
      }), 60))
    })()`)
    assert(open.open === true && open.selected === true, '点卡片打开详情并选中', open)
    await shot(win, '21-readability-detail')
    await js(win, `document.querySelector('.right-dock .icon-btn[title^="关闭"]')?.click()`)
    await sleep(120)

    console.log('\n→ 90–110% 界面比例')
    await js(win, `window.pp.patchConfig({ uiScale: 1 })`)
    await sleep(250)
    assert(Math.abs(win.webContents.getZoomFactor() - 1) < 0.001, '100% 页面缩放', win.webContents.getZoomFactor())
    await js(win, `document.querySelector('.tb-actions [title^="设置"]')?.click()`)
    await sleep(250)
    assert(
      await js(win, `!!document.querySelector('.settings-modal') && document.querySelector('.settings-modal').textContent.includes('界面大小')`),
      '设置里有界面大小'
    )
    const setSlider = async (value) => {
      await js(win, `(() => {
        const el = document.querySelector('#ui-scale-input')
        if (!el) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(el, '${value}')
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
      await sleep(180)
    }
    const releaseSlider = async () => {
      await js(win, `document.querySelector('#ui-scale-input')?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))`)
      await sleep(450)
    }
    await setSlider(110)
    assert(
      Math.abs(win.webContents.getZoomFactor() - 1) < 0.001,
      '拖动滑杆时还不缩放（松手才生效）',
      win.webContents.getZoomFactor()
    )
    await releaseSlider()
    const cfg = await js(win, `window.pp.getConfig()`)
    console.log('  ', { zoom: win.webContents.getZoomFactor(), uiScale: cfg.uiScale })
    assert(Math.abs(win.webContents.getZoomFactor() - 1.1) < 0.001, '110% 页面缩放', win.webContents.getZoomFactor())
    assert(cfg.uiScale === 1.1, '110% 写入配置', cfg.uiScale)
    await setSlider(100)
    await releaseSlider()
    assert(Math.abs(win.webContents.getZoomFactor() - 1) < 0.001, '恢复 100% 页面缩放', win.webContents.getZoomFactor())
    await js(win, `document.querySelector('.settings-modal [title^="关闭"]')?.click()`)
    await sleep(150)

    console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ C 方案验收全部通过')
  } catch (e) {
    console.error('\n✗ 验收异常:', e)
    failures++
  } finally {
    win.destroy()
    app.quit()
  }
})
