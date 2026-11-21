/**
 * 0.15.0 验收：
 *   纯提示词文字卡片 / 文字查看器、T2I-I2I 任务筛选与查询、编辑器/查看器任务切换、
 *   模型能力标注（MJ 垫图/风格码）、schema v3 迁移、分享包保留 task/capabilities。
 *
 * 用法：node scripts/demo-seed.mjs && npm run build && npx electron scripts/verify-015.cjs
 * 只改 .smoke/lib（演示库），不碰真实素材库。
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const OUT = path.resolve('build/shots-015')
const LIB = path.resolve('.smoke/lib/library.json')
const UD = path.resolve('.smoke/userdata')
const PACK = path.join(OUT, '015.promptpack')
const TEXT_ID = 'test015text000001'
const I2I_ID = 'test015i2i0000002'
const INFER_ID = 'test015infer00003'
const T2I_ID = 'test015t2i00000004'
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(UD, { recursive: true })

/* ── 夹具：文字记录 / 显式 i2i / 无 task 但提示词含「参考图」（迁移推断）/ 显式 t2i ── */
if (!fs.existsSync(LIB)) {
  console.error('✗ 找不到 .smoke/lib，请先运行：node scripts/demo-seed.mjs')
  process.exit(1)
}
const lib = JSON.parse(fs.readFileSync(LIB, 'utf8'))
const base3 = lib.entries.find((e) => e.assetIds.length >= 3)
const base2 = lib.entries.find((e) => e.assetIds.length >= 2 && e.id !== base3?.id)
if (!base3 || !base2) {
  console.error('✗ 演示库条目不足，请重新运行：node scripts/demo-seed.mjs')
  process.exit(1)
}
const now = Date.now()
const iso = (n) => new Date(now - n).toISOString()
const clone = (e) => JSON.parse(JSON.stringify(e))
const tags = base3.tagIds
const colls = base3.collectionIds
const textEntry = {
  ...clone(base3),
  id: TEXT_ID,
  originId: 'test015:text',
  title: '纯提示词 · 电影感夜景',
  positive:
    'cinematic night street in the rain, wet asphalt, neon signs in teal and warm amber, a lone figure with a transparent umbrella, reflections, 35mm anamorphic, shallow depth of field, soft volumetric haze, quiet melancholy',
  negative: '',
  note: '没有配图，只有提示词。用来验证文字卡片。',
  task: 't2i',
  rating: 4,
  favorite: false,
  assetIds: [],
  params: { model: 'Midjourney', extra: {} },
  tagIds: tags,
  collectionIds: colls,
  createdAt: iso(0),
  updatedAt: iso(0)
}
const i2iEntry = {
  ...clone(base3),
  id: I2I_ID,
  originId: 'test015:i2i',
  title: '图生图 · 参考图改图',
  positive:
    '基于参考图中的女孩，保持面部、发型和服装不变，把场景换成雪夜霓虹街头；参考图的光比保留，背景虚化，电影感色调。',
  note: '显式标成图生图。',
  task: 'i2i',
  rating: 5,
  favorite: true,
  assetIds: [...base3.assetIds],
  params: { model: 'Midjourney', extra: { reference: '参考图 1' } },
  tagIds: tags,
  collectionIds: colls,
  createdAt: iso(1000),
  updatedAt: iso(1000)
}
const inferEntry = {
  ...clone(base2),
  id: INFER_ID,
  originId: 'test015:infer',
  title: '迁移推断 · 参考图换装',
  positive: '参考图中的女孩，换成红色外套，站在雪地里，保持人物身份和发型。',
  note: '故意不写 task，迁移应从「参考图」推断为 i2i。',
  // 不写 task
  rating: 3,
  favorite: false,
  assetIds: [...base2.assetIds],
  params: { model: 'Seedream' },
  tagIds: tags,
  collectionIds: colls,
  createdAt: iso(2000),
  updatedAt: iso(2000)
}
const t2iEntry = {
  ...clone(base2),
  id: T2I_ID,
  originId: 'test015:t2i',
  title: '文生图 · 标准提示词',
  positive: 'a quiet mountain lake at dawn, mist, pine forest, soft pink light, minimalist',
  note: '显式标成文生图。',
  task: 't2i',
  rating: 2,
  favorite: false,
  assetIds: [...base2.assetIds],
  params: { model: 'Midjourney' },
  tagIds: tags,
  collectionIds: colls,
  createdAt: iso(3000),
  updatedAt: iso(3000)
}
lib.entries = [
  textEntry,
  i2iEntry,
  inferEntry,
  t2iEntry,
  ...lib.entries.filter((e) => ![TEXT_ID, I2I_ID, INFER_ID, T2I_ID].includes(e.id))
]
fs.writeFileSync(LIB, JSON.stringify(lib, null, 2))
console.log('夹具：', { text: TEXT_ID, i2i: I2I_ID, infer: INFER_ID, t2i: T2I_ID })

app.setPath('userData', UD)
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2 && !message.includes('Security Warning')) {
      console.log(`[renderer] ${message} (${String(source).split('/').pop()}:${line})`)
      rendererErrors.push(message)
    }
  })
  w.webContents.on('render-process-gone', (_e, d) => console.log('[gone]', JSON.stringify(d)))
})
require('../out/main/index.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const rendererErrors = []
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
    await sleep(450)
  } else {
    await sleep(350)
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
  await sleep(300)
}
const entryState = (win, id) =>
  js(win, `window.pp.getState().then(s => s.data.entries.find(e => e.id === ${JSON.stringify(id)}))`)

app.whenReady().then(async () => {
  await sleep(2400)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    app.quit()
    return
  }
  win.setSize(1440, 860)
  try {
    win.webContents.setBackgroundThrottling(false)
  } catch {
    /* ignore */
  }
  win.setAlwaysOnTop(true)
  win.show()
  win.focus()
  await sleep(900)

  try {
    console.log('\n→ schema v3 迁移…')
    const snap = await js(win, `window.pp.getState()`)
    const byId = (id) => snap.data.entries.find((e) => e.id === id)
    assert(snap.data.schemaVersion >= 3, '库结构升到 v3', snap.data.schemaVersion)
    assert(byId(TEXT_ID)?.task === 't2i', '显式 task 保留（t2i）', byId(TEXT_ID)?.task)
    assert(byId(I2I_ID)?.task === 'i2i', '显式 task 保留（i2i）', byId(I2I_ID)?.task)
    assert(byId(INFER_ID)?.task === 'i2i', '含「参考图」的老条目迁移为 i2i', byId(INFER_ID)?.task)
    assert(byId(T2I_ID)?.task === 't2i', '默认/显式 t2i 保留', byId(T2I_ID)?.task)
    const mj = snap.data.models.find((m) => m.name === 'Midjourney')
    const sd = snap.data.models.find((m) => m.name === 'Seedream')
    assert(mj?.capabilities?.imagePrompt === true, 'Midjourney 标注支持垫图', mj?.capabilities)
    assert(mj?.capabilities?.styleRef === true, 'Midjourney 标注支持风格码', mj?.capabilities)
    assert(sd?.capabilities?.imagePrompt === false, 'Seedream 不标注垫图', sd?.capabilities)

    console.log('\n→ 纯提示词文字卡片 + 任务徽标…')
    const cards = await js(
      win,
      `(() => {
        const text = document.querySelector('.card[data-id="${TEXT_ID}"]')
        const i2i = document.querySelector('.card[data-id="${I2I_ID}"]')
        const t2i = document.querySelector('.card[data-id="${T2I_ID}"]')
        return {
          textCard: !!text && text.classList.contains('text-card'),
          textPrompt: text?.querySelector('.text-cover-prompt')?.textContent?.slice(0, 30),
          textBadge: text?.querySelector('.badge.task')?.textContent?.trim(),
          i2iBadge: i2i?.querySelector('.badge.task')?.textContent?.trim(),
          i2iClass: i2i?.querySelector('.badge.task')?.className,
          t2iBadge: t2i?.querySelector('.badge.task')?.textContent?.trim(),
          sideHint: [...document.querySelectorAll('.sb-hint')].map(x => x.textContent).find(x => x.includes('图生图'))
        }
      })()`
    )
    assert(cards.textCard, '无产物条目渲染成文字卡片', cards)
    assert((cards.textPrompt || '').includes('cinematic night street'), '文字卡片显示提示词正文', cards.textPrompt)
    assert(cards.textBadge === '文生图', '文字卡片文生图徽标', cards.textBadge)
    assert(cards.i2iBadge === '图生图' && /i2i/.test(cards.i2iClass || ''), '图生图徽标高亮', cards)
    assert(cards.t2iBadge === '文生图', '普通卡片也有文生图徽标', cards.t2iBadge)
    assert((cards.sideHint || '').includes('文生图'), '侧栏显示任务计数', cards.sideHint)
    await shot(win, '01-text-card')

    console.log('\n→ 文字查看器…')
    await js(win, `document.querySelector('.card[data-id="${TEXT_ID}"]')?.click()`)
    await sleep(700)
    const textView = await js(
      win,
      `(() => ({
        viewer: !!document.querySelector('.viewer'),
        textCard: !!document.querySelector('.v-text-card'),
        body: document.querySelector('.v-text-body')?.textContent?.slice(0, 30),
        foot: document.querySelector('.v-text-foot')?.textContent || ''
      }))()`
    )
    assert(textView.viewer && textView.textCard, '单击文字卡片打开文字查看器', textView)
    assert((textView.body || '').includes('cinematic night street'), '文字查看器显示正文', textView.body)
    assert(textView.foot.includes('纯提示词'), '文字查看器标注纯提示词', textView.foot)
    await shot(win, '02-text-viewer')
    await js(win, `document.querySelector('.v-text-body')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`)
    await sleep(200)
    assert(await js(win, `!!document.querySelector('.v-text-card')`), '点文字正文不会关闭')
    await js(win, `document.querySelector('.v-stage')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }))`)
    await sleep(320)
    assert(await js(win, `!document.querySelector('.viewer')`), '点文字区域外背景关闭')

    console.log('\n→ 任务筛选 / 查询…')
    await js(win, `document.querySelector('.sb-scroll [data-task="i2i"]')?.click()`)
    await sleep(320)
    const filtered = await js(
      win,
      `(() => ({
        text: !!document.querySelector('.card[data-id="${TEXT_ID}"]'),
        i2i: !!document.querySelector('.card[data-id="${I2I_ID}"]'),
        infer: !!document.querySelector('.card[data-id="${INFER_ID}"]'),
        active: document.querySelector('.sb-scroll [data-task="i2i"]')?.classList.contains('on')
      }))()`
    )
    assert(filtered.active, '侧栏图生图筛选选中', filtered)
    assert(!filtered.text && filtered.i2i && filtered.infer, '图生图筛选只保留 i2i 条目', filtered)
    await shot(win, '03-i2i-filter')
    await js(win, `document.querySelector('.sb-scroll [data-task="all"]')?.click()`)
    await sleep(260)
    await setSearch(win, 'task:t2i')
    let q = await js(win, `(() => ({ text: !!document.querySelector('.card[data-id="${TEXT_ID}"]'), i2i: !!document.querySelector('.card[data-id="${I2I_ID}"]') }))()`)
    assert(q.text && !q.i2i, 'task:t2i 查询生效', q)
    await setSearch(win, 'task:i2i')
    q = await js(win, `(() => ({ text: !!document.querySelector('.card[data-id="${TEXT_ID}"]'), i2i: !!document.querySelector('.card[data-id="${I2I_ID}"]') }))()`)
    assert(!q.text && q.i2i, 'task:i2i 查询生效', q)
    await setSearch(win, '')

    console.log('\n→ 编辑器 / 查看器切换任务 + 模型能力…')
    await js(
      win,
      `(() => {
        const card = document.querySelector('.card[data-id="${I2I_ID}"]')
        card?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }))
        return !!card
      })()`
    )
    await sleep(700)
    const ed = await js(
      win,
      `(() => ({
        screen: !!document.querySelector('.es-screen'),
        task: document.querySelector('.es-task-row .task-opt.on')?.textContent?.trim(),
        caps: [...document.querySelectorAll('.es-basics ~ .model-caps .cap-chip, .es-sec .model-caps .cap-chip')].map(x => x.textContent.trim()),
        pad: document.querySelector('.cap-chip.imagePrompt')?.textContent?.trim(),
        style: document.querySelector('.cap-chip.styleRef')?.textContent?.trim()
      }))()`
    )
    assert(ed.screen, '打开编辑器', ed)
    assert(ed.task === '图生图', '编辑器任务为图生图', ed.task)
    assert(ed.pad === '垫图' && ed.style === '风格码', 'Midjourney 能力 chip 垫图/风格码', ed)
    await shot(win, '04-editor-task-caps')
    await js(win, `document.querySelector('.es-task-row [data-task="t2i"]')?.click()`)
    await sleep(200)
    assert(
      (await js(win, `document.querySelector('.es-task-row .task-opt.on')?.textContent?.trim()`)) === '文生图',
      '编辑器切到文生图'
    )
    await js(win, `document.querySelector('.es-top .btn.primary')?.click()`)
    await sleep(700)
    assert((await entryState(win, I2I_ID))?.task === 't2i', '编辑器保存 task=t2i', (await entryState(win, I2I_ID))?.task)
    assert(
      (await js(win, `document.querySelector('.card[data-id="${I2I_ID}"] .badge.task')?.textContent?.trim()`)) === '文生图',
      '卡片任务徽标跟随保存更新'
    )

    await js(win, `document.querySelector('.card[data-id="${INFER_ID}"]')?.click()`)
    await sleep(700)
    const v = await js(
      win,
      `(() => ({
        viewer: !!document.querySelector('.viewer'),
        task: document.querySelector('.v-task-row .task-opt.on')?.textContent?.trim(),
        caps: [...document.querySelectorAll('.v-sec .model-caps .cap-chip')].map(x => x.textContent.trim()),
        mjPad: !!document.querySelector('.v-sec .cap-chip.imagePrompt')
      }))()`
    )
    assert(v.viewer, '打开查看器', v)
    assert(v.task === '图生图', '查看器任务为图生图', v.task)
    assert(!v.mjPad, 'Seedream 不显示垫图 chip', v.caps)
    await js(win, `document.querySelector('.v-task-row [data-task="t2i"]')?.click()`)
    await sleep(700)
    assert((await entryState(win, INFER_ID))?.task === 't2i', '查看器切任务已写入', (await entryState(win, INFER_ID))?.task)
    await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(350)
    assert(
      (await js(win, `document.querySelector('.card[data-id="${INFER_ID}"] .badge.task')?.textContent?.trim()`)) === '文生图',
      '查看器改任务后卡片徽标更新'
    )
    const hintAfter = await js(
      win,
      `[...document.querySelectorAll('.sb-hint')].map(x => x.textContent).find(x => x.includes('图生图'))`
    )
    assert(hintAfter && hintAfter.includes('图生图 0'), '侧栏任务计数跟随更新', hintAfter)
    await shot(win, '05-viewer-task', false)
    await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(300)

    console.log('\n→ 模型管理能力标注…')
    await js(win, `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`)
    await sleep(500)
    const mm = await js(
      win,
      `(() => {
        const row = [...document.querySelectorAll('.tm-row')].find(x => x.textContent.includes('Midjourney'))
        return {
          open: !!document.querySelector('.tm-row'),
          pad: !!row?.querySelector('.cap-chip.imagePrompt'),
          style: !!row?.querySelector('.cap-chip.styleRef')
        }
      })()`
    )
    assert(mm.open && mm.pad && mm.style, '模型管理显示 Midjourney 垫图/风格码', mm)
    await shot(win, '06-model-caps')
    await js(win, `document.querySelector('.right-dock .detail-head .icon-btn')?.click()`)
    await sleep(300)

    console.log('\n→ 分享包保留 task / capabilities…')
    const exp = await js(
      win,
      `window.pp.exportPack({ entryIds: ${JSON.stringify([TEXT_ID, I2I_ID])}, includeMedia: false, outPath: ${JSON.stringify(PACK)} })`
    )
    assert(exp && exp.entries === 2, '导出包含 task 的分享包', exp)
    const fflate = require('fflate')
    const files = fflate.unzipSync(new Uint8Array(fs.readFileSync(PACK)))
    const payload = JSON.parse(Buffer.from(files['data/prompts.json']).toString('utf8'))
    const pText = payload.entries.find((e) => e.originId === 'test015:text')
    const pI2i = payload.entries.find((e) => e.originId === 'test015:i2i')
    assert(pText?.task === 't2i', '包内文字条目 task=t2i', pText?.task)
    assert(pI2i?.task === 't2i', '包内 i2i 条目保存后的 task=t2i', pI2i?.task)
    const pMj = (payload.models ?? []).find((m) => m.name === 'Midjourney')
    assert(pMj?.capabilities?.imagePrompt === true, '包内 Midjourney 带垫图能力', pMj?.capabilities)

    assert(rendererErrors.length === 0, '渲染层无报错', rendererErrors)
  } catch (e) {
    console.error('验收过程出错:', e)
    failures++
  }

  console.log('\n' + (failures ? `✗ ${failures} 项失败` : '✓ 全部通过'))
  await sleep(300)
  app.exit(failures ? 1 : 0)
})
