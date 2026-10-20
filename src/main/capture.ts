import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { APP_VERSION } from './version'

/**
 * 浏览器插件采集接收端。
 *
 * 为什么起 HTTP 服务而不是用自定义协议：
 *   插件运行在浏览器沙箱里，没法调 Electron 的 IPC；往 localhost 发 POST 是唯一
 *   既跨进程又不需要额外原生依赖的方式。只监听 127.0.0.1，外部网络访问不到。
 *
 * 端口规则：从 47821 起递增探测，最多试到 47840。实际端口写入
 *   %APPDATA%/PromptPair/capture-port.txt
 * 供插件读取（插件对 47821–47840 逐个探测，谁应答就用谁，所以这个文件只是排障用）。
 */

export const CAPTURE_PORT_START = 47821
export const CAPTURE_PORT_END = 47840

export type CaptureHandler = (payload: any) => Promise<{ ok: boolean; message?: string; entryId?: string }>

let server: http.Server | null = null
let activePort = 0

export function getCapturePort(): number {
  return activePort
}

function cors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
}

function readBody(req: http.IncomingMessage, limit = 64 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function tryListen(port: number, handler: CaptureHandler): Promise<http.Server> {
  const s = http.createServer(async (req, res) => {
    cors(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)

    // 探活：插件用它确认端口
    if (url.pathname === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, app: 'PromptPair', version: APP_VERSION }))
      return
    }

    if (url.pathname === '/capture' && req.method === 'POST') {
      try {
        const buf = await readBody(req)
        const payload = JSON.parse(buf.toString('utf8'))
        const r = await handler(payload)
        res.writeHead(r.ok ? 200 : 400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(r))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: (e as Error).message }))
      }
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, message: 'not found' }))
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      s.close()
      reject(err)
    }
    s.once('error', onError)
    s.listen(port, '127.0.0.1', () => {
      s.off('error', onError)
      resolve()
    })
  })
  return s
}

export async function startCaptureServer(handler: CaptureHandler): Promise<number> {
  for (let p = CAPTURE_PORT_START; p <= CAPTURE_PORT_END; p++) {
    try {
      server = await tryListen(p, handler)
      activePort = p
      try {
        const f = path.join(app.getPath('userData'), 'capture-port.txt')
        fs.writeFileSync(f, String(p), 'utf8')
      } catch {
        /* ignore */
      }
      console.log('[capture] 监听 127.0.0.1:' + p)
      return p
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code !== 'EADDRINUSE') {
        console.error('[capture] 端口 ' + p + ' 启动失败', err.message)
      }
    }
  }
  console.error('[capture] 无可用端口，浏览器采集功能不可用')
  activePort = 0
  return 0
}

export function stopCaptureServer(): void {
  server?.close()
  server = null
  activePort = 0
}
