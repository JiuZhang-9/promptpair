/**
 * 清理编译中间产物，保留 release/ 根目录的本地安装包（按版本号区分）。
 *
 * 为什么需要这个脚本：electron-builder 的产物目录一被文件占用（应用还开着、
 * 杀毒在扫、索引服务在跑），构建就会失败。这时正确的动作是**先清理再看**，
 * 而不是换个 `--config.directories.output=xxx` 绕过去 —— 绕一次就多一个
 * rel/、rel2/，最后没人知道哪个才是最新的。本脚本存在的意义就是让
 * 「清理」变成一条命令，而不是一次手忙脚乱。
 *
 * 规则：本地构建出来的 PromptPair-Setup-*.exe / .blockmap / latest.yml 保留；
 * 只删 win-unpacked、builder-debug.yml 和历史遗留目录。坏包仍然直接删。
 *
 * 用法：
 *   npm run clean          # 清编译产物，保留本地安装包
 *   npm run clean -- --dry # 只列出来，不删
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const DRY = process.argv.includes('--dry')

/** 唯一的正式产物目录 —— 与 electron-builder.yml 的 directories.output 一致 */
const CANONICAL = 'release'

/** 历史遗留 / 不该存在的目录，一并清掉 */
const STRAY = ['release-old', 'rel', 'rel2', 'rel3', 'dist']

/** 这些目录永远不能碰 */
const PROTECTED = new Set(['node_modules', 'src', 'docs', 'build', 'extension', 'scripts', '.git'])
const PROJECT = process.cwd()

/** 本地构建的有效安装包 / 元数据：按版本共存，清理时保留 */
const INSTALLER_RE = /^PromptPair-Setup-.*\.exe(\.blockmap)?$/i
const isPreserved = (name) => INSTALLER_RE.test(name) || name === 'latest.yml'

function mb(n) {
  return (n / 1024 / 1024).toFixed(0) + ' MB'
}

function dirSize(p) {
  let total = 0
  const walk = (d) => {
    let items = []
    try {
      items = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const it of items) {
      const fp = path.join(d, it.name)
      try {
        if (it.isDirectory()) walk(fp)
        else total += fs.statSync(fp).size
      } catch {
        /* 忽略读不到的文件 */
      }
    }
  }
  walk(p)
  return total
}

/** 找出还占着这些目录的进程（只在 Windows 上做，其它平台跳过） */
function findHolders() {
  if (process.platform !== 'win32') return []
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-Process | Where-Object { $_.Path -like \'*PromptPair*\' } | Select-Object Id,Path | ConvertTo-Json -Compress"',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
    if (!out || out === 'null') return []
    const parsed = JSON.parse(out)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

function rmrf(p, { retries = 3 } = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 })
      return { ok: true }
    } catch (e) {
      if (i === retries - 1) return { ok: false, error: e }
      // 给外部扫描器一点时间释放句柄
      const until = Date.now() + 700
      while (Date.now() < until) {
        /* 忙等，避免引入异步复杂度 */
      }
    }
  }
  return { ok: false }
}

/** 遗留目录里如果有本地安装包，先搬到 release/，再删目录 */
function salvageInstallers(strayDir) {
  const releaseDir = path.join(PROJECT, CANONICAL)
  let names = []
  try {
    names = fs.readdirSync(strayDir)
  } catch {
    return []
  }
  fs.mkdirSync(releaseDir, { recursive: true })
  const moved = []
  for (const name of names) {
    if (!isPreserved(name)) continue
    const src = path.join(strayDir, name)
    const dest = path.join(releaseDir, name)
    try {
      if (fs.statSync(src).isFile() && !fs.existsSync(dest)) {
        fs.copyFileSync(src, dest)
        moved.push(name)
      }
    } catch {
      /* 读不到就交给后面的删除流程报错 */
    }
  }
  if (moved.length) console.log(`  迁移旧安装包到 ${CANONICAL}/：${moved.join(', ')}`)
  return moved
}

/** release/ 只清编译中间产物，保留所有本地安装包 */
function cleanCanonical() {
  const dir = path.join(PROJECT, CANONICAL)
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const keep = entries.filter((e) => !e.isDirectory() && isPreserved(e.name))
  const remove = entries.filter((e) => !keep.includes(e))
  if (keep.length) {
    console.log(`  保留本地安装包/元数据：${keep.map((e) => e.name).join(', ')}`)
  }
  if (!remove.length) {
    console.log('  release/ 已经没有需要清理的编译产物')
    return []
  }
  const failed = []
  for (const e of remove) {
    const p = path.join(dir, e.name)
    process.stdout.write(`  删除 ${CANONICAL}/${e.name} … `)
    const r = rmrf(p)
    console.log(r.ok ? '完成' : '失败')
    if (!r.ok) failed.push({ dir: `${CANONICAL}/${e.name}`, err: r.error })
  }
  return failed
}

function main() {
  const targets = [CANONICAL, ...STRAY].filter((d) => fs.existsSync(path.join(PROJECT, d)))

  if (!targets.length) {
    console.log('✓ 已经是干净状态：没有 release/ 或遗留的构建目录')
    return
  }

  console.log('将处理以下目录：')
  for (const d of targets) {
    const p = path.join(PROJECT, d)
    const isCanonical = d === CANONICAL
    console.log(
      `  ${d.padEnd(14)} ${mb(dirSize(p)).padStart(8)}  ${
        isCanonical ? '（正式产物目录；安装包保留）' : '（遗留，将删除）'
      }`
    )
    if (isCanonical) {
      const kept = fs.readdirSync(p).filter(isPreserved)
      if (kept.length) console.log(`      保留：${kept.join(', ')}`)
    }
  }

  if (DRY) {
    console.log('\n--dry 模式，未做任何改动')
    return
  }

  const holders = findHolders()
  if (holders.length) {
    console.log('\n⚠️ 检测到 PromptPair 正在运行，它可能占着构建产物：')
    for (const h of holders) console.log(`   PID ${h.Id}  ${h.Path}`)
    console.log('   请先退出程序再执行清理。')
  }

  console.log('')
  const failed = []
  for (const d of targets) {
    const p = path.join(PROJECT, d)
    if (PROTECTED.has(d)) {
      console.log(`  ⚠️ 跳过受保护目录：${d}`)
      continue
    }
    if (d === CANONICAL) {
      failed.push(...cleanCanonical())
      continue
    }
    salvageInstallers(p)
    process.stdout.write(`  删除 ${d} … `)
    const r = rmrf(p)
    if (r.ok) {
      console.log('完成')
    } else {
      console.log('失败')
      failed.push({ dir: d, err: r.error })
    }
  }

  if (!failed.length) {
    console.log('\n✓ 清理完成。编译产物已清理，release/ 里的本地安装包按版本保留')
    return
  }

  console.log('\n✗ 以下构建产物没能删干净（通常是被其它进程占用）：')
  for (const f of failed) {
    console.log(`   ${f.dir}: ${f.err?.code || ''} ${f.err?.message || ''}`)
    // 列出还活着的具体文件，方便定位是谁占着
    try {
      const left = []
      const walk = (d) => {
        for (const it of fs.readdirSync(d, { withFileTypes: true })) {
          const fp = path.join(d, it.name)
          if (it.isDirectory()) walk(fp)
          else left.push(fp)
        }
      }
      walk(path.join(PROJECT, f.dir))
      for (const l of left.slice(0, 5)) console.log('      残留: ' + l.replace(PROJECT + path.sep, ''))
      if (left.length > 5) console.log(`      还有 ${left.length - 5} 个…`)
    } catch {
      /* ignore */
    }
  }
  console.log('\n建议：退出所有 PromptPair 实例、暂停实时杀毒，然后重新执行 npm run clean')
  process.exitCode = 1
}

main()
