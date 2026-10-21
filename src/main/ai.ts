import fs from 'node:fs'
import path from 'node:path'
import { app, net } from 'electron'
import type {
  AiSuggestResult,
  AiTagSuggestion,
  AiTestResult,
  AppConfig,
  PromptEntry
} from '../shared/types'
import type { Library } from './library'

/**
 * AI 辅助打标：调用 OpenAI 兼容接口，把缩略图 + 提示词 + 现有标签发给模型，
 * 返回候选标签。只负责"给建议"，写入由用户在界面上确认后触发。
 *
 * 硬约束：不引入新依赖，用 Electron 的 net.fetch（走系统代理）。
 */

interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const MAX_ENTRIES = 40
const CONCURRENCY = 3
const TIMEOUT_MS = 60_000
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

/** 环境变量优先（方便测试/临时覆盖），否则读设置 */
export function effectiveAiConfig(cfg: AppConfig): AiConfig | null {
  const envKey = (process.env.PROMPTPAIR_AI_KEY || '').trim()
  if (!cfg.aiEnabled && !envKey) return null
  const apiKey = (envKey || cfg.aiApiKey || '').trim()
  const baseUrl = (process.env.PROMPTPAIR_AI_BASE_URL || cfg.aiBaseUrl || '').trim()
  const model = (process.env.PROMPTPAIR_AI_MODEL || cfg.aiModel || '').trim()
  if (!apiKey || !baseUrl || !model) return null
  if (!/^https?:\/\//i.test(baseUrl)) return null
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model }
}

function endpoint(baseUrl: string): string {
  return /\/chat\/completions$/i.test(baseUrl) ? baseUrl : baseUrl + '/chat/completions'
}

function cleanBody(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

/** 原始错误写本地日志备查；不记录 Key */
function logAiError(raw: string): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(
      path.join(dir, 'ai.log'),
      `[${new Date().toISOString()}] ${raw}\n`,
      'utf8'
    )
  } catch {
    /* 日志失败不影响主流程 */
  }
}

function humanizeError(status: number, body: string): string {
  const detail = cleanBody(body)
  if (status === 401 || status === 403) return `Key 无效或没有权限（HTTP ${status}）`
  if (status === 404) return '接口地址不对，检查 Base URL 是否以 /v1 结尾（HTTP 404）'
  if (status === 429) return '请求太频繁或额度不足（HTTP 429）'
  if (status >= 500) return `服务端错误（HTTP ${status}）`
  return `请求失败（HTTP ${status}）${detail ? '：' + detail : ''}`
}

async function chat(cfg: AiConfig, body: unknown): Promise<any> {
  let res: Response
  try {
    res = await net.fetch(endpoint(cfg.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (e) {
    const err = e as Error
    const msg = err.name === 'TimeoutError' ? '请求超时' : err.message
    logAiError(`network: ${msg}`)
    throw new Error('连不上 AI 接口：' + msg)
  }

  const text = await res.text()
  if (!res.ok) {
    logAiError(`HTTP ${res.status}: ${cleanBody(text)}`)
    throw new Error(humanizeError(res.status, text))
  }

  try {
    return JSON.parse(text)
  } catch {
    logAiError(`non-json: ${cleanBody(text)}`)
    throw new Error('接口返回的不是 JSON，检查 Base URL 是否指向 OpenAI 兼容接口')
  }
}

/** 取第一条可读的缩略图（视频用抽帧图），转成 data URL */
function imageDataUrl(lib: Library, entry: PromptEntry): string | null {
  for (const id of entry.assetIds) {
    const a = lib.getAsset(id)
    if (!a) continue
    const abs = lib.abs(a.thumbRel || a.relPath)
    try {
      if (!fs.existsSync(abs)) continue
      const st = fs.statSync(abs)
      if (!st.isFile() || st.size === 0 || st.size > MAX_IMAGE_BYTES) continue
      const ext = path.extname(abs).toLowerCase()
      const mime =
        ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
              ? 'image/gif'
              : 'image/jpeg'
      return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`
    } catch {
      /* 这一张读不了，继续找下一张 */
    }
  }
  return null
}

/** 从模型输出里尽量稳地抠出标签数组；失败返回空数组 */
export function parseTags(raw: string): string[] {
  let s = raw.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()

  let parsed: unknown = null
  const arrStart = s.indexOf('[')
  const arrEnd = s.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) {
    try {
      parsed = JSON.parse(s.slice(arrStart, arrEnd + 1))
    } catch {
      /* 继续尝试对象 */
    }
  }
  if (parsed === null) {
    const objStart = s.indexOf('{')
    const objEnd = s.lastIndexOf('}')
    if (objStart >= 0 && objEnd > objStart) {
      try {
        const o = JSON.parse(s.slice(objStart, objEnd + 1)) as { tags?: unknown }
        parsed = Array.isArray(o) ? o : o.tags
      } catch {
        /* ignore */
      }
    }
  }
  if (!Array.isArray(parsed)) return []

  const out: string[] = []
  const seen = new Set<string>()
  for (const x of parsed) {
    if (typeof x !== 'string') continue
    const name = x
      .trim()
      .replace(/^#+/, '')
      .replace(/[，,。；;]+$/g, '')
      .slice(0, 24)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= 8) break
  }
  return out
}

function buildMessages(
  entry: PromptEntry,
  existingTags: string[],
  image: string | null
): unknown[] {
  const text = [
    `现有标签（优先复用；确实不合适才新造）：${existingTags.length ? existingTags.join('、') : '（暂无）'}`,
    `标题：${entry.title || '（无）'}`,
    `正向提示词：${entry.positive || '（无）'}`,
    `负向提示词：${entry.negative || '（无）'}`,
    `备注：${entry.note || '（无）'}`,
    '',
    '请根据图片和以上信息给出 3–6 个中文短标签。规则：',
    '1. 优先从现有标签里选；只有确实不合适时才新造。',
    '2. 每个标签 1–6 个字，不要标点，不要重复。',
    '3. 只返回 JSON 数组，例如 ["赛博朋克","夜景"]。'
  ].join('\n')

  const content: unknown[] = [{ type: 'text', text }]
  if (image) content.push({ type: 'image_url', image_url: { url: image } })

  return [
    { role: 'system', content: '你是素材库的标签助手。只输出 JSON，不要解释、不要代码块。' },
    { role: 'user', content }
  ]
}

async function suggestOne(
  lib: Library,
  cfg: AiConfig,
  entry: PromptEntry,
  existingTags: string[]
): Promise<string[]> {
  const data = await chat(cfg, {
    model: cfg.model,
    messages: buildMessages(entry, existingTags, imageDataUrl(lib, entry)),
    temperature: 0.2,
    max_tokens: 200
  })
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('模型没有返回文本')
  const tags = parseTags(text)
  if (!tags.length) {
    logAiError(`parse: no tags from "${text.slice(0, 200)}"`)
    throw new Error('模型没有给出可用标签')
  }
  return tags
}

export async function suggestTags(
  lib: Library,
  cfg: AppConfig,
  entryIds: string[]
): Promise<AiSuggestResult> {
  if (!cfg.aiEnabled && !process.env.PROMPTPAIR_AI_KEY) throw new Error('AI 打标未启用')
  const ai = effectiveAiConfig(cfg)
  if (!ai) throw new Error('AI 打标还没配置好：需要 Base URL、API Key 和模型名')

  const ids = [...new Set(entryIds)].slice(0, MAX_ENTRIES)
  const entries = ids
    .map((id) => lib.getEntry(id))
    .filter((e): e is PromptEntry => !!e)
  if (!entries.length) throw new Error('没有可打标的记录')

  const usage = new Map<string, number>()
  for (const e of lib.data.entries) {
    for (const id of e.tagIds) usage.set(id, (usage.get(id) ?? 0) + 1)
  }
  const existingTags = lib.data.tags
    .slice()
    .sort(
      (a, b) =>
        (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) ||
        a.name.localeCompare(b.name, 'zh-Hans-CN')
    )
    .map((t) => t.name)
    .slice(0, 200)

  const results: AiTagSuggestion[] = []
  let failed = 0
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < entries.length) {
      const e = entries[cursor++]
      try {
        results.push({ entryId: e.id, tags: await suggestOne(lib, ai, e, existingTags) })
      } catch (err) {
        failed++
        results.push({ entryId: e.id, tags: [], error: (err as Error).message })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, entries.length) }, () => worker())
  )

  const order = new Map(ids.map((id, i) => [id, i]))
  results.sort((a, b) => (order.get(a.entryId) ?? 0) - (order.get(b.entryId) ?? 0))
  return { results, model: ai.model, failed }
}

export async function testAiConnection(cfg: AppConfig): Promise<AiTestResult> {
  if (!cfg.aiEnabled && !process.env.PROMPTPAIR_AI_KEY) {
    return { ok: false, message: 'AI 打标未启用' }
  }
  const ai = effectiveAiConfig(cfg)
  if (!ai) return { ok: false, message: '还没有填写 Base URL、API Key 或模型名' }
  try {
    const data = await chat(ai, {
      model: ai.model,
      messages: [{ role: 'user', content: '只回复 ok' }],
      max_tokens: 8,
      temperature: 0
    })
    const text = data?.choices?.[0]?.message?.content
    return {
      ok: true,
      message: `连接正常${text ? '：' + String(text).slice(0, 40) : ''}`,
      model: ai.model
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message, model: ai.model }
  }
}
