/**
 * 分享包解包回归（0.12.4）：
 *   1. 用导出端同样的流式写法（数据描述符、本地头尺寸为 0）造一个包
 *   2. 媒体里故意塞入 "PK\x03\x04" / "PK\x07\x08" 字节序列（真实图片里出现过）
 *   3. 断言解包不崩、文件名不乱码、内容逐字节一致
 *
 * 用法：node scripts/verify-pack-unzip.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const OUT = path.join(os.tmpdir(), 'pp-unzip-test')
const ZIP_PATH = path.join(OUT, 'poison.promptpack')
const DEST = path.join(OUT, 'unpacked')

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
const { extractZip } = require(bundle)

const { Zip, ZipPassThrough } = require('fflate')

/* ── 造包：媒体内容里带 PK 签名 ── */
const poison = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  Buffer.from('PK\x03\x04', 'latin1'),
  Buffer.from('PK\x07\x08', 'latin1'),
  Buffer.alloc(4096, 7)
])
const thumb = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('PK\x03\x04', 'latin1')])
const manifest = Buffer.from(JSON.stringify({ magic: 'promptpair.pack', entry: 'data/prompts.json' }))

function writePack(out) {
  const fd = fs.openSync(out, 'w')
  const zip = new Zip((err, chunk, final) => {
    if (err) throw err
    fs.writeSync(fd, chunk)
    if (final) fs.closeSync(fd)
  })
  const put = (name, data) => {
    const e = new ZipPassThrough(name)
    zip.add(e)
    e.push(new Uint8Array(data), true)
  }
  put('manifest.json', manifest)
  put('data/prompts.json', Buffer.from(JSON.stringify({ entries: [{ assets: [{ rel: 'media/aa/x.png' }] }] })))
  put('media/aa/x.png', poison)
  put('media/aa/x.thumb.jpg', thumb)
  zip.end()
}
writePack(ZIP_PATH)

let failures = 0
function assert(cond, label, extra) {
  if (cond) console.log('  ✓ ' + label)
  else {
    console.log('  ✗ ' + label + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''))
    failures++
  }
}

extractZip(ZIP_PATH, DEST)
  .then(() => {
    const files = fs.readdirSync(path.join(DEST, 'media/aa'))
    assert(files.length === 2, '两个媒体文件都解出来了', files)
    assert(fs.existsSync(path.join(DEST, 'manifest.json')), 'manifest.json 在')
    const got = fs.readFileSync(path.join(DEST, 'media/aa/x.png'))
    assert(got.equals(poison), '媒体内容逐字节一致', { got: got.length, want: poison.length })
    const thumbGot = fs.readFileSync(path.join(DEST, 'media/aa/x.thumb.jpg'))
    assert(thumbGot.equals(thumb), '缩略图内容逐字节一致')
    if (failures) {
      console.log('\n✗ ' + failures + ' 项失败')
      process.exit(1)
    }
    console.log('\n✓ 解包回归通过')
  })
  .catch((e) => {
    console.log('  ✗ 解包抛错：' + e.message)
    process.exit(1)
  })
