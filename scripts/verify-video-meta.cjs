/**
 * 视频元数据端到端验收（0.7.0 时长与分辨率）：
 *   1. 纯 JS 合成极小 MP4 / WebM（无编解码数据，只有容器头），外加一个损坏文件
 *   2. 若 .smoke/video-samples/ 下有真实样本（flower.mp4 / flower.webm）一并入库
 *   3. 走真实 IPC addAssets 入库，断言时长与分辨率
 *   4. 断言损坏文件不崩、不带脏数据
 *   5. 模拟老库（无时长、缩略图占位尺寸），走 repair 回填
 *
 * 用法：npm run build && npx electron scripts/verify-video-meta.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const LIB = path.resolve('.smoke/lib-video-meta')
const USERDATA = path.resolve('.smoke/userdata-video-meta')
const FIXTURE = path.resolve('.smoke/video-fixture')
const SAMPLES = path.resolve('.smoke/video-samples')

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

/* ── 极简 ISOBMFF 合成：ftyp + moov(mvhd + trak(tkhd)) + mdat，时长 5s，1280×720 ── */
function mp4Fixture() {
  const box = (type, payload) => {
    const b = Buffer.alloc(8 + payload.length)
    b.writeUInt32BE(8 + payload.length, 0)
    b.write(type, 4, 'latin1')
    payload.copy(b, 8)
    return b
  }
  const mvhd = box('mvhd', (() => {
    const b = Buffer.alloc(100)
    b.writeUInt32BE(1000, 12) // timescale
    b.writeUInt32BE(5000, 16) // duration → 5s
    b.writeUInt32BE(0x00010000, 20) // rate 1.0
    b.writeUInt16BE(0x0100, 24) // volume
    b.writeUInt32BE(0x00010000, 36) // matrix 单位阵
    b.writeUInt32BE(0x00010000, 52)
    b.writeUInt32BE(0x40000000, 68)
    b.writeUInt32BE(2, 96) // next_track_id
    return b
  })())
  const tkhd = box('tkhd', (() => {
    const b = Buffer.alloc(84)
    b.writeUInt32BE(0x00000007, 0) // flags: enabled | in movie | in preview
    b.writeUInt32BE(1, 12) // track_id
    b.writeUInt32BE(5000, 20) // duration
    b.writeUInt32BE(0x00010000, 44) // matrix
    b.writeUInt32BE(0x00010000, 56)
    b.writeUInt32BE(0x40000000, 64)
    b.writeUInt32BE(1280 << 16, 76) // width 16.16
    b.writeUInt32BE(720 << 16, 80) // height 16.16
    return b
  })())
  const trak = box('trak', Buffer.concat([tkhd]))
  const moov = box('moov', Buffer.concat([mvhd, trak]))
  const ftyp = box('ftyp', Buffer.concat([
    Buffer.from('isom', 'latin1'),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from('isomiso2avc1mp41', 'latin1')
  ]))
  const mdat = box('mdat', Buffer.alloc(16))
  return Buffer.concat([ftyp, moov, mdat])
}

/* ── 极简 EBML 合成：EBML 头 + Segment(Info + Tracks)，时长 5s，1920×1080 ── */
function webmFixture() {
  const el = (idBytes, payload) => {
    const n = payload.length
    let sizeVint
    if (n < 0x80) sizeVint = Buffer.from([0x80 | n])
    else if (n < 0x4000) sizeVint = Buffer.from([(0x40 | (n >> 8)) & 0xff, n & 0xff])
    else if (n < 0x200000) sizeVint = Buffer.from([0x20 | ((n >> 16) & 0x0f), (n >> 8) & 0xff, n & 0xff])
    else sizeVint = Buffer.from([0x10 | ((n >> 24) & 0x07), (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff])
    return Buffer.concat([Buffer.from(idBytes), sizeVint, payload])
  }
  const u = (v, bytes) => {
    const b = Buffer.alloc(bytes)
    b.writeUIntBE(v, 0, bytes)
    return b
  }
  const ebmlHeader = el([0x1a, 0x45, 0xdf, 0xa3], Buffer.concat([
    el([0x42, 0x86], Buffer.from([1])), // EBMLVersion
    el([0x42, 0xf7], Buffer.from([1])), // EBMLReadVersion
    el([0x42, 0xf2], Buffer.from([1])), // EBMLMaxIDLength
    el([0x42, 0xf3], Buffer.from([8])) // EBMLMaxSizeLength
  ]))
  const info = el([0x15, 0x49, 0xa9, 0x66], Buffer.concat([
    el([0x2a, 0xd7, 0xb1], u(1000000, 3)), // TimecodeScale 1ms
    el([0x44, 0x89], (() => { const b = Buffer.alloc(8); b.writeDoubleBE(5000, 0); return b })()) // Duration 5000ms
  ]))
  const video = el([0xe0], Buffer.concat([
    el([0xb0], u(1920, 2)), // PixelWidth
    el([0xba], u(1080, 2)) // PixelHeight
  ]))
  const track = el([0xae], Buffer.concat([el([0xd7], u(1, 1)), el([0x83], Buffer.from([1])), video]))
  const tracks = el([0x16, 0x54, 0xae, 0x6b], track)
  const segment = el([0x18, 0x53, 0x80, 0x67], Buffer.concat([info, tracks]))
  return Buffer.concat([ebmlHeader, segment])
}

app.on('browser-window-created', (_e, w) => {
  w.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 2) console.log('[renderer] ' + message)
  })
})

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
    fs.rmSync(FIXTURE, { recursive: true, force: true })
    fs.mkdirSync(FIXTURE, { recursive: true })
    fs.writeFileSync(path.join(FIXTURE, 'synthetic.mp4'), mp4Fixture())
    fs.writeFileSync(path.join(FIXTURE, 'synthetic.webm'), webmFixture())
    fs.writeFileSync(path.join(FIXTURE, 'corrupt.mp4'), Buffer.alloc(4096, 0x5a))
    const files = [
      path.join(FIXTURE, 'synthetic.mp4'),
      path.join(FIXTURE, 'synthetic.webm'),
      path.join(FIXTURE, 'corrupt.mp4')
    ]
    for (const s of ['flower.mp4', 'flower.webm']) {
      const p = path.join(SAMPLES, s)
      if (fs.existsSync(p)) files.push(p)
    }

    await win.webContents.executeJavaScript(`window.pp.switchLibrary(${JSON.stringify(LIB)})`)
    await sleep(500)

    console.log('\n→ 通过真实 IPC 导入 ' + files.length + ' 个视频文件…')
    const added = await win.webContents.executeJavaScript(
      `window.pp.addAssets(${JSON.stringify(files)})`
    )
    assert(Array.isArray(added) && added.length === files.length, '全部入库', added?.length)
    // 返回值与传入路径按顺序对应（资产落库后按 sha 重命名，不能按原始文件名找）
    const byFile = {}
    files.forEach((f, i) => (byFile[path.basename(f)] = added[i]))
    const st = await win.webContents.executeJavaScript('window.pp.getState()')
    const byId = Object.fromEntries(st.data.assets.map((a) => [a.id, a]))
    const fresh = Object.fromEntries(
      Object.entries(byFile).map(([k, a]) => [k, a ? byId[a.id] : undefined])
    )

    console.log('\n→ 合成 MP4（应得 5s / 1280×720）…')
    const m4 = fresh['synthetic.mp4']
    assert(!!m4, '合成 MP4 已入库')
    if (m4) {
      assert(m4.kind === 'video', 'kind = video', m4.kind)
      assert(Math.abs((m4.duration ?? -99) - 5) <= 1, '时长 ≈ 5s（误差 ≤ 1s）', m4.duration)
      assert(m4.width === 1280 && m4.height === 720, '分辨率 1280×720', [m4.width, m4.height])
    }

    console.log('\n→ 合成 WebM（应得 5s / 1920×1080）…')
    const wm = fresh['synthetic.webm']
    assert(!!wm, '合成 WebM 已入库')
    if (wm) {
      assert(Math.abs((wm.duration ?? -99) - 5) <= 1, '时长 ≈ 5s（误差 ≤ 1s）', wm.duration)
      assert(wm.width === 1920 && wm.height === 1080, '分辨率 1920×1080', [wm.width, wm.height])
    }

    console.log('\n→ 损坏文件（应安静降级，不崩、不带脏数据）…')
    const cp = fresh['corrupt.mp4']
    assert(!!cp, '损坏文件照常入库（不中断导入）')
    if (cp) {
      assert(cp.duration === undefined, '没有伪造时长', cp.duration)
      assert(!cp.thumbRel, '缩略图可缺失（现状行为）', cp.thumbRel)
    }

    if (fresh['flower.mp4']) {
      console.log('\n→ 真实样本 flower.mp4（960×540，约 5.055s）…')
      const f = fresh['flower.mp4']
      assert(Math.abs((f.duration ?? -99) - 5.055) <= 1, '时长 ≈ 5.055s', f.duration)
      assert(f.width === 960 && f.height === 540, '分辨率 960×540', [f.width, f.height])
    }
    if (fresh['flower.webm']) {
      console.log('\n→ 真实样本 flower.webm（960×540，约 5.059s）…')
      const f = fresh['flower.webm']
      assert(Math.abs((f.duration ?? -99) - 5.059) <= 1, '时长 ≈ 5.059s', f.duration)
      assert(f.width === 960 && f.height === 540, '分辨率 960×540', [f.width, f.height])
    }

    if (fresh['flower.mp4']) {
      console.log('\n→ 视频卡片悬停预览（真实样本）…')
      const vidId = fresh['flower.mp4'].id
      const entry = await win.webContents.executeJavaScript(`
        window.pp.saveEntry({
          title: '悬停预览验收',
          positive: 'hover preview test',
          negative: '',
          note: '',
          rating: 0,
          favorite: false,
          collectionIds: [],
          tagIds: [],
          assetIds: [${JSON.stringify(vidId)}],
          params: {},
          source: {}
        })
      `)
      assert(!!entry?.id, '已建一条挂视频的记录', entry && entry.id)
      // 直接调 preload API 不会触发 renderer store 刷新，重载一次让画廊读到新记录
      win.webContents.reload()
      await sleep(2600)
      await win.webContents.executeJavaScript(`
        (() => {
          const thumb = document.querySelector('.card[data-id="${entry.id}"] .card-thumb')
          if (thumb) thumb.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
        })()
      `)
      const probe = `
        (() => {
          const v = document.querySelector('.card video')
          return v ? { t: v.currentTime, paused: v.paused, muted: v.muted } : null
        })()
      `
      const waitFor = async (pred, ms) => {
        const t0 = Date.now()
        while (Date.now() - t0 < ms) {
          const v = await win.webContents.executeJavaScript(probe)
          if (v && pred(v)) return v
          await sleep(200)
        }
        return null
      }
      const playing = await waitFor((v) => !v.paused && v.t > 0, 6000)
      assert(!!playing, '悬停后出现 <video> 预览并开始播放', playing)
      assert(!!playing && playing.muted, '预览静音')
      const after3s = await waitFor((v) => v.paused && v.t >= 2.9, 8000)
      assert(!!after3s, '播到 3 秒自动暂停（停在当前帧）', after3s)
      assert(!!after3s && after3s.t <= 4.2, '播放时长被封顶在 3 秒附近', after3s)
      await win.webContents.executeJavaScript(`
        (() => {
          const thumb = document.querySelector('.card[data-id="${entry.id}"] .card-thumb')
          if (thumb) thumb.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
        })()
      `)
      await sleep(400)
      const gone = await win.webContents.executeJavaScript(`!document.querySelector('.card video')`)
      assert(gone, '移出卡片后预览卸载')
    }

    console.log('\n→ 模拟老库（无时长 + 512×288 占位尺寸）走 repair 回填…')
    const libJsonPath = path.join(LIB, 'library.json')
    const libJson = JSON.parse(fs.readFileSync(libJsonPath, 'utf8'))
    const targetId = byFile['synthetic.mp4']?.id
    const target = libJson.assets.find((a) => a.id === targetId)
    assert(!!target, '找到目标资产')
    delete target.duration
    target.width = 512
    target.height = 288
    fs.writeFileSync(libJsonPath, JSON.stringify(libJson))

    await win.webContents.executeJavaScript(`window.pp.switchLibrary(${JSON.stringify(LIB)})`)
    await sleep(500)
    const rep = await win.webContents.executeJavaScript('window.pp.repairAssets()')
    console.log('  ' + JSON.stringify(rep))
    const st3 = await win.webContents.executeJavaScript('window.pp.getState()')
    const again = st3.data.assets.find((a) => a.id === targetId)
    assert(!!again, '回填后资产仍在')
    if (again) {
      assert(Math.abs((again.duration ?? -99) - 5) <= 1, '时长已回填 ≈ 5s', again.duration)
      assert(again.width === 1280 && again.height === 720, '占位尺寸已换真实分辨率', [
        again.width,
        again.height
      ])
    }
  } catch (e) {
    console.error('\n❌ 验收异常：', e.message)
    failures++
  }

  console.log('')
  if (failures === 0) console.log('✅ 视频元数据全部断言通过')
  else console.log(`❌ 有 ${failures} 项断言失败`)

  await sleep(200)
  app.quit()
})
