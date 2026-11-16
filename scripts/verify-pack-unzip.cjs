/**
 * 分享包读写回归（0.12.4）：
 *   A. 解包：老包（数据描述符、本地头尺寸为 0）+ 媒体内含 "PK\x03\x04" 字节
 *      → 新解包器必须完整、逐字节还原（旧实现会错位、读出错乱文件名后崩）
 *   B. 写包：新写入器产出的包本地头不得有 bit 3，且老式流式解包器也能正确读
 *
 * 用法：node scripts/verify-pack-unzip.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const OUT = path.join(os.tmpdir(), 'pp-unzip-test')
const DEST_A = path.join(OUT, 'unpacked-a')
const DEST_B = path.join(OUT, 'unpacked-b')

/* 把 src/main/zip.ts 打包成 CJS 再 require，避免依赖 electron */
const bundle = path.join(OUT, 'zip.cjs')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
require('esbuild').buildSync({
  entryPoints: ['src/main/zip.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
  logLevel: 'warning'
})
const { ZipWriter, extractZip } = require(bundle)

const fflate = require('fflate')

/* ── 夹具 ── */
const poison = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  Buffer.from('PK\x03\x04', 'latin1'),
  Buffer.from('PK\x07\x08', 'latin1'),
  Buffer.alloc(4096, 7)
])
const thumb = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('PK\x03\x04', 'latin1')])

/** A：按老版本写法造包（fflate 流式 + 数据描述符） */
function writeLegacyPack(out) {
  const fd = fs.openSync(out, 'w')
  const zip = new fflate.Zip((err, chunk) => {
    if (err) throw err
    fs.writeSync(fd, chunk)
    if (chunk === undefined || (chunk && zip.ended)) fs.closeSync(fd)
  })
  const put = (name, data) => {
    const e = new fflate.ZipPassThrough(name)
    zip.add(e)
    e.push(new Uint8Array(data), true)
  }
  put('manifest.json', Buffer.from(JSON.stringify({ magic: 'promptpair.pack', entry: 'data/prompts.json' })))
  put('data/prompts.json', Buffer.from(JSON.stringify({ entries: [{ assets: [{ rel: 'media/aa/x.png' }] }] })))
  put('media/aa/x.png', poison)
  put('media/aa/x.thumb.jpg', thumb)
  zip.end()
}

/** B：用老式流式解包器读包，返回 {name: bytes} 或抛错 */
function legacyRead(zipPath) {
  return new Promise((resolve, reject) => {
    const unzip = new fflate.Unzip()
    unzip.register(fflate.UnzipInflate)
    unzip.register(fflate.UnzipPassThrough)
    const files = {}
    unzip.onfile = (file) => {
      const chunks = []
      file.ondata = (err, chunk, final) => {
        if (err) return reject(err)
        if (chunk) chunks.push(Buffer.from(chunk))
        if (final) files[file.name] = Buffer.concat(chunks)
      }
      file.start()
    }
    const rs = fs.createReadStream(zipPath, { highWaterMark: 1 << 20 })
    rs.on('data', (c) => unzip.push(new Uint8Array(c), false))
    rs.on('end', () => {
      unzip.push(new Uint8Array(0), true)
      setImmediate(() => resolve(files))
    })
    rs.on('error', reject)
  })
}

let failures = 0
function assert(cond, label, extra) {
  if (cond) console.log('  ✓ ' + label)
  else {
    console.log('  ✗ ' + label + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''))
    failures++
  }
}

;(async () => {
  /* A：新解包器读老包 */
  const legacyPack = path.join(OUT, 'legacy.promptpack')
  writeLegacyPack(legacyPack)
  await extractZip(legacyPack, DEST_A)
  assert(fs.readdirSync(path.join(DEST_A, 'media/aa')).length === 2, 'A 两个媒体文件都解出来了')
  assert(fs.readFileSync(path.join(DEST_A, 'media/aa/x.png')).equals(poison), 'A 媒体内容逐字节一致')
  assert(fs.readFileSync(path.join(DEST_A, 'media/aa/x.thumb.jpg')).equals(thumb), 'A 缩略图内容逐字节一致')

  /* B：新写入器造包，本地头不能有 bit 3 */
  const newPack = path.join(OUT, 'new.promptpack')
  const w = new ZipWriter(newPack)
  w.addBuffer('manifest.json', Buffer.from('{"magic":"promptpair.pack"}'))
  w.addBuffer('media/aa/x.png', poison)
  w.addBuffer('data/中文.json', Buffer.from('{"中文":"值"}'))
  w.finish()
  const fd = fs.openSync(newPack, 'r')
  const head = Buffer.alloc(30)
  fs.readSync(fd, head, 0, 30, 0)
  fs.closeSync(fd)
  assert((head.readUInt16LE(6) & 8) === 0, 'B 本地头没有数据描述符标志')
  assert(head.readUInt32LE(18) === Buffer.byteLength('{"magic":"promptpair.pack"}'), 'B 本地头写入了真实尺寸')

  const back = await legacyRead(newPack)
  assert(back['media/aa/x.png'] && back['media/aa/x.png'].equals(poison), 'B 老式解包器能读新包（旧版本兼容）')
  assert(back['data/\u4e2d\u6587.json'] !== undefined, 'B 中文文件名条目能读')

  await extractZip(newPack, DEST_B)
  assert(fs.readFileSync(path.join(DEST_B, 'media/aa/x.png')).equals(poison), 'B 新解包器自读一致')

  if (failures) {
    console.log('\n✗ ' + failures + ' 项失败')
    process.exit(1)
  }
  console.log('\n✓ 读写双向回归通过')
})().catch((e) => {
  console.log('✗ 抛错：' + e.message)
  process.exit(1)
})
