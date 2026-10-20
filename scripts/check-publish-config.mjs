/**
 * 发布前自检：确认 electron-builder.yml 里的 publish.owner / repo 是真实地址。
 *
 * 为什么需要它：这两个字段写错不会让构建失败，只会让**用户端的自动更新永远 404**。
 * 这个错误还特别隐蔽——安装、使用、打包全都正常，只有点「检查更新」才炸，
 * 而且报的是一屏 HTML。所以在 CI 里前置拦截，比事后排查便宜得多。
 *
 * 用法：node scripts/check-publish-config.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const ymlPath = path.resolve('electron-builder.yml')
if (!fs.existsSync(ymlPath)) {
  console.error('✗ 找不到 electron-builder.yml')
  process.exit(1)
}

const yml = fs.readFileSync(ymlPath, 'utf8')

function pick(key) {
  const m = new RegExp('^\\s*' + key + ':\\s*(.+)$', 'm').exec(yml)
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''
}

const owner = pick('owner')
const repo = pick('repo')
const provider = pick('provider')

const problems = []

if (!provider) problems.push('publish.provider 缺失（应为 github）')
if (!owner) problems.push('publish.owner 缺失')
if (!repo) problems.push('publish.repo 缺失')

const placeholder = /^(your_|YOUR_|xxx|<)/.test(owner) || /GITHUB_NAME|example|changeme/i.test(owner)
if (owner && placeholder) {
  problems.push(
    `publish.owner 还是占位符「${owner}」——这会让用户端自动更新永远 404。\n` +
      `   修法：node scripts/set-repo.mjs <你的GitHub用户名> <仓库名>`
  )
}
if (owner && /[^A-Za-z0-9-]/.test(owner)) {
  problems.push(`publish.owner「${owner}」含非法字符（GitHub 用户名只允许字母、数字、连字符）`)
}
if (repo && /[^A-Za-z0-9._-]/.test(repo)) {
  problems.push(`publish.repo「${repo}」含非法字符`)
}

if (problems.length) {
  console.error('✗ 发布配置有问题，构建已中止：')
  for (const p of problems) console.error('   - ' + p)
  process.exit(1)
}

console.log(`✓ 发布配置：${provider} / ${owner}/${repo}`)
