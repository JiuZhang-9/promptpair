import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import type { PromptParams } from '../shared/types'

/**
 * 旁车文件（sidecar）与内嵌元数据解析。
 * 目标：批量导入旧素材时，尽量自动把「提示词 + 生成参数」捞出来，而不是让用户手抄。
 * 支持：
 *  1) 同名 .txt  —— SD WebUI / 手动保存的提示词
 *  2) PNG tEXt/iTXt/zTXt —— SD WebUI 写在 PNG 里的 parameters / Comment
 *  3) 同名 .json —— ComfyUI 工作流（启发式提取文本节点）
 */

/** 读取 PNG 文本块 */
export function readPngTextChunks(filePath: string): Record<string, string> {
  const out: Record<string, string> = {}
  let buf: Buffer
  try {
    buf = fs.readFileSync(filePath)
  } catch {
    return out
  }
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return out

  let pos = 8
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const dataStart = pos + 8
    const dataEnd = dataStart + len
    if (dataEnd + 4 > buf.length) break

    try {
      if (type === 'tEXt') {
        const chunk = buf.subarray(dataStart, dataEnd)
        const zero = chunk.indexOf(0)
        if (zero > 0) {
          const key = chunk.toString('latin1', 0, zero)
          out[key] = chunk.toString('latin1', zero + 1)
        }
      } else if (type === 'iTXt') {
        const chunk = buf.subarray(dataStart, dataEnd)
        const zero = chunk.indexOf(0)
        if (zero > 0) {
          const key = chunk.toString('latin1', 0, zero)
          const compFlag = chunk[zero + 1]
          // zero+2 = compMethod, then langTag\0 translatedKeyword\0 text
          let p = zero + 3
          const langEnd = chunk.indexOf(0, p)
          p = langEnd + 1
          const transEnd = chunk.indexOf(0, p)
          p = transEnd + 1
          const payload = chunk.subarray(p)
          out[key] =
            compFlag === 1
              ? zlib.inflateSync(payload).toString('utf8')
              : payload.toString('utf8')
        }
      } else if (type === 'zTXt') {
        const chunk = buf.subarray(dataStart, dataEnd)
        const zero = chunk.indexOf(0)
        if (zero > 0) {
          const key = chunk.toString('latin1', 0, zero)
          out[key] = zlib.inflateSync(chunk.subarray(zero + 2)).toString('latin1')
        }
      } else if (type === 'IEND') break
    } catch {
      /* 单个块解析失败不影响其它 */
    }

    pos = dataEnd + 4
  }
  return out
}

export interface ParsedPrompt {
  positive: string
  negative: string
  params: PromptParams
}

const EMPTY: ParsedPrompt = { positive: '', negative: '', params: {} }

/** 解析 SD WebUI 的 parameters 文本（也兼容纯提示词文本） */
export function parseWebUiParameters(text: string): ParsedPrompt {
  const raw = (text || '').replace(/\r\n/g, '\n').trim()
  if (!raw) return { ...EMPTY, params: {} }

  const lines = raw.split('\n')
  // 末尾一行形如 "Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 1, Size: 512x512"
  let paramLine = ''
  const last = lines[lines.length - 1] || ''
  if (/^[A-Za-z][\w ]*:\s/.test(last) && /,\s*[A-Za-z][\w ]*:/.test(last)) {
    paramLine = last
    lines.pop()
  }

  let positive = lines.join('\n').trim()
  let negative = ''

  const negIdx = positive.indexOf('Negative prompt:')
  if (negIdx >= 0) {
    negative = positive.slice(negIdx + 'Negative prompt:'.length).trim()
    positive = positive.slice(0, negIdx).trim()
  }

  const params: PromptParams = {}
  if (paramLine) {
    const extra: Record<string, string> = {}
    // 用 ", Key: value" 切分，注意 Size 之类的组合值
    const parts = paramLine.split(/,\s*(?=[A-Za-z][\w ]*:)/)
    for (const part of parts) {
      const i = part.indexOf(':')
      if (i < 0) continue
      const k = part.slice(0, i).trim()
      const v = part.slice(i + 1).trim()
      switch (k) {
        case 'Steps':
          params.steps = Number(v) || undefined
          break
        case 'Sampler':
          params.sampler = v
          break
        case 'CFG scale':
          params.cfg = Number(v) || undefined
          break
        case 'Seed':
          params.seed = v
          break
        case 'Model':
        case 'Model hash':
          if (k === 'Model') params.model = v
          break
        case 'Size': {
          const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(v)
          if (m) {
            params.width = Number(m[1])
            params.height = Number(m[2])
          }
          break
        }
        default:
          if (k !== 'Model hash') extra[k] = v
      }
    }
    if (Object.keys(extra).length) params.extra = extra
  }

  return { positive, negative, params }
}

/** 从 ComfyUI 工作流 JSON 中启发式提取提示词 */
export function parseComfyWorkflow(json: any): ParsedPrompt {
  const result: ParsedPrompt = { positive: '', negative: '', params: {} }
  const nodes = json?.prompt ?? json?.workflow?.nodes ?? null

  const texts: string[] = []
  const models: string[] = []
  const walk = (obj: any): void => {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      obj.forEach(walk)
      return
    }
    const cls: string = obj.class_type ?? obj.type ?? ''
    const widgets = obj.widgets_values ?? obj.inputs
    if (/CLIPTextEncode|TextEncode|PrimitiveNode|String/i.test(cls) && widgets) {
      const vals = Array.isArray(widgets)
        ? widgets.filter((x) => typeof x === 'string' && x.trim().length > 1)
        : Object.values(widgets).filter((x) => typeof x === 'string' && (x as string).trim().length > 1)
      for (const v of vals) texts.push(v as string)
    }
    if (/CheckpointLoader|UNETLoader/i.test(cls) && widgets) {
      const vals = Array.isArray(widgets) ? widgets : Object.values(widgets)
      for (const v of vals) if (typeof v === 'string' && /\.(safetensors|ckpt)$/i.test(v)) models.push(v)
    }
    for (const k of Object.keys(obj)) walk(obj[k])
  }
  walk(nodes)

  // 最长的一段当正向，含 negative 字样的当负向
  const uniq = [...new Set(texts.map((t) => t.trim()))]
  const negLike = uniq.filter((t) => /negativ|低质量|worst quality/i.test(t))
  const posLike = uniq.filter((t) => !negLike.includes(t))
  posLike.sort((a, b) => b.length - a.length)

  result.positive = posLike[0] ?? ''
  result.negative = negLike[0] ?? ''
  if (models.length) result.params.model = path.basename(models[0]).replace(/\.(safetensors|ckpt)$/i, '')
  return result
}

/** 从文件名里猜生成参数（很多平台的导出命名很规律） */
export function parseParamsFromFilename(name: string): PromptParams {
  const p: PromptParams = {}
  const base = name.replace(/\.[^.]+$/, '')

  const seed = /(?:^|[_\-\s])seed[_\-\s:=]*(\d{3,})/i.exec(base)
  if (seed) p.seed = seed[1]

  const size = /(?:^|[_\-\s])(\d{3,5})\s*[x×]\s*(\d{3,5})(?:$|[_\-\s])/.exec(base)
  if (size) {
    p.width = Number(size[1])
    p.height = Number(size[2])
  }

  const steps = /steps[_\-\s:=]*(\d{1,3})/i.exec(base)
  if (steps) p.steps = Number(steps[1])

  const cfg = /cfg[_\-\s:=]*([\d.]+)/i.exec(base)
  if (cfg) p.cfg = Number(cfg[1])

  return p
}

export interface SidecarResult {
  prompt: ParsedPrompt
  /** 元数据来自哪里，便于界面提示可信度 */
  origin: 'png' | 'txt' | 'json' | 'none'
}

/** 给定媒体文件，尝试找出配套的提示词与参数 */
export function readSidecar(mediaPath: string): SidecarResult {
  const dir = path.dirname(mediaPath)
  const ext = path.extname(mediaPath).toLowerCase()
  const stem = path.basename(mediaPath, path.extname(mediaPath))

  // 1) PNG 内嵌（最可信，SD WebUI 直接写在图里）
  if (ext === '.png') {
    const chunks = readPngTextChunks(mediaPath)
    const params = chunks['parameters'] ?? chunks['Parameters']
    if (params) return { prompt: parseWebUiParameters(params), origin: 'png' }
    const comment = chunks['Comment'] ?? chunks['comment']
    if (comment) return { prompt: parseWebUiParameters(comment), origin: 'png' }
    const desc = chunks['Description'] ?? chunks['description']
    if (desc) return { prompt: { positive: desc, negative: '', params: {} }, origin: 'png' }
  }

  // 2) 同名 .txt
  for (const cand of [`${stem}.txt`, `${stem}.TXT`, `${stem}.prompt`, `${stem}.md`]) {
    const p = path.join(dir, cand)
    if (fs.existsSync(p)) {
      try {
        const text = fs.readFileSync(p, 'utf8')
        return { prompt: parseWebUiParameters(text), origin: 'txt' }
      } catch {
        /* ignore */
      }
    }
  }

  // 3) 同名 .json（ComfyUI）
  for (const cand of [`${stem}.json`, `${stem}.JSON`]) {
    const p = path.join(dir, cand)
    if (fs.existsSync(p)) {
      try {
        const json = JSON.parse(fs.readFileSync(p, 'utf8'))
        const parsed = parseComfyWorkflow(json)
        if (parsed.positive || parsed.params.model)
          return { prompt: parsed, origin: 'json' }
      } catch {
        /* ignore */
      }
    }
  }

  return { prompt: { positive: '', negative: '', params: parseParamsFromFilename(stem) }, origin: 'none' }
}

/**
 * 按「组名」找旁车文件。
 * 场景：一次生成产出 city_1.png / city_2.png / city_3.png，用户只存了一份 city.txt。
 * 这时按文件全名找不到，要按去掉尾号的组名再找一次。
 */
export function readSidecarByStem(mediaPath: string, stem: string): SidecarResult {
  const dir = path.dirname(mediaPath)
  const baseStem = path.basename(mediaPath, path.extname(mediaPath))
  if (!stem || stem === baseStem) return { prompt: { ...EMPTY, params: {} }, origin: 'none' }

  for (const cand of [`${stem}.txt`, `${stem}.TXT`, `${stem}.prompt`, `${stem}.md`]) {
    const p = path.join(dir, cand)
    if (!fs.existsSync(p)) continue
    try {
      const text = fs.readFileSync(p, 'utf8')
      return { prompt: parseWebUiParameters(text), origin: 'txt' }
    } catch {
      /* ignore */
    }
  }

  for (const cand of [`${stem}.json`, `${stem}.JSON`]) {
    const p = path.join(dir, cand)
    if (!fs.existsSync(p)) continue
    try {
      const json = JSON.parse(fs.readFileSync(p, 'utf8'))
      const parsed = parseComfyWorkflow(json)
      if (parsed.positive || parsed.params.model) return { prompt: parsed, origin: 'json' }
    } catch {
      /* ignore */
    }
  }

  return { prompt: { ...EMPTY, params: {} }, origin: 'none' }
}

/** 平台识别：从路径/文件名/页面标题猜来源 */
const PLATFORM_RULES: { re: RegExp; name: string }[] = [
  { re: /jimeng|dreamina|即梦/i, name: '即梦' },
  { re: /kling|可灵/i, name: '可灵' },
  { re: /midjourney|[_\-\s]mj[_\-\s]|mj_/i, name: 'Midjourney' },
  { re: /liblib|哩布/i, name: 'LiblibAI' },
  { re: /comfy/i, name: 'ComfyUI' },
  { re: /webui|stable[\s_-]?diffusion|[_\-\s]sd[_\-\s]/i, name: 'Stable Diffusion' },
  { re: /doubao|豆包/i, name: '豆包' },
  { re: /tongyi|wanx|通义|万相/i, name: '通义万相' },
  { re: /runway/i, name: 'Runway' },
  { re: /pika/i, name: 'Pika' },
  { re: /sora/i, name: 'Sora' },
  { re: /hailuo|海螺|minimax/i, name: '海螺' },
  { re: /vidu|生数/i, name: 'Vidu' }
]

export function detectPlatform(...hints: (string | undefined)[]): string | undefined {
  const text = hints.filter(Boolean).join(' \n ')
  if (!text) return undefined
  for (const r of PLATFORM_RULES) if (r.re.test(text)) return r.name
  return undefined
}
