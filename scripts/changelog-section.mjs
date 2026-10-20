/**
 * 从 CHANGELOG.md 里抽出指定版本的章节，供 GitHub Release 正文使用。
 *
 * 为什么需要它：electron-builder 发布的 Release 默认没有正文，
 * 用户点进 Releases 页面只能看到一串安装包。把 CHANGELOG 的对应段落
 * 贴进去，"这个版本改了什么"才一目了然。
 *
 * 用法：
 *   node scripts/changelog-section.mjs 0.2.0            > notes.md
 *   node scripts/changelog-section.mjs 0.2.0 --with-title
 */
import fs from 'node:fs'
import path from 'node:path'

const version = (process.argv[2] || '').replace(/^v/, '').trim()
const withTitle = process.argv.includes('--with-title')

if (!version) {
  console.error('用法：node scripts/changelog-section.mjs <版本号> [--with-title]')
  process.exit(1)
}

const file = path.resolve('CHANGELOG.md')
if (!fs.existsSync(file)) {
  console.error('找不到 CHANGELOG.md')
  process.exit(1)
}

const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')

// 匹配 "## [0.2.0] - 2026-10-20" 或 "## [0.2.0]"
const headRe = new RegExp(`^##\\s+\\[${version.replace(/\./g, '\\.')}\\]`)
let start = -1
for (let i = 0; i < lines.length; i++) {
  if (headRe.test(lines[i])) {
    start = i
    break
  }
}

if (start < 0) {
  console.error(`CHANGELOG.md 里没有 [${version}] 这一段`)
  process.exit(1)
}

let end = lines.length
for (let i = start + 1; i < lines.length; i++) {
  if (/^##\s+\[/.test(lines[i]) || /^---\s*$/.test(lines[i])) {
    end = i
    break
  }
}

const body = lines.slice(start + 1, end).join('\n').trim()
if (!body) {
  console.error(`[${version}] 这一段是空的`)
  process.exit(1)
}

if (withTitle) {
  console.log(lines[start].replace(/^##\s+/, '').trim())
  console.log('')
}
console.log(body)
