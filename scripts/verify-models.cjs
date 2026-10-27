/**
 * 模型词表端到端验收（0.8.0）：
 *   1. 建库即带默认词表；重复名字被拒绝
 *   2. 建两条记录（即梦3.0 / 即梦 3.0），合并来源模型并断言历史值同步
 *   3. 重命名模型并同步历史；删除模型不影响历史字符串
 *   4. 未入词表的模型出现在侧栏筛选（重载后验证 DOM）
 *   5. 编辑器模型选择器：输入过滤、点选、新建入表
 *   6. 恢复默认词表：自定义模型移除，条目字符串保留
 *
 * 用法：npm run build && npx electron scripts/verify-models.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const LIB = path.resolve('.smoke/lib-models')
const USERDATA = path.resolve('.smoke/userdata-models')

fs.mkdirSync(USERDATA, { recursive: true })
fs.writeFileSync(
  path.join(USERDATA, 'config.json'),
  JSON.stringify({ libraryPath: LIB, theme: 'dark' }, null, 2)
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

const draft = (title, model) => ({
  title,
  positive: 'model vocabulary test',
  negative: '',
  note: '',
  rating: 0,
  favorite: false,
  collectionIds: [],
  tagIds: [],
  assetIds: [],
  params: { model },
  source: {}
})

app.whenReady().then(async () => {
  await sleep(2400)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }
  const js = (code) => win.webContents.executeJavaScript(code)

  async function openTool(label) {
    const opened = await js(`(() => {
      const t = [...document.querySelectorAll('.tb-actions .dd-trigger')].find(x => x.textContent.trim().startsWith('工具'))
      if (!t) return false
      t.click()
      return true
    })()`)
    await sleep(140)
    const clicked = await js(`(() => {
      const b = [...document.querySelectorAll('.dd-menu .dd-item')].find(x => x.textContent.includes(${JSON.stringify(label)}))
      if (b) b.click()
      return !!b
    })()`)
    await sleep(350)
    return opened && clicked
  }

  try {
    fs.rmSync(LIB, { recursive: true, force: true })
    fs.mkdirSync(LIB, { recursive: true })
    await js(`window.pp.switchLibrary(${JSON.stringify(LIB)})`)
    await sleep(500)

    console.log('\n→ 默认词表…')
    let st = await js('window.pp.getState()')
    const seedCount = st.data.models?.length ?? 0
    assert(seedCount >= 10, '新库自带默认模型词表', seedCount)
    assert(
      st.data.models.some((m) => m.name === '即梦 3.0' && m.kind === 'video'),
      '默认词表含「即梦 3.0」（视频）'
    )

    console.log('\n→ 新建与查重…')
    const main = st.data.models.find((m) => m.name === '即梦 3.0')
    assert(!!main?.id, '默认词表里已有「即梦 3.0」', main)
    const dup = await js(`window.pp.createModel('即梦3.0', 'video')`)
    assert(!!dup.id && dup.name === '即梦3.0', '「即梦3.0」可作为近似写法存在（待治理）', dup)
    const dupErr = await js(
      `window.pp.createModel('即梦 3.0', 'video').then(() => '').catch(e => String(e))`
    )
    assert(/已存在|已在词表/.test(dupErr), '同名（去空格后相同）被拒绝', dupErr)

    console.log('\n→ 英文名称与版本判重…')
    const stable = await js(`window.pp.createModel('stable-test', 'image')`)
    assert(stable.name === 'stable-test', '英文 s 开头名称保留首字符', stable.name)
    const v4 = await js(`window.pp.createModel('即梦 4.0', 'video')`)
    assert(v4.name === '即梦 4.0', '新建即梦 4.0')
    // createModel 走的是主进程 IPC，重载后 store 才能拿到新词表
    win.webContents.reload()
    await sleep(2400)
    const openedModels = await openTool('模型管理')
    assert(openedModels, '顶栏工具菜单打开模型管理')
    await sleep(500)
    const sugNames = await js(`
      Array.from(document.querySelectorAll('.tm-sug-names')).map(x => x.textContent.trim())
    `)
    const badSuggestion = sugNames.some((t) => t.includes('即梦 3.0') && t.includes('即梦 4.0'))
    assert(!badSuggestion, '即梦 3.0 / 4.0 不再提示重复', sugNames.slice(0, 6))

    const dbl = await js(`
      (() => {
        const el = [...document.querySelectorAll('.tm-name')].find(x => x.textContent.trim() === '即梦 4.0')
        if (!el) return false
        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        return true
      })()
    `)
    await sleep(200)
    const renameValue = await js(`document.querySelector('.tm-rename')?.value || ''`)
    assert(dbl && renameValue === '即梦 4.0', '双击模型名进入重命名', renameValue)
    await js(`document.querySelector('.tm-rename')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(200)
    await js(`document.querySelector('.right-dock .detail-head .icon-btn')?.click()`)
    await sleep(300)

    console.log('\n→ 条目与合并…')
    const entryA = await js(`window.pp.saveEntry(${JSON.stringify(draft('记录A', '即梦3.0'))})`)
    const entryB = await js(`window.pp.saveEntry(${JSON.stringify(draft('记录B', '即梦 3.0'))})`)
    assert(!!entryA.id && !!entryB.id, '两条记录已创建')
    const merged = await js(`window.pp.mergeModels(${JSON.stringify([dup.id])}, '${main.id}', true)`)
    assert(merged.merged === 1 && merged.affectedEntries === 1, '合并 1 个模型并同步 1 条记录', merged)
    st = await js('window.pp.getState()')
    const a1 = st.data.entries.find((e) => e.title === '记录A')
    assert(a1.params.model === '即梦 3.0', '记录A 的历史值已同步为目标名', a1.params.model)
    assert(!st.data.models.some((m) => m.name === '即梦3.0'), '来源模型已从词表移除')

    console.log('\n→ 重命名并同步历史…')
    const ren = await js(`window.pp.updateModel('${main.id}', { name: '即梦 3.1' }, true)`)
    assert(ren.affectedEntries === 2, '两条历史记录同步改名', ren)
    st = await js('window.pp.getState()')
    const renamed = st.data.models.find((m) => m.id === main.id)
    assert(renamed.name === '即梦 3.1', '词表名称已更新', renamed.name)
    assert(
      st.data.entries.filter((e) => e.params.model === '即梦 3.1').length === 2,
      '两条记录都是新名字'
    )

    console.log('\n→ 删除词表条目（不动历史字符串）…')
    st = await js('window.pp.getState()')
    const sdxl = st.data.models.find((m) => m.name === 'SDXL')
    await js(`window.pp.deleteModel('${sdxl.id}')`)
    st = await js('window.pp.getState()')
    assert(!st.data.models.some((m) => m.id === sdxl.id), 'SDXL 已从词表删除')

    // 造一个未入词表的历史值，验证侧栏筛选与「未入词表」治理
    await js(`window.pp.saveEntry(${JSON.stringify(draft('记录C', 'MJ v6'))})`)
    win.webContents.reload()
    await sleep(2600)

    console.log('\n→ 侧栏模型筛选（重载后 DOM）…')
    const chips = await js(`
      Array.from(document.querySelectorAll('.tagchip')).map(b => b.textContent.trim())
    `)
    assert(chips.some((t) => t.includes('即梦 3.1')), '侧栏出现词表内模型', chips)
    assert(chips.some((t) => t.includes('MJ v6')), '侧栏出现未入词表的历史值', chips)
    const clicked = await js(`
      (() => {
        const b = Array.from(document.querySelectorAll('.tagchip')).find(x => x.textContent.includes('即梦 3.1'))
        if (!b) return false
        b.click()
        return true
      })()
    `)
    assert(clicked, '点击模型 chip')
    await sleep(400)
    const cards = await js(`document.querySelectorAll('.card').length`)
    assert(cards === 2, '筛选后只剩两条（记录A/B）', cards)

    console.log('\n→ 编辑器模型选择器…')
    await js(`document.querySelector('.tagchip.on')?.click()`)
    await sleep(300)
    await js(`
      (() => {
        const card = document.querySelector('.card')
        card?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      })()
    `)
    await sleep(600)
    const opened = await js(`!!document.querySelector('.modelpicker input')`)
    assert(opened, '编辑器已打开且模型字段是选择器')
    await js(`
      (() => {
        const input = document.querySelector('.modelpicker input')
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, '即')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()
    `)
    await sleep(300)
    const menuItems = await js(`document.querySelectorAll('.modelpicker .tp-menu .tp-item').length`)
    assert(menuItems > 0, '输入「即」后下拉出现候选', menuItems)
    await js(`document.querySelector('.modelpicker .tp-menu .tp-item')?.click()`)
    await sleep(200)
    const picked = await js(`document.querySelector('.modelpicker input').value`)
    assert(picked === '即梦 3.1', '点选候选后填入模型名', picked)

    await js(`
      (() => {
        const input = document.querySelector('.modelpicker input')
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, '测试模型X')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()
    `)
    await sleep(250)
    const canCreate = await js(`!!document.querySelector('.modelpicker .tp-create')`)
    assert(canCreate, '输入新名字出现「新建」入口')
    await js(`document.querySelector('.modelpicker .tp-create')?.click()`)
    await sleep(600)
    st = await js('window.pp.getState()')
    assert(
      st.data.models.some((m) => m.name === '测试模型X'),
      '新名字自动加入词表'
    )
    await js(`document.querySelector('[title="关闭 (Esc)"]')?.click()`)
    await sleep(200)

    console.log('\n→ 恢复默认词表…')
    await js(`window.pp.resetModels()`)
    await sleep(300)
    st = await js('window.pp.getState()')
    assert(!st.data.models.some((m) => m.name === '测试模型X'), '自定义模型已移除')
    assert(
      st.data.models.some((m) => m.name === '即梦 3.0'),
      '默认词表恢复（含即梦 3.0）'
    )
    assert(
      st.data.entries.some((e) => e.params.model === '即梦 3.1'),
      '条目上的历史字符串保持原样'
    )
  } catch (e) {
    console.error('\n❌ 验收异常：', e.message)
    failures++
  }

  console.log('')
  if (failures === 0) console.log('✅ 模型词表全部断言通过')
  else console.log(`❌ 有 ${failures} 项断言失败`)

  await sleep(200)
  app.quit()
})
