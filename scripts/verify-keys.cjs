/**
 * 交互验收：键盘焦点模型 + 标签管理面板 + 快捷键帮助 + AI 设置项。
 * 只操作演示库（.smoke/lib），不碰真实数据。
 *
 * 用法：npx electron scripts/verify-keys.cjs
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
  const init = JSON.stringify({ key, bubbles: true, ...opts })
  await win.webContents.executeJavaScript(`
    (() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', ${init}))
      return true
    })()
  `)
  await sleep(260)
}

const js = (win, code) => win.webContents.executeJavaScript(code)

async function openTool(win, label) {
  const opened = await js(win, `(() => {
    const t = [...document.querySelectorAll('.tb-actions .dd-trigger')].find(x => x.textContent.trim().startsWith('工具'))
    if (!t) return false
    t.click()
    return true
  })()`)
  await sleep(140)
  const clicked = await js(win, `(() => {
    const b = [...document.querySelectorAll('.dd-menu .dd-item')].find(x => x.textContent.includes(${JSON.stringify(label)}))
    if (b) b.click()
    return !!b
  })()`)
  await sleep(350)
  return opened && clicked
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
  await sleep(500)

  try {
    console.log('\n→ 键盘焦点…')
    const before = await js(win, `(() => { const c = document.querySelector('.card.focused'); return c ? c.title : null })()`)
    assert(before === null, '初始没有焦点', before)

    await press(win, 'j', { ctrlKey: true })
    const first = await js(win, `(() => { const c = document.querySelector('.card.focused'); return c ? c.title : null })()`)
    assert(!!first, '按 Ctrl+J 出现焦点卡片', first)
    await shot(win, '15-focus')

    await press(win, 'ArrowDown')
    const second = await js(win, `(() => { const c = document.querySelector('.card.focused'); return c ? c.title : null })()`)
    assert(!!second && second !== first, '方向键移动焦点', { first, second })

    await press(win, 'e')
    const editor = await js(win, `(() => { const o = document.querySelector('.overlay'); return o ? o.textContent : '' })()`)
    assert(editor.includes('编辑记录'), 'E 打开编辑器')
    await js(win, `
      (() => {
        const b = [...document.querySelectorAll('.overlay .btn')].find(x => x.textContent.includes('取消'))
        if (b) b.click()
        return !!b
      })()
    `)
    await sleep(400)

    await press(win, ' ')
    const count1 = await js(win, `(() => { const b = document.querySelector('.bb-count b'); return b ? Number(b.textContent) : 0 })()`)
    assert(count1 === 1, 'Space 选中 1 条', count1)

    await press(win, 'Escape')
    const cleared = await js(win, `(() => ({ bar: !!document.querySelector('.batchbar'), focus: !!document.querySelector('.card.focused') }))()`)
    assert(!cleared.bar && !cleared.focus, 'Esc 清空选中和焦点', cleared)

    await press(win, 'j')
    const plainFocus = await js(win, `!!document.querySelector('.card.focused')`)
    assert(!plainFocus, '单独按 J 不移动焦点（需要 Ctrl）')

    console.log('\n→ 全选 / 标签面板…')
    await press(win, 'a', { ctrlKey: true })
    const total = await js(win, `window.pp.getState().then(s => s.data.entries.length)`)
    const countAll = await js(win, `(() => { const b = document.querySelector('.bb-count b'); return b ? Number(b.textContent) : 0 })()`)
    assert(countAll === total && total > 0, 'Ctrl+A 全选当前筛选', { countAll, total })

    await press(win, 't')
    const plainTag = await js(win, `!!document.querySelector('.overlay')`)
    assert(!plainTag, '单独按 T 不打开标签面板')

    await press(win, 't', { ctrlKey: true })
    const tagModal = await js(win, `(() => { const o = document.querySelector('.overlay'); return o ? o.textContent : '' })()`)
    assert(tagModal.includes('批量加标签'), 'Ctrl+T 打开批量标签面板', tagModal.slice(0, 40))

    await press(win, 'Escape')
    const closed = await js(win, `!document.querySelector('.overlay')`)
    assert(closed, 'Esc 关闭标签面板')

    console.log('\n→ 快捷键帮助…')
    await press(win, '?')
    const help = await js(win, `(() => { const o = document.querySelector('.overlay'); return o ? o.textContent : '' })()`)
    assert(help.includes('键盘快捷键') && help.includes('移动焦点'), '? 打开帮助浮层')
    await shot(win, '09-shortcuts')
    await press(win, 'Escape')
    assert(await js(win, `!document.querySelector('.overlay')`), 'Esc 关闭帮助')

    const helpBtn = await openTool(win, '快捷键帮助')
    assert(helpBtn && (await js(win, `!!document.querySelector('.overlay')`)), '顶栏工具菜单打开帮助')
    await press(win, 'Escape')

    console.log('\n→ 新增全局快捷键…')
    await press(win, ',', { ctrlKey: true })
    assert(
      await js(win, `!!document.querySelector('.settings-modal')`),
      'Ctrl+, 打开设置'
    )
    await press(win, 'Escape')
    await press(win, '/', { ctrlKey: true })
    assert(
      await js(win, `!!document.querySelector('.overlay') && document.querySelector('.overlay').textContent.includes('键盘快捷键')`),
      'Ctrl+/ 打开快捷键帮助'
    )
    await press(win, 'Escape')

    await press(win, 'm', { ctrlKey: true, shiftKey: true })
    assert(
      (await js(win, `document.querySelector('.detail .dh-title')?.textContent || ''`)) === '模型管理',
      'Ctrl+Shift+M 打开模型管理'
    )
    await js(win, `document.querySelector('.right-dock .detail-head .icon-btn')?.click()`)
    await sleep(250)
    await press(win, 'g', { ctrlKey: true, shiftKey: true })
    assert(
      (await js(win, `document.querySelector('.detail .dh-title')?.textContent || ''`)) === '标签管理',
      'Ctrl+Shift+G 打开标签管理'
    )
    await js(win, `document.querySelector('.right-dock .detail-head .icon-btn')?.click()`)
    await sleep(250)
    await press(win, 'd', { ctrlKey: true, shiftKey: true })
    assert(
      (await js(win, `document.querySelector('.detail .dh-title')?.textContent || ''`)) === '重复图检测',
      'Ctrl+Shift+D 打开重复图检测'
    )
    await js(win, `document.querySelector('.right-dock .detail-head .icon-btn')?.click()`)
    await sleep(250)

    await press(win, 'f', { ctrlKey: true, shiftKey: true })
    const favFilterOn = await js(win, `[...document.querySelectorAll('.nav-item')].some(x => x.textContent.includes('收藏') && x.classList.contains('on'))`)
    assert(favFilterOn, 'Ctrl+Shift+F 只看收藏')
    await press(win, 'f', { ctrlKey: true, shiftKey: true })

    console.log('\n→ 标签管理面板…')
    const opened = await openTool(win, '标签管理')
    assert(opened, '顶栏工具菜单有「标签管理」')
    const title = await js(win, `(() => { const t = document.querySelector('.detail .dh-title'); return t ? t.textContent : '' })()`)
    assert(title === '标签管理', '面板已打开', title)
    const rows = await js(win, `document.querySelectorAll('.tm-row').length`)
    assert(rows > 0, '标签行已渲染', rows)
    await shot(win, '10-tags')

    console.log('\n→ AI 设置项…')
    const settings = await js(win, `(() => {
      const b = document.querySelector('.tb-actions [title^="设置"]')
      if (b) b.click()
      return !!b
    })()`)
    await sleep(400)
    assert(settings, '顶栏有「设置」入口')
    const scrolled = await js(win, `
      (() => {
        const t = [...document.querySelectorAll('.set-group-title')].find(x => x.textContent.includes('AI 打标'))
        if (t) t.scrollIntoView({ block: 'start' })
        return !!t
      })()
    `)
    await sleep(500)
    assert(scrolled, '设置页有「AI 打标」分组')
    await shot(win, '11-ai-settings')

    const toggled = await js(win, `
      (() => {
        const t = [...document.querySelectorAll('.set-group-title')].find(x => x.textContent.includes('AI 打标'))
        const g = t && t.parentElement
        const sw = g && g.querySelector('.toggle-row')
        if (sw) sw.click()
        return !!sw
      })()
    `)
    await sleep(500)
    const inputs = await js(win, `document.querySelectorAll('.set-input').length`)
    assert(toggled && inputs === 3, '启用后显示 3 个配置输入框', inputs)
    await shot(win, '12-ai-fields')

    // 复原，避免污染下一次截图
    await js(win, `
      (() => {
        const t = [...document.querySelectorAll('.set-group-title')].find(x => x.textContent.includes('AI 打标'))
        const g = t && t.parentElement
        const sw = g && g.querySelector('.toggle-row')
        if (sw && sw.classList.contains('on')) sw.click()
        return true
      })()
    `)

    console.log('\n→ 评分 / 收藏快捷键…')
    await press(win, 'Escape')
    await sleep(250)
    await press(win, 'a', { ctrlKey: true })
    await press(win, '1')
    const ratings = await js(win, `window.pp.getState().then(s => s.data.entries.filter(e => e.rating === 1).length)`)
    assert(ratings > 0, '按 1 给选中项打 1 星', ratings)

    const beforeFav = await js(win, `window.pp.getState().then(s => s.data.entries.filter(e => e.favorite).length)`)
    await press(win, 'f')
    const afterFav = await js(win, `window.pp.getState().then(s => s.data.entries.filter(e => e.favorite).length)`)
    assert(afterFav !== beforeFav, '按 F 切换收藏', { beforeFav, afterFav })

    console.log('\n→ 标签建议与合并弹层…')
    await openTool(win, '标签管理')
    await js(win, `(() => { const sc = document.querySelector('.detail-scroll'); if (sc) sc.scrollTop = 1e6; return true })()`)
    await sleep(500)
    await shot(win, '13-tags-bottom')

    const two = await js(win, `
      (() => {
        const rows = [...document.querySelectorAll('.tm-row')].slice(0, 2)
        for (const r of rows) r.click()
        return rows.length
      })()
    `)
    assert(two === 2, '可以多选标签行', two)
    await shot(win, '13b-tags-selected')

    const mergeBtn = await js(win, `
      (() => {
        const b = [...document.querySelectorAll('.tm-actions .btn')].find(x => x.textContent.includes('合并到'))
        if (b) b.click()
        return !!b
      })()
    `)
    await sleep(300)
    const modalText = await js(win, `(() => { const o = document.querySelector('.overlay'); return o ? o.textContent : '' })()`)
    assert(mergeBtn && modalText.includes('合并到哪个标签'), '打开合并目标弹层')
    await shot(win, '14-tag-merge')
    await press(win, 'Escape')
  } catch (e) {
    console.error('\n❌ 验收异常：', e.message)
    failures++
  }

  console.log('')
  if (failures === 0) console.log('✅ 键盘与面板全部断言通过')
  else console.log(`❌ 有 ${failures} 项断言失败`)

  await sleep(200)
  app.quit()
})
