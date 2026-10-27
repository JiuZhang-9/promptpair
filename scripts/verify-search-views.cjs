/**
 * 0.10.0「找得到」验收：
 *   1. schema v1 → v2 迁移，views 数组存在
 *   2. 查询语法：tag / model / rating / is，错误提示入口
 *   3. 保存视图：保存当前筛选、侧栏应用、删除
 *   4. 相似图：修复指纹后，从详情找相似，结果 chip 可清除
 *
 * 用法：node scripts/demo-seed.mjs && npx electron scripts/verify-search-views.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const LIB = path.resolve('.smoke/lib')
const USERDATA = path.resolve('.smoke/userdata-search')
fs.mkdirSync(USERDATA, { recursive: true })
fs.writeFileSync(
  path.join(USERDATA, 'config.json'),
  JSON.stringify({ libraryPath: LIB, theme: 'dark', thumbSize: 200, uiScale: 1 }, null, 2)
)
app.setPath('userData', USERDATA)
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

  const setSearch = async (text) => {
    await js(`(() => {
      const el = document.querySelector('.search input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(el, ${JSON.stringify(text)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await sleep(350)
  }
  const count = () => js(`parseInt(document.querySelector('.count-chip').textContent, 10)`)

  try {
    console.log('\n→ schema 迁移…')
    const schema = await js(`window.pp.getState().then(s => ({ version: s.data.schemaVersion, views: Array.isArray(s.data.views) }))`)
    assert(schema.version === 2 && schema.views === true, '库迁移到 schema v2，views 已存在', schema)

    console.log('\n→ 查询语法…')
    const data = await js(`window.pp.getState().then(s => s.data)`)
    const tagEntry = data.entries.find((e) => e.tagIds.length > 0)
    const tagId = tagEntry.tagIds[0]
    const tagName = data.tags.find((t) => t.id === tagId).name
    const expectedTag = data.entries.filter((e) =>
      e.tagIds.some((tid) => data.tags.find((t) => t.id === tid)?.name === tagName)
    ).length
    await setSearch(`tag:${tagName}`)
    assert((await count()) === expectedTag, `tag:${tagName} 过滤`, { got: await count(), expectedTag })

    const expectedFav = data.entries.filter((e) => e.favorite).length
    await setSearch('is:favorite')
    assert((await count()) === expectedFav, 'is:favorite 过滤', { got: await count(), expectedFav })

    const expectedRating = data.entries.filter((e) => e.rating >= 4).length
    await setSearch('rating:>=4')
    assert((await count()) === expectedRating, 'rating:>=4 过滤', { got: await count(), expectedRating })

    const modelName = tagEntry.params?.model || ''
    if (modelName) {
      const expectedModel = data.entries.filter((e) =>
        (e.params?.model || '').toLowerCase().includes(modelName.toLowerCase())
      ).length
      await setSearch(`model:${modelName}`)
      assert((await count()) === expectedModel, `model:${modelName} 过滤`, { got: await count(), expectedModel })
    }

    await setSearch('rating:9')
    assert(
      await js(`!!document.querySelector('.search-syntax.err')`),
      '非法 rating 显示错误入口'
    )
    await js(`document.querySelector('.search-syntax.err')?.click()`)
    await sleep(300)
    assert(
      await js(`!!document.querySelector('.overlay') && document.querySelector('.overlay').textContent.includes('搜索语法')`),
      '打开搜索语法帮助'
    )
    await js(`document.querySelector('.overlay')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(200)

    console.log('\n→ 保存视图…')
    await setSearch(`tag:${tagName}`)
    await js(`(() => { window.prompt = () => '测试视图'; return true })()`)
    await js(`(() => {
      const sec = [...document.querySelectorAll('.sb-section')].find(s => (s.querySelector('.sb-title')?.textContent || '').trim() === '视图')
      const b = sec && sec.querySelector('.sb-head .icon-btn')
      if (b) b.click()
      return !!b
    })()`)
    await sleep(700)
    let views = await js(`window.pp.getState().then(s => s.data.views || [])`)
    const view = views.find((v) => v.name === '测试视图')
    assert(!!view && view.q.includes(`tag:${tagName}`), '保存当前搜索/筛选为视图', view)

    await setSearch('')
    await js(`(() => {
      const el = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.trim().includes('测试视图'))
      if (el) el.click()
      return !!el
    })()`)
    await sleep(400)
    const applied = await js(`document.querySelector('.search input').value`)
    assert(applied.includes(`tag:${tagName}`), '点击视图恢复搜索', applied)

    await js(`(() => { window.confirm = () => true; return true })()`)
    await js(`(() => {
      const row = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.trim().includes('测试视图'))
      const b = row && row.querySelector('.row-del')
      if (b) b.click()
      return !!b
    })()`)
    await sleep(600)
    views = await js(`window.pp.getState().then(s => s.data.views || [])`)
    assert(!views.some((v) => v.name === '测试视图'), '删除视图')

    console.log('\n→ 相似图…')
    await setSearch('')
    const repaired = await js(`window.pp.repairAssets()`)
    assert(repaired && repaired.fixed >= 0, '修复资源指纹', repaired)
    await sleep(600)
    const original = await js(`window.pp.getState().then(s => s.data.entries.find(e => e.assetIds.length > 0))`)
    const dup = await js(`(() => {
      const src = ${JSON.stringify(original)}
      const draft = {...src, title: '相似测试副本', id: undefined}
      delete draft.id
      return window.pp.saveEntry(draft)
    })()`)
    assert(!!dup.id, '创建同资产副本')
    win.webContents.reload()
    await sleep(2400)
    await js(`document.querySelector('.card[data-id="${original.id}"]')?.click()`)
    await sleep(400)
    const similarBtn = await js(`(() => {
      const b = document.querySelector('.right-dock [title="找相似图"]')
      if (b) b.click()
      return !!b
    })()`)
    await sleep(500)
    const sim = await js(`(() => ({
      chip: !!document.querySelector('.sim-chip'),
      cards: document.querySelectorAll('.card').length,
      detail: !!document.querySelector('.right-dock.open .detail')
    }))()`)
    console.log('  ', sim)
    assert(similarBtn && sim.chip, '详情「找相似」显示相似图筛选')
    assert(sim.cards >= 1, '相似图结果至少 1 条', sim.cards)
    assert(sim.detail === false, '找相似后收起详情')
    await js(`document.querySelector('.sim-chip')?.click()`)
    await sleep(300)
    assert(!(await js(`!!document.querySelector('.sim-chip')`)), '清除相似图筛选')

    console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ 找得到全部断言通过')
  } catch (e) {
    console.error('\n✗ 验收异常:', e)
    failures++
  } finally {
    win.destroy()
    app.quit()
  }
})
