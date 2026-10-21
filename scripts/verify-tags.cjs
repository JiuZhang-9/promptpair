/**
 * 标签治理端到端验收：
 *   1. 建 4 个标签、3 条记录，把标签挂上去
 *   2. 合并「赛博朋克 / 赛博」→「cyberpunk」
 *   3. 断言引用已替换、来源标签已删、没有孤儿 tagId、其它标签保留
 *   4. 走一遍 AI 写入口（aiApplyTags）：复用已有标签 + 新建标签 + 去重
 *   5. 批量删除标签，断言引用被清理
 *
 * 用法：npx electron scripts/verify-tags.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const LIB = path.resolve('.smoke/lib-tags')
const USERDATA = path.resolve('.smoke/userdata-tags')

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

app.whenReady().then(async () => {
  await sleep(2400)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }

  try {
    fs.rmSync(LIB, { recursive: true, force: true })
    fs.mkdirSync(LIB, { recursive: true })
    await win.webContents.executeJavaScript(`window.pp.switchLibrary(${JSON.stringify(LIB)})`)
    await sleep(500)

    console.log('\n→ 建标签与记录…')
    const tags = await win.webContents.executeJavaScript(`
      (async () => {
        const names = ['赛博朋克', '赛博', 'cyberpunk', '夜景']
        const out = []
        for (const n of names) out.push(await window.pp.createTag(n, ''))
        return out
      })()
    `)
    assert(tags.length === 4, '创建 4 个标签', tags)
    const byName = Object.fromEntries(tags.map((t) => [t.name, t.id]))

    const mkEntry = (title, tagIds) => `
      window.pp.saveEntry({
        title: ${JSON.stringify(title)},
        positive: 'test prompt',
        negative: '',
        note: '',
        rating: 0,
        favorite: false,
        collectionIds: [],
        tagIds: ${JSON.stringify(tagIds)},
        assetIds: [],
        params: {},
        source: {}
      })
    `
    const entries = await win.webContents.executeJavaScript(`
      (async () => {
        const a = await ${mkEntry('A', [byName['赛博朋克'], byName['夜景']])}
        const b = await ${mkEntry('B', [byName['赛博'], byName['夜景']])}
        const c = await ${mkEntry('C', [byName['cyberpunk']])}
        return [a, b, c]
      })()
    `)
    assert(entries.length === 3, '创建 3 条记录', entries.length)
    const [a, b, c] = entries

    console.log('\n→ 合并「赛博朋克 / 赛博」→「cyberpunk」…')
    const merged = await win.webContents.executeJavaScript(`
      window.pp.mergeTags(
        ${JSON.stringify([byName['赛博朋克'], byName['赛博']])},
        ${JSON.stringify(byName['cyberpunk'])}
      )
    `)
    console.log('  ' + JSON.stringify(merged))
    assert(merged.merged === 2, '合并掉 2 个来源标签', merged.merged)
    assert(merged.affectedEntries === 2, '影响 2 条记录', merged.affectedEntries)

    const st = await win.webContents.executeJavaScript('window.pp.getState()')
    const liveTagIds = new Set(st.data.tags.map((t) => t.id))
    assert(!liveTagIds.has(byName['赛博朋克']), '「赛博朋克」已删除')
    assert(!liveTagIds.has(byName['赛博']), '「赛博」已删除')
    assert(liveTagIds.has(byName['cyberpunk']), '目标标签「cyberpunk」保留')

    const ea = st.data.entries.find((e) => e.id === a.id)
    const eb = st.data.entries.find((e) => e.id === b.id)
    const ec = st.data.entries.find((e) => e.id === c.id)
    const targetIdsOf = (e) => e.tagIds.filter((id) => id === byName['cyberpunk'])
    assert(targetIdsOf(ea).length === 1, 'A 的引用转到目标且去重', ea.tagIds)
    assert(targetIdsOf(eb).length === 1, 'B 的引用转到目标且去重', eb.tagIds)
    assert(ea.tagIds.includes(byName['夜景']), 'A 的其它标签保留', ea.tagIds)
    assert(ec.tagIds.includes(byName['cyberpunk']), 'C 的目标标签不受影响', ec.tagIds)
    assert(
      !st.data.entries.some((e) => e.tagIds.some((id) => !liveTagIds.has(id))),
      '库里没有孤儿 tagId'
    )

    console.log('\n→ AI 写入口：复用已有 + 新建 + 去重…')
    const applied = await win.webContents.executeJavaScript(`
      window.pp.aiApplyTags([
        { entryId: ${JSON.stringify(ec.id)}, tags: ['夜景', '人物', '夜景'] }
      ])
    `)
    console.log('  ' + JSON.stringify(applied))
    assert(
      applied.createdTags.length === 1 && applied.createdTags[0] === '人物',
      '只新建 1 个新标签「人物」',
      applied.createdTags
    )
    assert(applied.updatedEntries === 1, '更新 1 条记录', applied.updatedEntries)

    const st2 = await win.webContents.executeJavaScript('window.pp.getState()')
    const ec2 = st2.data.entries.find((e) => e.id === c.id)
    const night = st2.data.tags.find((t) => t.name === '夜景')
    const person = st2.data.tags.find((t) => t.name === '人物')
    assert(!!night && !!person, '新旧标签都存在于库里')
    assert(ec2.tagIds.includes(night.id), '复用了已有标签「夜景」', ec2.tagIds)
    assert(ec2.tagIds.includes(person.id), '写入了新标签「人物」', ec2.tagIds)
    assert(ec2.tagIds.filter((id) => id === night.id).length === 1, '重复候选被去重')

    console.log('\n→ 批量删除标签…')
    const removed = await win.webContents.executeJavaScript(`
      window.pp.deleteTags([${JSON.stringify(person.id)}, ${JSON.stringify(night.id)}])
    `)
    assert(removed.deleted === 2, '批量删除 2 个标签', removed)

    const st3 = await win.webContents.executeJavaScript('window.pp.getState()')
    assert(
      !st3.data.tags.some((t) => t.id === person.id || t.id === night.id),
      '标签已从库里删除'
    )
    assert(
      !st3.data.entries.some((e) => e.tagIds.some((id) => id === person.id || id === night.id)),
      '记录上的引用已清理'
    )
  } catch (e) {
    console.error('\n❌ 验收异常：', e.message)
    failures++
  }

  console.log('')
  if (failures === 0) console.log('✅ 标签治理全部断言通过')
  else console.log(`❌ 有 ${failures} 项断言失败`)

  await sleep(200)
  app.quit()
})
