import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'

/**
 * 分享包解压。
 *
 * 不用 fflate 的流式 Unzip：导出端写的是带数据描述符的条目（本地头里尺寸为 0），
 * 流式解包只能靠扫描下一个 PK 签名来切分条目，媒体文件里恰好出现该字节序列就会
 * 错位、读出乱码文件名（ENOENT: mkdir）。这里改为读中央目录、按真实偏移取数据。
 */

export interface ZipEntryMeta {
  name: string
  method: number
  compressedSize: number
  dataOffset: number
}

/** 稳定读满指定长度（readSync 在个别情况下会短读） */
function readExact(fd: number, buf: Buffer, position: number): void {
  let got = 0
  while (got < buf.length) {
    const n = fs.readSync(fd, buf, got, buf.length - got, position + got)
    if (n <= 0) return
    got += n
  }
}

/** 读中央目录，拿到每个条目的真实偏移与长度 */
export function readZipEntries(fd: number, size: number): ZipEntryMeta[] {
  const tailLen = Math.min(size, 22 + 0xffff)
  const tail = Buffer.allocUnsafe(tailLen)
  readExact(fd, tail, size - tailLen)

  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的分享包（找不到 ZIP 中央目录）')

  const cdSize = tail.readUInt32LE(eocd + 12)
  const cdOff = tail.readUInt32LE(eocd + 16)
  if (cdOff === 0xffffffff || cdSize === 0xffffffff) throw new Error('暂不支持 ZIP64 分享包')
  if (cdSize > 64 * 1024 * 1024) throw new Error('分享包目录异常（过大）')

  const cd = Buffer.allocUnsafe(cdSize)
  if (cdSize) readExact(fd, cd, cdOff)

  const out: ZipEntryMeta[] = []
  let off = 0
  while (off + 46 <= cdSize && cd.readUInt32LE(off) === 0x02014b50) {
    const method = cd.readUInt16LE(off + 10)
    const csize = cd.readUInt32LE(off + 20)
    const fnl = cd.readUInt16LE(off + 28)
    const es = cd.readUInt16LE(off + 30)
    const cs = cd.readUInt16LE(off + 32)
    const lho = cd.readUInt32LE(off + 42)
    const name = cd.toString('utf8', off + 46, off + 46 + fnl)

    // 本地头的扩展字段长度可能和中央目录不同，数据偏移要按本地头算
    const local = Buffer.allocUnsafe(30)
    readExact(fd, local, lho)
    if (local.readUInt32LE(0) === 0x04034b50 && csize !== 0xffffffff) {
      out.push({
        name,
        method,
        compressedSize: csize,
        dataOffset: lho + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
      })
    }
    off += 46 + fnl + es + cs
  }
  return out
}

/** 过滤危险/非法路径；返回 null 表示跳过该条目 */
function safeEntryRel(name: string): string | null {
  const rel = name.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!rel || rel.includes('..') || rel.endsWith('/')) return null
  const segs = rel.split('/').map((s) => s.trim())
  for (const s of segs) {
    // Windows 不允许的字符会让 mkdir 抛 ENOENT，跳过条目而不是让整包导入失败
    if (!s || /[<>:"|?*\x00-\x1f]/.test(s)) return null
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) return null
  }
  return segs.join(path.sep)
}

export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true })
  const size = fs.statSync(zipPath).size
  const fd = fs.openSync(zipPath, 'r')
  try {
    for (const e of readZipEntries(fd, size)) {
      const rel = safeEntryRel(e.name)
      if (!rel) continue
      const dest = path.join(destDir, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })

      if (!e.compressedSize) {
        fs.writeFileSync(dest, Buffer.alloc(0))
        continue
      }
      const src = fs.createReadStream(zipPath, {
        start: e.dataOffset,
        end: e.dataOffset + e.compressedSize - 1
      })
      const dst = fs.createWriteStream(dest)
      if (e.method === 0) await pipeline(src, dst)
      else if (e.method === 8) await pipeline(src, zlib.createInflateRaw(), dst)
      else {
        src.destroy()
        dst.destroy()
        fs.rmSync(dest, { force: true })
      }
    }
  } finally {
    fs.closeSync(fd)
  }
}
