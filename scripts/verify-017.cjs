/**
 * 0.17.0 验收入口：连着启动 4 次 Electron，验证窗口记忆与托盘/后台启动。
 *
 * 用法：node scripts/demo-seed.mjs && npm run build && node scripts/verify-017.cjs
 * 只改 .smoke/userdata-017，不碰真实素材库和真实登录项（开发态写入的是 electron.exe）。
 */
const path = require('node:path')
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const runner = path.join(__dirname, 'verify-017-runner.cjs')
const electron = require('electron')
fs.rmSync(path.join(ROOT, '.smoke/017-phase.txt'), { force: true })

const phases = [
  { name: 'first', args: [] },
  { name: 'restore', args: [] },
  { name: 'max', args: [] },
  { name: 'hidden', args: ['--hidden'] }
]

let failed = false
for (const p of phases) {
  console.log(`\n===== phase: ${p.name} =====`)
  const r = spawnSync(electron, [runner, ...p.args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, PP_017_PHASE: p.name }
  })
  if (r.error) {
    console.error('✗ 启动失败：' + r.error.message)
    failed = true
    break
  }
  if (r.status !== 0) {
    failed = true
    break
  }
}

console.log(failed ? '\n✗ 0.17 验收未通过' : '\n✓ 0.17 全部通过')
process.exit(failed ? 1 : 0)
