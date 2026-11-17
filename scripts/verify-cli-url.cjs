/**
 * 0.13.0 CLI 远程图片验收：
 *   批次 JSON 里 assets[].url 指向本地 HTTP 图片 → CLI 自动下载、入库；
 *   --dry-run 只统计不写库。
 *
 * 用法：npm run build && node scripts/verify-cli-url.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')

const ROOT = path.resolve('.smoke', `cli-url-${Date.now()}`)
const LIB = path.join(ROOT, 'lib')
const USERDATA = path.join(ROOT, 'userdata')
fs.mkdirSync(ROOT, { recursive: true })

let failures = 0
function assert(cond, label, extra) {
  if (cond) console.log('  ✓ ' + label)
  else {
    console.log('  ✗ ' + label + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''))
    failures++
  }
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

function runCli(batchPath, dryRun) {
  const electronPath = require('electron')
  const args = [
    path.resolve('out/main/index.js'),
    '--cli',
    'add',
    '--batch',
    batchPath,
    '--library',
    LIB
  ]
  if (dryRun) args.push('--dry-run')
  return new Promise((resolve) => {
    const child = spawn(electronPath, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PP_CLI_ALLOW_RUNNING: '1',
        PP_CLI_USER_DATA: USERDATA
      },
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: -1, stdout, stderr: stderr + '\n[timeout]' })
    }, 60000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

const server = http.createServer((req, res) => {
  if (req.url === '/pic.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length })
    res.end(PNG)
    return
  }
  res.writeHead(404)
  res.end('no')
})

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port
  const batchPath = path.join(ROOT, 'batch.json')
  fs.writeFileSync(
    batchPath,
    JSON.stringify(
      {
        entries: [
          {
            originId: 'cli-url-test-1',
            title: 'CLI URL 远程图测试',
            positive: 'remote image prompt --ar 1:1',
            tags: [{ name: 'URL测试', group: '题材' }],
            collections: ['URL集合'],
            params: {
              model: 'Midjourney',
              extra: {
                aspect: '1:1',
                mjCodes: '--sref abc123',
                mjCodeMode: 'solo',
                mjCodeCount: '1'
              }
            },
            assets: [{ url: `http://127.0.0.1:${port}/pic.png` }]
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  )

  console.log('\n→ dry-run：只统计，不写库…')
  const dry = await runCli(batchPath, true)
  assert(dry.code === 0, 'dry-run 正常退出', { code: dry.code, stderr: dry.stderr.slice(-400) })
  const dryLibFile = path.join(LIB, 'library.json')
  const dryLib = fs.existsSync(dryLibFile)
    ? JSON.parse(fs.readFileSync(dryLibFile, 'utf8'))
    : { entries: [], assets: [] }
  assert(
    dryLib.entries.length === 0 && dryLib.assets.length === 0,
    'dry-run 不写入条目/媒体',
    { entries: dryLib.entries.length, assets: dryLib.assets.length }
  )

  console.log('\n→ 正式导入：URL 自动下载…')
  const real = await runCli(batchPath, false)
  assert(real.code === 0, 'CLI 正常退出', { code: real.code, stderr: real.stderr.slice(-600) })
  const libFile = path.join(LIB, 'library.json')
  assert(fs.existsSync(libFile), '库文件已生成')
  if (fs.existsSync(libFile)) {
    const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'))
    const entry = lib.entries.find((e) => e.title === 'CLI URL 远程图测试')
    assert(!!entry, '条目已写入')
    assert(lib.assets.length === 1 && lib.assets[0].kind === 'image', '远程图片已下载入库', lib.assets)
    assert(lib.assets[0] && lib.assets[0].ext === '.png', '按 Content-Type 识别为 .png', lib.assets[0]?.ext)
    assert(entry && entry.assetIds.length === 1, '条目关联到下载的图片')
    assert(
      !!entry && entry.params?.extra?.mjCodes === '--sref abc123',
      'MJ 风格码字段完整保留'
    )
    assert(
      lib.collections.some((c) => c.name === 'URL集合') && lib.tags.some((t) => t.name === 'URL测试'),
      '集合与标签按名字自动创建'
    )
    const media = entry && lib.assets.find((a) => a.id === entry.assetIds[0])
    assert(
      !!media && fs.existsSync(path.join(LIB, media.relPath)),
      '下载的媒体文件真实落盘',
      media?.relPath
    )
  }

  server.close()
  console.log(failures ? `\n✗ ${failures} 项失败` : '\n✅ CLI 远程图片验收通过')
  process.exit(failures ? 1 : 0)
})
