import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'

/**
 * 分享包的读写。
 *
 * 写：自己写标准 zip（尺寸/CRC 回填到本地头，不用数据描述符）。fflate 的流式写法
 * 只能把尺寸留空，任何按签名扫描的解包器都可能被媒体内容里的 PK 字节带偏。
 * 读：按中央目录取真实偏移和长度，不靠签名切分。
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

/** 过滤危险/非法路径；返回 null 表示跳过该条目 */function safeEntryRel(name: string): string | null {
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

export interface ZipExtractProgress {
  done: number
  total: number
  current: string
}

export async function extractZip(
  zipPath: string,
  destDir: string,
  onProgress?: (p: ZipExtractProgress) => void
): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true })
  const size = fs.statSync(zipPath).size
  const fd = fs.openSync(zipPath, 'r')
  try {
    const entries = readZipEntries(fd, size)
    let done = 0
    for (const e of entries) {
      const rel = safeEntryRel(e.name)
      if (rel) {
        const dest = path.join(destDir, rel)
        fs.mkdirSync(path.dirname(dest), { recursive: true })

        if (!e.compressedSize) {
          fs.writeFileSync(dest, Buffer.alloc(0))
        } else {
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
      }
      done++
      onProgress?.({ done, total: entries.length, current: e.name })
    }
  } finally {
    fs.closeSync(fd)
  }
}

/* ────────────────────────── 写包 ────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 本地时间转 DOS 时间/日期 */
function dosStamp(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

const MAX32 = 0xffffffff

interface WrittenEntry {
  name: Buffer
  flags: number
  crc: number
  size: number
  localOffset: number
}

/**
 * 最小可用的 zip 写入器：只做 stored（不压缩），尺寸与 CRC 回填进本地头。
 * 没有数据描述符，所以任何解包器（含旧版 PromptPair）都能正确读。
 */
export class ZipWriter {
  private fd: number
  private offset = 0
  private entries: WrittenEntry[] = []
  private closed = false
  private readonly stamp: { time: number; date: number }

  constructor(outPath: string) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    this.fd = fs.openSync(outPath, 'w')
    this.stamp = dosStamp(new Date())
  }

  private write(buf: Buffer): void {
    let done = 0
    while (done < buf.length) {
      const n = fs.writeSync(this.fd, buf, done, buf.length - done)
      if (n <= 0) throw new Error('写入分享包失败')
      done += n
    }
    this.offset += buf.length
    if (this.offset > MAX32) throw new Error('分享包超过 4GB，暂不支持')
  }

  private beginEntry(name: string): { nameBuf: Buffer; flags: number; localOffset: number } {
    if (this.entries.length >= 0xffff) throw new Error('分享包文件数超过 65535，暂不支持')
    const nameBuf = Buffer.from(name, 'utf8')
    const flags = /^[\x20-\x7e]*$/.test(name) ? 0 : 0x800
    const localOffset = this.offset
    const hdr = Buffer.alloc(30)
    hdr.writeUInt32LE(0x04034b50, 0)
    hdr.writeUInt16LE(20, 4)
    hdr.writeUInt16LE(flags, 6)
    hdr.writeUInt16LE(0, 8) // stored
    hdr.writeUInt16LE(this.stamp.time, 10)
    hdr.writeUInt16LE(this.stamp.date, 12)
    hdr.writeUInt16LE(nameBuf.length, 26)
    this.write(Buffer.concat([hdr, nameBuf]))
    return { nameBuf, flags, localOffset }
  }

  /** 回填本地头的 crc/csize/usize */
  private endEntry(entry: { nameBuf: Buffer; flags: number; localOffset: number }, crc: number, size: number): void {
    if (size > MAX32) throw new Error('单个文件超过 4GB，暂不支持')
    const patch = Buffer.alloc(12)
    patch.writeUInt32LE(crc, 0)
    patch.writeUInt32LE(size, 4)
    patch.writeUInt32LE(size, 8)
    fs.writeSync(this.fd, patch, 0, patch.length, entry.localOffset + 14)
    this.entries.push({
      name: entry.nameBuf,
      flags: entry.flags,
      crc,
      size,
      localOffset: entry.localOffset
    })
  }

  addBuffer(name: string, data: Buffer): void {
    const entry = this.beginEntry(name)
    this.write(data)
    this.endEntry(entry, crc32(data), data.length)
  }

  addFile(name: string, absPath: string): void {
    const entry = this.beginEntry(name)
    const src = fs.openSync(absPath, 'r')
    const buf = Buffer.allocUnsafe(1 << 20)
    let crc = 0
    let size = 0
    try {
      let n: number
      while ((n = fs.readSync(src, buf, 0, buf.length, null)) > 0) {
        const chunk = buf.subarray(0, n)
        crc = crc32(chunk, crc)
        size += n
        this.write(chunk)
      }
    } finally {
      fs.closeSync(src)
    }
    this.endEntry(entry, crc, size)
  }

  finish(): void {
    if (this.closed) return
    const cdOffset = this.offset
    for (const e of this.entries) {
      const hdr = Buffer.alloc(46)
      hdr.writeUInt32LE(0x02014b50, 0)
      hdr.writeUInt16LE(20, 4)
      hdr.writeUInt16LE(20, 6)
      hdr.writeUInt16LE(e.flags, 8)
      hdr.writeUInt16LE(0, 10) // stored
      hdr.writeUInt16LE(this.stamp.time, 12)
      hdr.writeUInt16LE(this.stamp.date, 14)
      hdr.writeUInt32LE(e.crc, 16)
      hdr.writeUInt32LE(e.size, 20)
      hdr.writeUInt32LE(e.size, 24)
      hdr.writeUInt16LE(e.name.length, 28)
      hdr.writeUInt32LE(e.localOffset, 42)
      this.write(Buffer.concat([hdr, e.name]))
    }
    const cdSize = this.offset - cdOffset
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(this.entries.length, 8)
    eocd.writeUInt16LE(this.entries.length, 10)
    eocd.writeUInt32LE(cdSize, 12)
    eocd.writeUInt32LE(cdOffset, 16)
    this.write(eocd)
    fs.closeSync(this.fd)
    this.closed = true
  }

  /** 出错时关掉句柄（是否删文件由调用方决定） */
  abort(): void {
    if (this.closed) return
    try {
      fs.closeSync(this.fd)
    } catch {
      /* ignore */
    }
    this.closed = true
  }
}
