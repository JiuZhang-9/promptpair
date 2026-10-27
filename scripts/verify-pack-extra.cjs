/**
 * 0.11.0「带得走」验收：静态站点 + 增量分享包。
 *
 * 用法：node scripts/demo-seed.mjs && npx electron scripts/verify-pack-extra.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')
const { unzipSync } = require('fflate')

const OUT = path.resolve('.smoke/out-extra')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
app.setPath('userData', path.resolve('.smoke/userdata-extra'))
fs.mkdirSync(path.resolve('.smoke/userdata-extra'), { recursive: true })
fs.writeFileSync(
  path.resolve('.smoke/userdata-extra/config.json'),
  JSON.stringify({ libraryPath: path.resolve('.smoke/lib'), theme: 'dark' }, null, 2)
)
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
  const js = (code) => win.webContents.executeJavaScript(code, true)
  win.show()
  win.focus()
  win.webContents.focus()

  try {
    const state = await js(`window.pp.getState()`)
    const allIds = state.data.entries.map((e) => e.id)
    assert(allIds.length > 0, '演示库有条目', allIds.length)

    console.log('\n→ 全量包建立基线…')
    const fullPath = path.join(OUT, 'full.promptpack')
    const full = await js(
      `window.pp.exportPack({ entryIds: ${JSON.stringify(allIds)}, includeMedia: true, outPath: ${JSON.stringify(fullPath)} })`
    )
    assert(!!full?.packId && full.mode === 'full', '导出全量包', full)
    const cfg = await js(`window.pp.getConfig()`)
    assert(
      !!cfg.packBaseExportedAt && cfg.packBasePackId === full.packId,
      '全量库导出写下增量基线',
      cfg
    )

    console.log('\n→ 增量包…')
    await sleep(1100)
    const src = state.data.entries[0]
    const draft = { ...src, title: '增量测试条目', id: undefined }
    delete draft.id
    const created = await js(`window.pp.saveEntry(${JSON.stringify(draft)})`)
    assert(!!created.id, '创建一个新条目', created.id)
    const incPath = path.join(OUT, 'incremental.promptpack')
    const inc = await js(
      `window.pp.exportPack({ entryIds: [], includeMedia: true, outPath: ${JSON.stringify(incPath)}, mode: 'incremental' })`
    )
    assert(inc?.mode === 'incremental', '导出增量包', inc)
    assert(inc.entries === 1, '增量包只含 1 条新增/修改', inc?.entries)

    const unzipped = unzipSync(fs.readFileSync(incPath))
    const manifest = JSON.parse(Buffer.from(unzipped['manifest.json']).toString('utf8'))
    const payload = JSON.parse(Buffer.from(unzipped['data/prompts.json']).toString('utf8'))
    assert(manifest.mode === 'incremental' && manifest.basePackId === full.packId, '增量 manifest 带基线', manifest)
    assert(payload.entries.length === 1 && payload.entries[0].title === '增量测试条目', '增量 payload 正确', payload.entries.map((e) => e.title))

    console.log('\n→ 静态站点…')
    await js(`window.pp.repairAssets()`)
    await sleep(800)
    const siteDir = path.join(OUT, 'site')
    const site = await js(
      `window.pp.exportSite({ entryIds: ${JSON.stringify(allIds)}, outPath: ${JSON.stringify(siteDir)} })`
    )
    assert(!!site && site.entries >= 1, '导出静态站点', site)
    for (const rel of ['index.html', 'README.txt', 'data/prompts.json']) {
      assert(fs.existsSync(path.join(siteDir, rel)), `包含 ${rel}`)
    }
    const mediaCount = fs.existsSync(path.join(siteDir, 'media'))
      ? fs.readdirSync(path.join(siteDir, 'media')).length
      : 0
    assert(mediaCount > 0, '站点包含 media 目录', mediaCount)
    const thumbCount = fs.existsSync(path.join(siteDir, 'thumbs'))
      ? fs.readdirSync(path.join(siteDir, 'thumbs')).length
      : 0
    assert(thumbCount > 0, '站点包含 thumbs 目录', thumbCount)

    const preview = new BrowserWindow({ show: false, width: 1200, height: 900 })
    await preview.loadFile(path.join(siteDir, 'index.html'))
    await sleep(700)
    const cards = await preview.webContents.executeJavaScript(`document.querySelectorAll('.card').length`)
    const copyButtons = await preview.webContents.executeJavaScript(
      `document.querySelectorAll('.card-copy').length`
    )
    console.log('  ', { cards, copyButtons })
    assert(cards === allIds.length, '静态站点卡片数量正确', cards)
    assert(copyButtons === allIds.length, '静态站点卡片可直接复制', copyButtons)
    preview.destroy()

    console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ 带得走全部断言通过')
  } catch (e) {
    console.error('\n✗ 验收异常:', e)
    failures++
  } finally {
    win.destroy()
    app.quit()
  }
})
