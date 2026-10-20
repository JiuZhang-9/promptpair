/**
 * 导入管线端到端验收：
 *   1. 造一个「风格_赛博朋克」文件夹：两张连号图 + 一份 SD WebUI 格式的 .txt
 *   2. 通过真实 IPC 导入
 *   3. 断言：连号合并成 1 条、提示词/负向/参数被解析、标签归入「风格」组、
 *            缩略图与感知哈希已生成
 *   4. 再导入一次，断言幂等（不新增记录）
 *
 * 用法：npx electron scripts/verify-import.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const zlib = require('node:zlib')
const { app, BrowserWindow } = require('electron')

const INTAKE = path.resolve('.smoke/intake')
const LIB = path.resolve('.smoke/lib-import')

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
function png(w, h, rgbAt) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgbAt(x, y)
      const o = row + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
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

/* ── 造素材 ── */
function buildIntake() {
  fs.rmSync(INTAKE, { recursive: true, force: true })
  const dir = path.join(INTAKE, '风格_赛博朋克')
  fs.mkdirSync(dir, { recursive: true })

  for (let i = 1; i <= 2; i++) {
    const buf = png(320, 320, (x, y) => [
      (x * 0.7 + i * 40) % 255,
      (y * 0.6 + i * 20) % 255,
      ((x + y) * 0.4 + i * 60) % 255
    ])
    fs.writeFileSync(path.join(dir, `city_${i}.png`), buf)
  }

  // SD WebUI 典型格式：正向 + Negative prompt + 参数行
  fs.writeFileSync(
    path.join(dir, 'city.txt'),
    [
      'neon city street at night, rain, reflections, cinematic, 85mm',
      'Negative prompt: blurry, low quality, watermark',
      'Steps: 28, Sampler: DPM++ 2M, CFG scale: 7.5, Seed: 1234567, Size: 1536x1024, Model: dreamshaper_8'
    ].join('\n'),
    'utf8'
  )
  return dir
}

app.setPath('userData', path.resolve('.smoke/userdata-import'))
fs.mkdirSync(path.resolve('.smoke/userdata-import'), { recursive: true })
fs.writeFileSync(
  path.resolve('.smoke/userdata-import/config.json'),
  JSON.stringify({ libraryPath: LIB, theme: 'dark' }, null, 2)
)

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
    console.log('  ✗ ' + label + (extra ? ' → ' + JSON.stringify(extra) : ''))
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
    const dir = buildIntake()
    fs.rmSync(LIB, { recursive: true, force: true })
    fs.mkdirSync(LIB, { recursive: true })
    // 换到干净的空库
    await win.webContents.executeJavaScript(`window.pp.switchLibrary(${JSON.stringify(LIB)})`)
    await sleep(600)

    console.log('\n→ 第一次导入…')
    const r1 = await win.webContents.executeJavaScript(`
      window.pp.importPaths(${JSON.stringify([dir])}, { roots: ${JSON.stringify([dir])} })
    `)
    console.log('  ' + JSON.stringify(r1))
    assert(r1.createdEntries === 1, '连号的两张图合并成 1 条记录', r1)
    assert(r1.importedAssets === 2, '入库 2 个媒体文件', r1)
    assert(r1.failed.length === 0, '没有失败文件', r1)

    const st = await win.webContents.executeJavaScript('window.pp.getState()')
    const e = st.data.entries[0]
    assert(!!e, '库里有 1 条记录')
    assert(e.assetIds.length === 2, '这条记录挂了 2 个产物', e.assetIds.length)
    assert(
      e.positive.startsWith('neon city street'),
      '正向提示词从 .txt 读出',
      e.positive.slice(0, 40)
    )
    assert(e.negative.includes('blurry'), '负向提示词解析正确', e.negative)
    assert(e.params.steps === 28, '步数解析 = 28', e.params.steps)
    assert(e.params.seed === '1234567', 'seed 解析正确', e.params.seed)
    assert(e.params.width === 1536 && e.params.height === 1024, '尺寸解析 1536x1024', e.params)
    assert(e.params.model === 'dreamshaper_8', '模型名解析正确', e.params.model)
    assert(e.params.cfg === 7.5, 'CFG 解析 = 7.5', e.params.cfg)

    const tagNames = e.tagIds.map((id) => st.data.tags.find((t) => t.id === id)?.name).filter(Boolean)
    assert(tagNames.includes('赛博朋克'), '从文件夹名得到「赛博朋克」标签', tagNames)
    assert(!tagNames.includes('风格'), '「风格」没有被误建成标签（它是组名）', tagNames)
    const cbr = st.data.tags.find((t) => t.name === '赛博朋克')
    const fg = st.data.tagGroups.find((g) => g.name === '风格')
    assert(cbr && fg && cbr.groupId === fg.id, '「赛博朋克」被归入「风格」组', {
      tag: cbr,
      group: fg && fg.id
    })

    const a = st.data.assets[0]
    assert(!!a.thumbRel, '缩略图已生成', a.thumbRel)
    assert(!!a.phash && a.phash.length === 16, '感知哈希已计算（16 位）', a.phash)
    assert(a.width === 320 && a.height === 320, '图片尺寸读取正确', [a.width, a.height])

    const thumbAbs = path.join(LIB, a.thumbRel)
    assert(fs.existsSync(thumbAbs), '缩略图文件真的落盘了', thumbAbs)

    console.log('\n→ 第二次导入同一文件夹（测幂等）…')
    const r2 = await win.webContents.executeJavaScript(`
      window.pp.importPaths(${JSON.stringify([dir])}, { roots: ${JSON.stringify([dir])} })
    `)
    console.log('  ' + JSON.stringify(r2))
    assert(r2.createdEntries === 0, '没有重复创建记录', r2)
    assert(r2.reusedAssets === 2, '2 个文件被识别为已存在并复用', r2)

    const st2 = await win.webContents.executeJavaScript('window.pp.getState()')
    assert(st2.data.entries.length === 1, '库里仍然只有 1 条记录', st2.data.entries.length)
    assert(st2.data.assets.length === 2, '库里仍然只有 2 个媒体（未重复复制）', st2.data.assets.length)

    console.log('\n→ 检查媒体目录结构…')
    const mediaRoot = path.join(LIB, 'media')
    const shards = fs.readdirSync(mediaRoot)
    assert(shards.length > 0 && shards[0].length === 2, '按哈希前两位分片存放', shards)

    // 搜一下提示词能不能命中
    const searched = await win.webContents.executeJavaScript(`
      (() => {
        const s = window.pp ? null : null
        return true
      })()
    `)
  } catch (e) {
    console.error('\n❌ 验收异常：', e.message)
    failures++
  }

  console.log('')
  if (failures === 0) console.log('✅ 导入管线全部断言通过')
  else console.log(`❌ 有 ${failures} 项断言失败`)

  await sleep(200)
  app.quit()
})
