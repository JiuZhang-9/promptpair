/**
 * 视频元数据（时长 / 分辨率）——纯 JS 容器解析，零依赖。
 *
 * 为什么不用别的方案：
 * - ffprobe：给安装包加 ~50 MB 原生二进制，违反「零原生模块依赖」硬约束
 * - Windows Shell API：实测（2026-10-24，zh-CN Win10 22H2）GetDetailsOf 拿不到
 *   媒体属性（时长/分辨率列为空），且列序随语言环境变化、值是格式化字符串
 * - 因此直接解析容器头：mp4/mov/m4v（ISOBMFF box）、webm/mkv（EBML）、avi（RIFF）
 *
 * 只读容器头，不碰码流数据：ISOBMFF 按顶层 box 偏移只取 moov；
 * EBML 的 Info/Tracks 按规范位于 Segment 开头，读文件前缀即可；
 * 解析失败一律返回 null，由调用方回退到缩略图尺寸（现状行为）。
 */
import fs from 'node:fs'

export interface VideoMeta {
  /** 秒（浮点） */
  seconds?: number
  width?: number
  height?: number
}

const ISOBMFF_EXTS = ['.mp4', '.mov', '.m4v']
const EBML_EXTS = ['.webm', '.mkv']

/** moov 理论上可以很大（多音轨/章节），8 MB 上限足够且防异常文件撑爆内存 */
const MAX_MOOV_BYTES = 8 * 1024 * 1024
/** EBML 的 Info/Tracks 在 Segment 头部；512 KB 前缀对正常文件绰绰有余 */
const EBML_PREFIX_BYTES = 512 * 1024

/* ────────────────────────── ISOBMFF（mp4 / mov / m4v） ────────────────────────── */

interface BoxHead {
  type: string
  size: number
  hdr: number
}

function readBoxHead(buf: Buffer, off: number): BoxHead | null {
  if (off + 8 > buf.length) return null
  let size = buf.readUInt32BE(off)
  const type = buf.toString('latin1', off + 4, off + 8)
  let hdr = 8
  if (size === 1) {
    if (off + 16 > buf.length) return null
    size = Number(buf.readBigUInt64BE(off + 8))
    hdr = 16
  } else if (size === 0) {
    size = buf.length - off
  }
  if (size < hdr || off + size > buf.length) return null
  return { type, size, hdr }
}

/** 在一段 buffer 内按路径找 box（只用于 moov 内部，moov 已整体在内存里） */
function findBox(buf: Buffer, start: number, end: number, path: string[]): BoxHead & { off: number } | null {
  let pos = start
  while (pos + 8 <= end) {
    const head = readBoxHead(buf, pos)
    if (!head) return null
    if (head.type === path[0]) {
      if (path.length === 1) return { ...head, off: pos }
      const inner = findBox(buf, pos + head.hdr, pos + head.size, path.slice(1))
      if (inner) return inner
    }
    pos += head.size
  }
  return null
}

/** mvhd：v0 = 32bit timescale@+12 / duration@+16；v1 = 32bit timescale@+20 / 64bit duration@+24 */
function parseMvhd(buf: Buffer, mvhdOff: number): { seconds: number } | null {
  const head = readBoxHead(buf, mvhdOff)
  if (!head) return null
  const b = mvhdOff + head.hdr
  if (b + 32 > buf.length) return null
  let timescale: number
  let duration: number
  if (buf[b] === 1) {
    if (b + 32 > buf.length) return null
    timescale = buf.readUInt32BE(b + 20)
    duration = Number(buf.readBigUInt64BE(b + 24))
  } else {
    timescale = buf.readUInt32BE(b + 12)
    duration = buf.readUInt32BE(b + 16)
  }
  if (!timescale) return null
  return { seconds: duration / timescale }
}

/** tkhd：宽高在尾部，16.16 定点数；v0 @+76/+80（载荷 84 字节）、v1 @+88/+92（96 字节）。跳过宽高为 0 的轨（封面轨等） */
function parseTkhdSize(buf: Buffer, tkhdOff: number): { width: number; height: number } | null {
  const head = readBoxHead(buf, tkhdOff)
  if (!head) return null
  const t = tkhdOff + head.hdr
  if (t >= buf.length) return null
  const v1 = buf[t] === 1
  const off = v1 ? 88 : 76
  // 以 box 自身边界为限，防止 tkhd 是 trak 最后一个 box 时误判越界
  if (t + off + 8 > tkhdOff + head.size) return null
  const w = buf.readUInt32BE(t + off) / 65536
  const h = buf.readUInt32BE(t + off + 4) / 65536
  if (w <= 0 || h <= 0) return null
  return { width: Math.round(w), height: Math.round(h) }
}

async function probeIsoBmff(fd: fs.promises.FileHandle, fileSize: number): Promise<VideoMeta | null> {
  const header = Buffer.alloc(16)
  let pos = 0
  while (pos + 8 <= fileSize) {
    const { bytesRead } = await fd.read(header, 0, 16, pos)
    if (bytesRead < 8) return null
    let boxSize = header.readUInt32BE(0)
    const type = header.toString('latin1', 4, 8)
    let hdr = 8
    if (boxSize === 1) {
      if (bytesRead < 16) return null
      boxSize = Number(header.readBigUInt64BE(8))
      hdr = 16
    } else if (boxSize === 0) {
      boxSize = fileSize - pos
    }
    if (boxSize < hdr || pos + boxSize > fileSize) return null

    if (type === 'moov') {
      const len = Math.min(boxSize, MAX_MOOV_BYTES)
      const moov = Buffer.alloc(len)
      const r = await fd.read(moov, 0, len, pos)
      const end = r.bytesRead
      const mvhd = findBox(moov, 0, end, ['moov', 'mvhd'])
      const seconds = mvhd ? parseMvhd(moov, mvhd.off)?.seconds : undefined
      // 取第一个宽高非 0 的 tkhd（视频轨）；封面/音频轨宽高为 0 会被跳过
      let width: number | undefined
      let height: number | undefined
      let from = 0
      while (width === undefined) {
        const tkhd = findBox(moov, from, end, ['moov', 'trak', 'tkhd'])
        if (!tkhd) break
        const size = parseTkhdSize(moov, tkhd.off)
        if (size) {
          width = size.width
          height = size.height
        }
        from = tkhd.off + tkhd.size
      }
      if (seconds === undefined && width === undefined) return null
      return { seconds, width, height }
    }
    pos += boxSize
  }
  return null
}

/* ────────────────────────── EBML（webm / mkv） ────────────────────────── */

const ID_SEGMENT = 0x18538067
const ID_INFO = 0x1549a966
const ID_TRACKS = 0x1654ae6b
const ID_TRACK_ENTRY = 0xae
const ID_VIDEO = 0xe0
const ID_TIMECODE_SCALE = 0x2ad7b1
const ID_DURATION = 0x4489
const ID_PIXEL_WIDTH = 0xb0
const ID_PIXEL_HEIGHT = 0xba
const EBML_CONTAINERS = new Set([ID_SEGMENT, ID_INFO, ID_TRACKS, ID_TRACK_ENTRY, ID_VIDEO])

function readVint(buf: Buffer, pos: number, keepMarker = false): { value: number; len: number } | null {
  const first = buf[pos]
  if (first === undefined || first === 0) return null
  let len = 1
  let mask = 0x80
  while (len <= 8 && !(first & mask)) {
    len++
    mask >>= 1
  }
  if (len > 8 || pos + len > buf.length) return null
  let value = keepMarker ? first : first & (mask - 1)
  for (let i = 1; i < len; i++) value = value * 256 + buf[pos + i]
  return { value, len }
}

/** EBML 整数是变长的（1–8 字节），必须按元素实际宽度读 */
function readEbmlUint(buf: Buffer, pos: number, size: number): number | undefined {
  if (size <= 0 || size > 8 || pos + size > buf.length) return undefined
  if (size <= 4) {
    let v = 0
    for (let i = 0; i < size; i++) v = v * 256 + buf[pos + i]
    return v
  }
  return Number(buf.readBigUInt64BE(pos) >> BigInt((8 - size) * 8))
}

function probeEbmlPrefix(prefix: Buffer): VideoMeta | null {
  let durationSeconds: number | undefined
  let pixelWidth: number | undefined
  let pixelHeight: number | undefined
  let timecodeScale = 1e6 // EBML 默认 1 ms

  const walk = (start: number, end: number): void => {
    let pos = start
    while (pos < end) {
      const id = readVint(prefix, pos, true)
      if (!id) return
      const size = readVint(prefix, pos + id.len)
      if (!size) return
      const dataPos = pos + id.len + size.len
      // 未知长度（全 1 VINT）或被前缀截断时，钳到缓冲区尾部
      const dataSize = Math.min(size.value, end - dataPos)
      if (EBML_CONTAINERS.has(id.value) && dataSize > 0) {
        walk(dataPos, dataPos + dataSize)
      } else if (id.value === ID_TIMECODE_SCALE) {
        timecodeScale = readEbmlUint(prefix, dataPos, dataSize) ?? 1e6
      } else if (id.value === ID_DURATION) {
        const raw = prefix.subarray(dataPos, dataPos + dataSize)
        const value = dataSize === 4 ? raw.readFloatBE(0) : raw.readDoubleBE(0)
        if (Number.isFinite(value)) durationSeconds = (value * timecodeScale) / 1e9
      } else if (id.value === ID_PIXEL_WIDTH) {
        pixelWidth = readEbmlUint(prefix, dataPos, dataSize)
      } else if (id.value === ID_PIXEL_HEIGHT) {
        pixelHeight = readEbmlUint(prefix, dataPos, dataSize)
      }
      pos = dataPos + dataSize
    }
  }
  walk(0, prefix.length)
  if (durationSeconds === undefined && pixelWidth === undefined) return null
  return { seconds: durationSeconds, width: pixelWidth, height: pixelHeight }
}

/* ────────────────────────── RIFF（avi） ────────────────────────── */

/**
 * 只解析 avih（MainAVIHeader）：宽高在 +32/+36，时长 = 总帧数 × 每帧微秒。
 * 部分文件的 dwMicroSecPerFrame 为 0（依赖 strh 帧率），这种情况只给分辨率。
 */
async function probeAvi(fd: fs.promises.FileHandle, fileSize: number): Promise<VideoMeta | null> {
  const len = Math.min(fileSize, 64 * 1024)
  const head = Buffer.alloc(len)
  const r = await fd.read(head, 0, len, 0)
  const end = r.bytesRead
  if (end < 48 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'AVI ') {
    return null
  }

  const walk = (start: number, end: number): VideoMeta | null => {
    let pos = start
    while (pos + 8 <= end) {
      const fourcc = head.toString('latin1', pos, pos + 4)
      const size = head.readUInt32BE(pos + 4)
      if (size > end - pos - 8) return null
      if (fourcc === 'LIST') {
        const inner = walk(pos + 12, Math.min(pos + 8 + size, end))
        if (inner) return inner
      } else if (fourcc === 'avih' && size >= 40) {
        const b = pos + 8
        const microPerFrame = head.readUInt32LE(b)
        const totalFrames = head.readUInt32LE(b + 16)
        const width = head.readUInt32LE(b + 32)
        const height = head.readUInt32LE(b + 36)
        const seconds = microPerFrame > 0 && totalFrames > 0 ? (totalFrames * microPerFrame) / 1e6 : undefined
        if (seconds === undefined && !(width > 0 && height > 0)) return null
        return { seconds, width: width > 0 ? width : undefined, height: height > 0 ? height : undefined }
      }
      pos += 8 + size + (size % 2) // RIFF chunk 按 2 字节对齐
    }
    return null
  }
  return walk(12, end)
}

/* ────────────────────────── 入口 ────────────────────────── */

/**
 * 读取视频的时长与分辨率。失败（不支持/损坏/解析不了）返回 null，
 * 由调用方决定回退行为，本模块不抛异常。
 */
export async function readVideoMeta(absPath: string, ext: string): Promise<VideoMeta | null> {
  let fd: fs.promises.FileHandle | null = null
  try {
    const e = ext.toLowerCase()
    if (!ISOBMFF_EXTS.includes(e) && !EBML_EXTS.includes(e) && e !== '.avi') return null
    fd = await fs.promises.open(absPath, 'r')
    const stat = await fd.stat()
    if (!stat.isFile() || stat.size < 64) return null
    if (ISOBMFF_EXTS.includes(e)) return await probeIsoBmff(fd, stat.size)
    if (e === '.avi') return await probeAvi(fd, stat.size)
    const prefix = Buffer.alloc(Math.min(stat.size, EBML_PREFIX_BYTES))
    const r = await fd.read(prefix, 0, prefix.length, 0)
    return probeEbmlPrefix(prefix.subarray(0, r.bytesRead))
  } catch {
    return null
  } finally {
    await fd?.close().catch(() => {})
  }
}
