/**
 * 0.13.0 交互验收：
 *   搜索 MJ 风格码、标签过滤、大图查看与缩放、复制浮窗、卡片/集合右键菜单、
 *   集合移动/合并/删除确认、爱心图标、评分性能。
 *
 * 用法：node scripts/demo-seed.mjs && npx electron scripts/verify-013.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const OUT = path.resolve('build/shots-013')
fs.mkdirSync(OUT, { recursive: true })
app.setPath('userData', path.resolve('.smoke/userdata'))

app.on('browser-window-created', (_e, w) => {
  w.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.log(`[renderer] ${message} (${String(source).split('/').pop()}:${line})`)
  })
  w.webContents.on('render-process-gone', (_e, d) => console.log('[gone]', JSON.stringify(d)))
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
const js = (win, code) => win.webContents.executeJavaScript(code)

async function shot(win, name, jiggle = true) {
  if (jiggle) {
    const [w, h] = win.getSize()
    win.setSize(w + 2, h)
    await sleep(160)
    win.setSize(w, h)
    await sleep(480)
  } else {
    await sleep(420)
  }
  const buf = (await win.webContents.capturePage()).toPNG()
  fs.writeFileSync(path.join(OUT, name + '.png'), buf)
  console.log('  ✓ ' + name + '.png  ' + (buf.length / 1024).toFixed(0) + ' KB')
}

async function setSearch(win, value) {
  await js(
    win,
    `(() => {
      const input = document.querySelector('.search input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(value)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`
  )
  await sleep(320)
}

app.whenReady().then(async () => {
  await sleep(2400)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }
  win.setSize(1440, 860)
  await sleep(700)

  try {
    console.log('\n→ 基础渲染与图标…')
    const base = await js(
      win,
      `(() => {
        const cards = document.querySelectorAll('.card')
        const heart = document.querySelector('.card-fav .ico path')?.getAttribute('d') || ''
        const coll = document.querySelector('.mini-tag.coll')
        return { cards: cards.length, heart, coll: coll?.textContent || '' }
      })()`
    )
    assert(base.cards > 0, '画廊渲染卡片', base.cards)
    assert(base.heart.startsWith('M12 20s-7'), '收藏使用爱心图标', base.heart.slice(0, 18))
    assert(base.coll.length > 0, '卡片显示所属集合', base.coll)
    await shot(win, '01-gallery')

    console.log('\n→ 搜索风格码…')
    await setSearch(win, 'tag:东方')
    let r = await js(
      win,
      `(() => {
        const chips = [...document.querySelectorAll('.card .mini-tag:not(.model):not(.coll):not(.more)')].map(x => x.textContent.trim())
        const side = [...document.querySelectorAll('.tag-group .tagchip')].map(x => x.textContent.replace(/\\d+$/, '').trim())
        return { cards: document.querySelectorAll('.card').length, chips, side }
      })()`
    )
    assert(r.cards === 2, 'tag:东方 只返回带该标签的 2 条', r.cards)
    assert(r.chips.length === 2 && r.chips.every((x) => x === '东方'), '卡片只显示被搜索标签', r.chips)
    assert(r.side.length === 1 && r.side[0] === '东方', '侧栏标签只显示被搜索标签', r.side)

    await setSearch(win, 'code:ox27gsk')
    r = await js(win, `document.querySelectorAll('.card').length`)
    assert(r === 1, 'code:ox27gsk 命中风格码', r)

    await setSearch(win, '613512513')
    r = await js(win, `document.querySelectorAll('.card').length`)
    assert(r === 1, '自由文本可直接搜到风格码', r)

    await setSearch(win, '')
    r = await js(win, `document.querySelectorAll('.card').length`)
    assert(r >= 9, '清空搜索后恢复全部', r)

    console.log('\n→ 大图查看…')
    await js(
      win,
      `(() => {
        const card = document.querySelector('.card')
        card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
        return true
      })()`
    )
    await sleep(420)
    r = await js(
      win,
      `(() => {
        const v = document.querySelector('.viewer')
        return {
          open: !!v,
          title: document.querySelector('.v-title')?.textContent || '',
          collection: document.querySelector('.v-sect .v-pillbtn')?.textContent || '',
          img: !!document.querySelector('.v-img')
        }
      })()`
    )
    assert(r.open, '双击卡片打开大图查看')
    assert(r.title.length > 0, '右侧显示标题', r.title)
    assert(r.collection.length > 0, '右侧显示所属集合', r.collection)
    assert(r.img, '左侧显示大图')
    await shot(win, '02-viewer')

    await js(
      win,
      `new Promise((resolve) => {
        const img = document.querySelector('.v-img')
        if (!img || img.complete) return resolve(true)
        img.addEventListener('load', () => resolve(true), { once: true })
        img.addEventListener('error', () => resolve(true), { once: true })
        setTimeout(() => resolve(false), 1500)
      })`
    )
    const pctBefore = await js(win, `document.querySelector('.v-pct').textContent`)
    await js(
      win,
      `document.querySelector('.v-stage').dispatchEvent(new WheelEvent('wheel', {
        deltaY: -120, bubbles: true, cancelable: true, clientX: 600, clientY: 400
      }))`
    )
    await sleep(220)
    const pctWheel = await js(win, `document.querySelector('.v-pct').textContent`)
    assert(pctWheel !== '100%', '滚轮可放大图片', { pctBefore, pctWheel })
    await js(win, `document.querySelector('.v-zoom button[title="适应窗口"]').click()`)
    await sleep(180)
    await js(win, `document.querySelector('.v-zoom button[title="放大"]').click()`)
    await sleep(220)
    r = await js(win, `document.querySelector('.v-img').style.transform`)
    assert(/scale\(([2-9]|1\.[1-9])/.test(r), '放大按钮改变缩放', r)
    const pctZoom = await js(win, `document.querySelector('.v-pct').textContent`)
    await js(win, `document.querySelector('.v-zoom button[title="原始像素 1:1"]').click()`)
    await sleep(220)
    const pct = await js(win, `document.querySelector('.v-pct').textContent`)
    const nat = await js(
      win,
      `(() => {
        const img = document.querySelector('.v-img')
        const stage = document.querySelector('.v-stage')
        return { nw: img?.naturalWidth, nh: img?.naturalHeight, sw: stage?.clientWidth, sh: stage?.clientHeight }
      })()`
    )
    assert(pct !== '100%', '1:1 按钮生效', { pctBefore, pctZoom, pct, nat })
    await js(win, `document.querySelector('.v-zoom button[title="适应窗口"]').click()`)
    await sleep(180)
    assert((await js(win, `document.querySelector('.v-pct').textContent`)) === '100%', '适应窗口回到 100%')

    await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(240)
    assert((await js(win, `!document.querySelector('.viewer')`)), 'Esc 关闭大图')

    console.log('\n→ 复制浮窗…')
    // 缩略图太小时卡片操作按钮会被容器查询隐藏；先调到 300 再测鼠标旁浮窗
    await js(
      win,
      `(() => {
        const slider = document.querySelector('.size-ctl input')
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(slider, '300')
        slider.dispatchEvent(new Event('input', { bubbles: true }))
        return slider.value
      })()`
    )
    await sleep(600)
    const geom = await js(
      win,
      `(() => {
        const card = document.querySelector('.card')
        const btn = card.querySelector('[data-copy="prompt"]')
        const c = card.getBoundingClientRect()
        const b = btn.getBoundingClientRect()
        return {
          cardX: Math.round(c.x + 40), cardY: Math.round(c.y + 40),
          btnX: Math.round(b.x + b.width / 2), btnY: Math.round(b.y + b.height / 2)
        }
      })()`
    )
    win.webContents.sendInputEvent({ type: 'mouseMove', x: geom.cardX, y: geom.cardY })
    await sleep(260)
    win.webContents.sendInputEvent({ type: 'mouseMove', x: geom.btnX, y: geom.btnY })
    await sleep(220)
    win.webContents.sendInputEvent({ type: 'mouseDown', x: geom.btnX, y: geom.btnY, button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: geom.btnX, y: geom.btnY, button: 'left', clickCount: 1 })
    await sleep(320)
    r = await js(
      win,
      `(() => {
        const tip = document.querySelector('.copy-tip')
        return {
          tip: tip?.textContent || '',
          left: parseFloat(tip?.style.left || '-1'),
          top: parseFloat(tip?.style.top || '-1')
        }
      })()`
    )
    assert(r.tip.includes('已复制'), '复制后出现浮窗', r.tip)
    assert(
      Math.abs(r.left - (geom.btnX + 14)) <= 2 && Math.abs(r.top - (geom.btnY - 38)) <= 2,
      '浮窗出现在鼠标附近',
      { tip: [r.left, r.top], mouse: [geom.btnX, geom.btnY] }
    )
    const toastCount = await js(win, `document.querySelectorAll('.toast').length`)
    assert(toastCount === 0, '复制不再弹全局 toast', toastCount)
    await shot(win, '03-copy-tip', false)

    console.log('\n→ 卡片右键菜单…')
    await js(
      win,
      `(() => {
        const card = [...document.querySelectorAll('.card')].find(c => c.textContent.includes('中式超现实'))
        const rect = card.getBoundingClientRect()
        card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.x + 60, clientY: rect.y + 60 }))
        return true
      })()`
    )
    await sleep(200)
    r = await js(
      win,
      `(() => ({
        open: !!document.querySelector('.ctx-menu'),
        copies: document.querySelectorAll('.ctx-menu [data-ctx-copy]').length,
        items: document.querySelectorAll('.ctx-menu .ctx-item').length
      }))()`
    )
    assert(r.open, '右键打开卡片菜单')
    assert(r.copies >= 4, '四档复制入口齐全', r.copies)
    assert(r.items >= 8, '菜单包含查看/编辑/导出/删除', r.items)
    await shot(win, '04-card-menu', false)

    await js(
      win,
      `(() => {
        const card = [...document.querySelectorAll('.card')].find(c => c.textContent.includes('中式超现实'))
        const rect = card.getBoundingClientRect()
        card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.x + 60, clientY: rect.y + 60 }))
        return true
      })()`
    )
    await sleep(200)
    await js(win, `document.querySelector('.ctx-menu [data-ctx-copy="promptParams"]').click()`)
    await sleep(220)
    assert(
      await js(win, `!!document.querySelector('.copy-tip') && !document.querySelector('.ctx-menu')`),
      '菜单复制后显示浮窗并关闭菜单'
    )

    await js(
      win,
      `(() => {
        const card = document.querySelector('.card')
        const rect = card.getBoundingClientRect()
        card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.x + 60, clientY: rect.y + 60 }))
        return true
      })()`
    )
    await sleep(150)
    await js(win, `[...document.querySelectorAll('.ctx-menu .ctx-item')].find(b => b.textContent.includes('放大查看')).click()`)
    await sleep(260)
    assert(await js(win, `!!document.querySelector('.viewer')`), '菜单「放大查看」打开大图')
    await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(220)

    console.log('\n→ 集合右键菜单…')
    await js(
      win,
      `(() => {
        const row = document.querySelector('[data-coll]')
        const rect = row.getBoundingClientRect()
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.right - 12, clientY: rect.y + 10 }))
        return true
      })()`
    )
    await sleep(200)
    r = await js(
      win,
      `(() => ({
        open: !!document.querySelector('.coll-ctx'),
        cmds: [...document.querySelectorAll('.coll-ctx [data-coll-cmd]')].map(b => b.dataset.collCmd)
      }))()`
    )
    assert(r.open, '右键打开集合菜单')
    assert(
      r.cmds.length === 4 && ['rename', 'move', 'merge', 'delete'].every((x) => r.cmds.includes(x)),
      '集合菜单含重命名/移动/合并/删除',
      r.cmds
    )
    await shot(win, '05-collection-menu', false)

    await js(win, `document.querySelector('.coll-ctx [data-coll-cmd="delete"]').click()`)
    await sleep(220)
    r = await js(
      win,
      `(() => {
        const box = document.querySelector('.confirm-box')
        return { open: !!box, hasOk: !!document.querySelector('[data-confirm-ok]'), text: box?.textContent || '' }
      })()`
    )
    assert(r.open && r.hasOk, '删除集合弹出应用内确认框', r)
    await shot(win, '06-collection-confirm')
    await js(win, `document.querySelector('.confirm-foot .btn').click()`)
    await sleep(180)
    assert(await js(win, `!document.querySelector('.confirm-box')`), '取消后确认框关闭')

    console.log('\n→ 集合移动 / 合并…')
    await js(
      win,
      `(() => {
        const row = document.querySelector('[data-coll]')
        const rect = row.getBoundingClientRect()
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.right - 12, clientY: rect.y + 10 }))
        return true
      })()`
    )
    await sleep(180)
    await js(win, `document.querySelector('.coll-ctx [data-coll-cmd="move"]').click()`)
    await sleep(260)
    r = await js(
      win,
      `(() => ({
        modal: !!document.querySelector('.overlay .mini-modal-head'),
        targets: document.querySelectorAll('.target-row').length
      }))()`
    )
    assert(r.modal, '打开「移动内容」目标选择')
    assert(r.targets > 0, '列出其他集合', r.targets)
    await js(win, `document.querySelector('.target-row').click()`)
    await sleep(120)
    await js(win, `[...document.querySelectorAll('.mini-modal-foot .btn')].find(b => b.textContent.includes('确认移动')).click()`)
    await sleep(420)
    assert(
      await js(win, `!document.querySelector('.overlay .mini-modal-head')`),
      '确认移动后弹窗关闭'
    )
    await sleep(650)
    r = await js(
      win,
      `[...document.querySelectorAll('[data-coll]')].map(x => ({
        id: x.dataset.coll,
        name: x.querySelector('.nav-label')?.textContent || '',
        n: Number(x.querySelector('em')?.textContent || 0)
      }))`
    )
    const empty = r.find((x) => x.n === 0)
    const filled = r.find((x) => x.n > 0)
    assert(!!empty, '移动后来源集合变空', r)
    assert(!!filled && filled.n === 6, '目标集合收到全部内容', r)

    await js(
      win,
      `(() => {
        const row = [...document.querySelectorAll('[data-coll]')].find(x => Number(x.querySelector('em').textContent) === 0)
        const rect = row.getBoundingClientRect()
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.right - 12, clientY: rect.y + 10 }))
        return true
      })()`
    )
    await sleep(180)
    await js(win, `document.querySelector('.coll-ctx [data-coll-cmd="merge"]').click()`)
    await sleep(260)
    assert(
      await js(win, `!!document.querySelector('.target-row') && !!document.querySelector('.target-warn')`),
      '合并弹窗有目标选择与不可撤销提示'
    )
    await js(win, `document.querySelector('.target-row').click()`)
    await sleep(100)
    await js(win, `[...document.querySelectorAll('.mini-modal-foot .btn')].find(b => b.textContent.includes('确认合并')).click()`)
    await sleep(750)
    r = await js(
      win,
      `[...document.querySelectorAll('[data-coll]')].map(x => ({
        name: x.querySelector('.nav-label')?.textContent || '',
        n: Number(x.querySelector('em')?.textContent || 0)
      }))`
    )
    assert(r.length === 1, '合并后来源集合被删除', r)
    assert(r[0]?.n === 6, '合并后目标集合保留全部内容', r)

    await js(
      win,
      `(() => {
        const row = document.querySelector('[data-coll]')
        const rect = row.getBoundingClientRect()
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.right - 12, clientY: rect.y + 10 }))
        return true
      })()`
    )
    await sleep(180)
    await js(win, `document.querySelector('.coll-ctx [data-coll-cmd="delete"]').click()`)
    await sleep(220)
    await js(win, `document.querySelector('[data-confirm-ok]').click()`)
    await sleep(750)
    assert(
      (await js(win, `document.querySelectorAll('[data-coll]').length`)) === 0,
      '确认按钮真正删除集合'
    )

    console.log('\n→ 评分性能…')
    await js(win, `document.querySelector('.search input').focus()`)
    await setSearch(win, '')
    const perf = await js(
      win,
      `new Promise((resolve) => {
        const star = document.querySelector('.card .stars .star[data-star="5"]')
        const t0 = performance.now()
        star.click()
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)))
      })`
    )
    console.log('    评分到下一帧：' + perf.toFixed(1) + ' ms')
    assert(perf < 120, '评分无明显卡顿（<120ms）', perf)

    console.log('\n→ 关于页 GitHub 链接…')
    await js(win, `document.querySelector('.tb-actions [title^="设置"]').click()`)
    await sleep(300)
    await js(win, `(() => {
      const b = [...document.querySelectorAll('.settings-nav button')].find(x => x.textContent.trim() === '关于')
      if (b) b.click()
      return !!b
    })()`)
    await sleep(450)
    r = await js(
      win,
      `(() => {
        const links = [...document.querySelectorAll('.about-links .link-btn')].map(x => x.textContent.trim())
        return { links, scroll: document.querySelector('.detail-scroll.settings')?.scrollTop || 0 }
      })()`
    )
    assert(
      r.links.some((x) => x.includes('GitHub')) && r.links.some((x) => x.includes('反馈')),
      '关于页有 GitHub / 反馈链接',
      r.links
    )
    await shot(win, '07-about')
  } catch (e) {
    console.error('✗ 运行异常：', e)
    failures++
  }

  console.log('\n' + (failures ? `✗ ${failures} 项失败` : '✓ 全部通过'))
  app.quit()
})
