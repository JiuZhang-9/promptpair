/**
 * AI 打标全链路验收（不需要真实 Key）：
 *   1. 起一个本地 OpenAI 兼容 mock 服务
 *   2. 写入配置（Base URL 指向 mock，Key 用测试值）
 *   3. 导入一张图 → 调 aiTest / aiSuggestTags
 *   4. 断言请求带上了 Key、图片 data URL、提示词；返回的候选标签正确
 *   5. 走 aiApplyTags 写入，断言标签真的落到记录上
 *   6. 清空 Key 后再调，断言给出"还没配置好"而不是崩溃
 *
 * 用法：npx electron scripts/verify-ai.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const zlib = require('node:zlib')
const { app, BrowserWindow } = require('electron')

const LIB = path.resolve('.smoke/lib-ai')
const INTAKE = path.resolve('.smoke/ai-intake')
const USERDATA = path.resolve('.smoke/userdata-ai')
const OUT = path.resolve('build/shots')
fs.mkdirSync(OUT, { recursive: true })

// 避免外部环境变量把「无 Key 降级」用例顶掉
delete process.env.PROMPTPAIR_AI_KEY
delete process.env.PROMPTPAIR_AI_BASE_URL
delete process.env.PROMPTPAIR_AI_MODEL

/* ── 极简 PNG 编码器（只用 zlib，避免额外依赖） ── */
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (b) => {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, c])
}
function png(w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < w; x++) {
      const o = row + 1 + x * 4
      raw[o] = (x * 3) % 255
      raw[o + 1] = (y * 3) % 255
      raw[o + 2] = ((x + y) * 2) % 255
      raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ── 本地 mock：OpenAI 兼容 /chat/completions ── */
const mockRequests = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    mockRequests.push({
      url: req.url,
      auth: req.headers.authorization ?? '',
      body
    })
    const isTest = body.includes('只回复 ok')
    const content = isTest ? 'ok' : '["赛博朋克","夜景"]'
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
})

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

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port
  fs.mkdirSync(USERDATA, { recursive: true })
  fs.writeFileSync(
    path.join(USERDATA, 'config.json'),
    JSON.stringify(
      {
        libraryPath: LIB,
        theme: 'dark',
        aiEnabled: true,
        aiBaseUrl: `http://127.0.0.1:${port}/v1`,
        aiApiKey: 'test-key',
        aiModel: 'mock-model'
      },
      null,
      2
    )
  )
  app.setPath('userData', USERDATA)
  require('../out/main/index.js')
  app.whenReady().then(run)
})

async function run() {
  await sleep(2400)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('✗ 没有窗口')
    server.close()
    app.quit()
    return
  }

  try {
    fs.rmSync(LIB, { recursive: true, force: true })
    fs.mkdirSync(LIB, { recursive: true })
    await win.webContents.executeJavaScript(`window.pp.switchLibrary(${JSON.stringify(LIB)})`)
    await sleep(500)

    // 造一张图并导入
    fs.rmSync(INTAKE, { recursive: true, force: true })
    fs.mkdirSync(INTAKE, { recursive: true })
    fs.writeFileSync(path.join(INTAKE, 'ai_test.png'), png(64, 64))

    console.log('\n→ 导入测试图…')
    const imp = await win.webContents.executeJavaScript(`
      window.pp.importPaths(${JSON.stringify([INTAKE])}, { roots: ${JSON.stringify([INTAKE])} })
    `)
    assert(imp.importedAssets === 1, '图片入库', imp)

    const st = await win.webContents.executeJavaScript('window.pp.getState()')
    const entry = st.data.entries[0]
    assert(!!entry, '导入生成了 1 条记录')

    console.log('\n→ 连接测试…')
    const test = await win.webContents.executeJavaScript('window.pp.aiTest()')
    console.log('  ' + JSON.stringify(test))
    assert(test.ok === true, '连接测试通过', test)
    assert(mockRequests.some((r) => r.auth === 'Bearer test-key'), '请求带上了 Bearer Key')

    console.log('\n→ 请求候选标签…')
    const sug = await win.webContents.executeJavaScript(`
      window.pp.aiSuggestTags([${JSON.stringify(entry.id)}])
    `)
    console.log('  ' + JSON.stringify(sug))
    assert(sug.failed === 0, '没有失败记录', sug.failed)
    assert(sug.results.length === 1, '返回 1 条结果', sug.results.length)
    assert(
      sug.results[0].tags.includes('赛博朋克') && sug.results[0].tags.includes('夜景'),
      '候选标签解析正确',
      sug.results[0].tags
    )

    const lastReq = mockRequests[mockRequests.length - 1]
    assert(lastReq.url.endsWith('/v1/chat/completions'), '请求路径正确', lastReq.url)
    assert(lastReq.body.includes('"image_url"'), '请求里带上了图片')
    assert(lastReq.body.includes('data:image/'), '图片以 data URL 发送')
    assert(lastReq.body.includes('正向提示词'), '提示词模板已带入请求')
    assert(lastReq.body.includes('只返回 JSON 数组'), '提示词里包含输出格式约束')

    console.log('\n→ UI 链路：批量栏 → AI 打标弹层 → 确认写入…')
    await win.webContents.reload()
    await sleep(1800)

    const selected = await win.webContents.executeJavaScript(`
      (() => {
        const c = document.querySelector('.card')
        if (c) c.click()
        return !!c
      })()
    `)
    assert(selected, '点击卡片选中记录')
    await sleep(500)

    const aiBtn = await win.webContents.executeJavaScript(`
      (() => {
        const b = [...document.querySelectorAll('.bb-btn')].find(x => x.textContent.includes('AI 打标'))
        if (b) b.click()
        return !!b
      })()
    `)
    assert(aiBtn, '批量栏出现「AI 打标」按钮')
    await sleep(900)

    const modal = await win.webContents.executeJavaScript(`
      (() => {
        const o = document.querySelector('.overlay')
        if (!o) return null
        return {
          text: o.textContent.slice(0, 80),
          cards: o.querySelectorAll('.ai-card').length,
          tags: o.querySelectorAll('.ai-tag').length
        }
      })()
    `)
    assert(!!modal && modal.cards === 1, '弹层渲染 1 条记录', modal)
    assert(!!modal && modal.tags === 2, '弹层渲染 2 个候选标签', modal)
    await shot(win, '16-ai-modal')

    const applyBtn = await win.webContents.executeJavaScript(`
      (() => {
        const b = document.querySelector('.ai-foot .btn.primary')
        if (b) b.click()
        return !!b
      })()
    `)
    assert(applyBtn, '点击了「应用」按钮')
    await sleep(1300)

    const st2 = await win.webContents.executeJavaScript('window.pp.getState()')
    const entry2 = st2.data.entries.find((e) => e.id === entry.id)
    const names = entry2.tagIds
      .map((id) => st2.data.tags.find((t) => t.id === id)?.name)
      .filter(Boolean)
    assert(names.includes('赛博朋克') && names.includes('夜景'), 'UI 写入后标签在记录上', names)
    const stillOpen = await win.webContents.executeJavaScript(`!!document.querySelector('.overlay')`)
    assert(!stillOpen, '写入后弹层自动关闭')

    console.log('\n→ 清空 Key 后的行为…')
    await win.webContents.executeJavaScript(`window.pp.patchConfig({ aiApiKey: '' })`)
    const noKey = await win.webContents.executeJavaScript(`
      window.pp.aiSuggestTags([${JSON.stringify(entry.id)}])
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, message: String(e && e.message || e) }))
    `)
    console.log('  ' + JSON.stringify(noKey))
    assert(noKey.ok === false, '没有 Key 时不会发起请求')
    assert(
      /配置好|未启用/.test(noKey.message || ''),
      '错误信息是人话（配置/未启用）',
      noKey.message
    )
  } catch (e) {
    console.error('\n❌ 验收异常：', e.message)
    failures++
  }

  console.log('')
  if (failures === 0) console.log('✅ AI 打标全链路断言通过')
  else console.log(`❌ 有 ${failures} 项断言失败`)

  await sleep(200)
  server.close()
  app.quit()
}
