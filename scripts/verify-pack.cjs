/**
 * 分享包端到端验收：
 *   1. 启动应用（用演示库）
 *   2. 通过真实 IPC 导出一个 .promptpack
 *   3. 解压、校验结构，并把自带的 index.html 渲染出来截图
 *
 * 用法：npx electron scripts/verify-pack.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const OUT = path.resolve('build/shots')
const PACK = path.resolve('.smoke/out/demo.promptpack')
const UNPACK = path.resolve('.smoke/out/unpacked')

fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(path.dirname(PACK), { recursive: true })

app.setPath('userData', path.resolve('.smoke/userdata'))
process.env.PP_EXPORT_TO = PACK

app.on('browser-window-created', (_e, w) => {
  w.webContents.on('console-message', (_ev, level, message, line, source) => {
    if (level >= 2) console.log(`[renderer:${level}] ${message} (${String(source).split('/').pop()}:${line})`)
  })
})

require('../out/main/index.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function shotPage(win, name) {
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG())
  console.log('  ✓ ' + name + '.png')
}

app.whenReady().then(async () => {
  await sleep(2600)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }
  win.setSize(1440, 860)

  try {
    // ── 1. 走真实 IPC 导出整个库
    console.log('→ 导出分享包…')
    const res = await win.webContents.executeJavaScript(`
      (async () => {
        const st = await window.pp.getState()
        return await window.pp.exportPack({
          entryIds: st.data.entries.map(e => e.id),
          includeMedia: true,
          suggestedName: 'demo'
        })
      })()
    `)
    console.log('  ' + JSON.stringify(res))

    if (!res || !res.path) throw new Error('导出没有返回路径')
    const size = fs.statSync(PACK).size
    console.log(`  ✓ 包已生成：${(size / 1024 / 1024).toFixed(2)} MB`)

    // ── 2. 解压并校验结构
    const { unzipSync } = require('fflate')
    const buf = new Uint8Array(fs.readFileSync(PACK))
    const files = unzipSync(buf)
    const names = Object.keys(files)
    console.log('→ 包内文件：')
    for (const n of names.slice(0, 8)) console.log('   ' + n)
    if (names.length > 8) console.log(`   …共 ${names.length} 个条目`)

    for (const must of ['manifest.json', 'data/prompts.json', 'index.html', 'README.txt']) {
      if (!names.includes(must)) throw new Error('缺少必要文件：' + must)
    }
    const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'))
    const payload = JSON.parse(Buffer.from(files['data/prompts.json']).toString('utf8'))
    if (manifest.magic !== 'promptpair.pack') throw new Error('magic 不匹配')
    console.log(
      `  ✓ manifest: magic=${manifest.magic} 格式v${manifest.formatVersion} 记录${manifest.counts.entries} 媒体${manifest.counts.assets}`
    )
    console.log(`  ✓ prompts.json: ${payload.entries.length} 条，首条标题「${payload.entries[0].title}」`)
    console.log(`  ✓ 首条产物数：${payload.entries[0].assets.length}`)

    const mediaCount = names.filter((n) => n.startsWith('media/')).length
    const thumbCount = names.filter((n) => n.startsWith('thumbs/')).length
    console.log(`  ✓ 媒体文件 ${mediaCount} 个，缩略图 ${thumbCount} 个`)

    // ── 3. 真正解压到磁盘，用浏览器打开自带预览页
    fs.rmSync(UNPACK, { recursive: true, force: true })
    for (const [name, data] of Object.entries(files)) {
      const dest = path.join(UNPACK, name)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, Buffer.from(data))
    }
    console.log('  ✓ 已解压到 .smoke/out/unpacked')

    const preview = new BrowserWindow({
      width: 1280,
      height: 860,
      show: false,
      backgroundColor: '#0f1115'
    })
    await preview.loadFile(path.join(UNPACK, 'index.html'))
    await sleep(1500)
    await shotPage(preview, '07-pack-preview')

    // 点开第一张卡片，验证弹层里的提示词与复制按钮
    await preview.webContents.executeJavaScript(`
      (() => { const c = document.querySelector('.card'); if (c) c.click(); return !!c })()
    `)
    await sleep(900)
    await shotPage(preview, '08-pack-preview-detail')

    // 断言预览页确实渲染出了卡片
    const cardCount = await preview.webContents.executeJavaScript(
      `document.querySelectorAll('.card').length`
    )
    console.log(`  ✓ 预览页渲染卡片 ${cardCount} 张`)
    if (cardCount === 0) throw new Error('预览页没有渲染出任何卡片')

    const cardCopy = await preview.webContents.executeJavaScript(
      `document.querySelectorAll('.card-copy').length`
    )
    const hasHint = await preview.webContents.executeJavaScript(`!!document.querySelector('.hint')`)
    const hasCopyAll = await preview.webContents.executeJavaScript(
      `[...document.querySelectorAll('.btn')].some(b => b.textContent.includes('复制全部'))`
    )
    console.log(`  ✓ 卡片复制按钮 ${cardCopy} 个 · 使用提示 ${hasHint ? '有' : '无'} · 复制全部 ${hasCopyAll ? '有' : '无'}`)
    if (!cardCopy || !hasHint || !hasCopyAll) {
      throw new Error('预览页缺少卡片复制按钮 / 提示 / 复制全部')
    }

    preview.destroy()
    console.log('\n✅ 分享包端到端验收通过')
  } catch (e) {
    console.error('\n❌ 验收失败：', e.message)
  }

  await sleep(200)
  app.quit()
})
