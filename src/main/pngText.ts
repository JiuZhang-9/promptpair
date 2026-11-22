/**
 * 往 PNG 里写 iTXt 元数据（UTF-8），用于「把提示词绑定进图片」。
 * 不依赖任何库：解析 PNG chunk、在 IHDR 后插入 iTXt、重算 CRC。
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}

/** iTXt: keyword\0 flag(0) method(0) lang\0 translated\0 text(utf8) */
function iTXt(keyword: string, text: string): Buffer {
  const key = Buffer.from(keyword.replace(/\0/g, ''), 'latin1')
  const body = Buffer.concat([
    key,
    Buffer.from([0, 0, 0]), // keyword 结束 + 压缩标志 0 + 压缩方法 0
    Buffer.from([0]), // 空 language tag
    Buffer.from([0]), // 空 translated keyword
    Buffer.from(text, 'utf8')
  ])
  return chunk('iTXt', body)
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export interface PngTextEntry {
  keyword: string
  text: string
}

function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)
}

/**
 * 在 IHDR 之后插入 iTXt；已有同 keyword 的 iTXt/tEXt 先剔除，避免重复。
 */
export function withPngText(png: Buffer, entries: PngTextEntry[]): Buffer {
  if (!isPng(png)) throw new Error('不是 PNG 文件')
  const drop = new Set(entries.map((e) => e.keyword))
  const chunks: Buffer[] = []
  let off = 8
  let inserted = false

  while (off + 12 <= png.length) {
    const len = png.readUInt32BE(off)
    const end = off + 12 + len
    if (end > png.length) throw new Error('PNG 数据损坏')
    const type = png.subarray(off + 4, off + 8).toString('ascii')
    const data = png.subarray(off + 8, off + 8 + len)

    if ((type === 'iTXt' || type === 'tEXt') && data.length) {
      const zero = data.indexOf(0)
      const keyword = (zero === -1 ? data : data.subarray(0, zero)).toString('latin1')
      if (drop.has(keyword)) {
        off = end
        continue
      }
    }

    chunks.push(png.subarray(off, end))
    if (type === 'IHDR' && !inserted) {
      for (const e of entries) chunks.push(iTXt(e.keyword, e.text))
      inserted = true
    }
    off = end
  }

  if (!inserted) throw new Error('PNG 缺少 IHDR')
  return Buffer.concat([PNG_SIG, ...chunks])
}
