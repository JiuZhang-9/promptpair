/**
 * 浏览器采集接收端验收：
 *   1. 启动本地采集服务
 *   2. 用 data URL 模拟插件读取到的 blob/受保护图片，POST 到 /capture
 *   3. 断言记录、提示词、负向词、平台标签、产物都落库
 *   4. 用 blob: 地址模拟插件没读到数据的情况，断言给出人话错误
 *
 * 用法：npx electron scripts/verify-capture.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const LIB = path.resolve('.smoke/lib-capture')
const USERDATA = path.resolve('.smoke/userdata-capture')

fs.rmSync(LIB, { recursive: true, force: true })
fs.mkdirSync(LIB, { recursive: true })
fs.mkdirSync(USERDATA, { recursive: true })
fs.writeFileSync(
  path.join(USERDATA, 'config.json'),
  JSON.stringify({ libraryPath: LIB, theme: 'dark' }, null, 2)
)
app.setPath('userData', USERDATA)

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

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

app.whenReady().then(async () => {
  await sleep(2400)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }

  try {
    const port = await win.webContents.executeJavaScript(
      `window.pp.captureInfo().then(r => r.port)`
    )
    assert(port > 0, '采集服务端口已启动', port)

    console.log('\n→ data URL 采集（模拟 blob / 受保护图片）…')
    const res = await fetch(`http://127.0.0.1:${port}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl: PNG,
        pageUrl: 'https://example.com/p/1',
        pageTitle: '采集测试页',
        promptText: 'a cat, cinematic lighting',
        negativeText: 'blurry, low quality',
        platform: '测试平台'
      })
    })
    const j = await res.json()
    console.log('  ' + JSON.stringify(j))
    assert(j.ok === true, 'data URL 采集成功', j)

    const st = await win.webContents.executeJavaScript('window.pp.getState()')
    const e = st.data.entries[0]
    assert(!!e, '采集生成了记录')
    assert(e.positive === 'a cat, cinematic lighting', '提示词写入', e.positive)
    assert(e.negative === 'blurry, low quality', '负向提示词写入', e.negative)
    assert(e.assetIds.length === 1, '记录挂了 1 个产物', e.assetIds.length)
    const tagNames = e.tagIds
      .map((id) => st.data.tags.find((t) => t.id === id)?.name)
      .filter(Boolean)
    assert(tagNames.includes('测试平台'), '平台标签写入', tagNames)

    console.log('\n→ blob 地址的兜底提示…')
    const badRes = await fetch(`http://127.0.0.1:${port}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl: 'blob:https://example.com/abc',
        pageUrl: 'https://example.com/p/1',
        pageTitle: '采集测试页',
        promptText: 'a cat'
      })
    })
    const bad = await badRes.json()
    console.log('  ' + JSON.stringify(bad))
    assert(bad.ok === false, 'blob 地址采集失败', bad)
    assert(
      /blob|临时地址|受保护/.test(bad.message || ''),
      '失败信息是人话（blob/受保护）',
      bad.message
    )
  } catch (e) {
    console.error('\n❌ 验收异常：', e.message)
    failures++
  }

  console.log('')
  if (failures === 0) console.log('✅ 浏览器采集接收端全部断言通过')
  else console.log(`❌ 有 ${failures} 项断言失败`)

  await sleep(200)
  app.quit()
})
