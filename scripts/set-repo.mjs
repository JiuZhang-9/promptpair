/**
 * 把 GitHub 仓库地址写入打包配置与 package.json。
 * 用法：node scripts/set-repo.mjs <GitHub用户名> [仓库名]
 * 例：  node scripts/set-repo.mjs zhangwei
 *
 * 为什么需要这一步：electron-updater 靠 electron-builder.yml 里的 owner/repo
 * 找到 Releases，填错就永远收不到更新，而且不会报错——所以单独做成一条命令。
 */
import fs from 'node:fs'
import path from 'node:path'

const owner = process.argv[2]
const repo = process.argv[3] || 'promptpair'

if (!owner) {
  console.error('用法：node scripts/set-repo.mjs <GitHub用户名> [仓库名]')
  process.exit(1)
}

const ymlPath = path.resolve('electron-builder.yml')
let yml = fs.readFileSync(ymlPath, 'utf8')
yml = yml.replace(/^(\s*owner:\s*).*$/m, `$1${owner}`)
yml = yml.replace(/^(\s*repo:\s*).*$/m, `$1${repo}`)
fs.writeFileSync(ymlPath, yml, 'utf8')

const pkgPath = path.resolve('package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
pkg.repository = { type: 'git', url: `git+https://github.com/${owner}/${repo}.git` }
pkg.homepage = `https://github.com/${owner}/${repo}`
pkg.bugs = { url: `https://github.com/${owner}/${repo}/issues` }
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

console.log('✓ 已写入仓库地址')
console.log(`   electron-builder.yml → publish.owner=${owner}, publish.repo=${repo}`)
console.log(`   package.json         → repository/homepage/bugs`)
console.log('')
console.log('接下来的步骤：')
console.log(`   1. 在 GitHub 上新建公开仓库：https://github.com/new  （名字填 ${repo}）`)
console.log('   2. git remote add origin https://github.com/' + owner + '/' + repo + '.git')
console.log('   3. git push -u origin main && git push --tags')
console.log('')
console.log('⚠️  之后每次发布必须：仓库是 public、Release 是「已发布」而非草稿、')
console.log('    版本号递增。否则客户端收不到更新（详见 docs/发布规范.md）。')
