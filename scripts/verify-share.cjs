/**
 * 0.5.0 单页 HTML 分享验收：
 *   1. 通过真实 IPC 导出单页 HTML（缩略图模式，不弹保存框）
 *   2. 断言文件存在、内嵌 data URL、卡片复制 / 复制全部按钮都在
 *   3. 用浏览器打开这个 HTML，断言卡片渲染、点卡片出详情、卡片复制进剪贴板
 *
 * 用法：npx electron scripts/verify-share.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow, clipboard } = require('electron')

const OUT = path.resolve('.smoke/out/demo-single.html')
fs.mkdirSync(path.dirname(OUT), { recursive: true })
process.env.PP_EXPORT_HTML_TO = OUT
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

app.whenReady().then(async () => {
  await sleep(2400)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }

  let preview = null
  try {
    const st = await win.webContents.executeJavaScript('window.pp.getState()')
    const entries = st.data.entries
    const positive = entries[0].positive
    assert(entries.length > 0, '演示库有记录', entries.length)

    console.log('\n→ 导出单页 HTML…')
    const r = await win.webContents.executeJavaScript(`
      window.pp.exportHtml({
        entryIds: ${JSON.stringify(entries.map((e) => e.id))},
        embed: 'thumb',
        suggestedName: 'demo-single'
      })
    `)
    console.log('  ' + JSON.stringify(r))
    assert(!!r && r.entries === entries.length, '导出条目数正确', r)
    assert(fs.existsSync(OUT), 'HTML 文件已生成', OUT)

    const html = fs.readFileSync(OUT, 'utf8')
    assert(html.includes('id="pp-data"'), '页面包含内嵌数据')
    assert(html.includes('data:image/'), '图片以 data URL 内嵌')
    assert(html.includes('card-copy'), '包含卡片级复制按钮')
    assert(html.includes('复制全部'), '包含复制全部')

    console.log('\n→ 在浏览器里打开…')
    preview = new BrowserWindow({
      width: 1280,
      height: 860,
      show: false,
      backgroundColor: '#0f1115',
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    })
    await preview.loadFile(OUT)
    await sleep(900)

    const count = await preview.webContents.executeJavaScript(
      `document.querySelectorAll('.card').length`
    )
    assert(count === entries.length, '预览页渲染全部卡片', count)

    preview.show()
    preview.focus()
    preview.webContents.focus()
    await sleep(250)
    clipboard.writeText('sentinel')
    const clicked = await preview.webContents.executeJavaScript(`
      (() => {
        const b = document.querySelector('.card-copy')
        if (b) b.click()
        return !!b
      })()
    `)
    await sleep(350)
    assert(
      clicked && clipboard.readText() === positive,
      '卡片复制提示词写入剪贴板',
      clipboard.readText()
    )

    await preview.webContents.executeJavaScript(`
      (() => { const c = document.querySelector('.card'); if (c) c.click(); return !!c })()
    `)
    await sleep(400)
    const modalOpen = await preview.webContents.executeJavaScript(
      `document.querySelector('#modal').classList.contains('on')`
    )
    assert(modalOpen, '点卡片打开详情')

    const hasCopyAll = await preview.webContents.executeJavaScript(
      `[...document.querySelectorAll('#info .btn')].some(b => b.textContent.includes('复制全部'))`
    )
    assert(hasCopyAll, '详情里有复制全部')
  } catch (e) {
    console.error('\n❌ 验收异常：', e.message)
    failures++
  }

  if (preview) preview.destroy()
  console.log('')
  if (failures === 0) console.log('✅ 单页 HTML 分享全部断言通过')
  else console.log(`❌ 有 ${failures} 项断言失败`)

  await sleep(200)
  app.quit()
})
