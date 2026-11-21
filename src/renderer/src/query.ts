/**
 * 搜索框语法解析。
 *
 * 支持：
 *   tag:赛博朋克          tag:"电影感 夜景"
 *   model:即梦            model:"即梦 3.0"
 *   platform:即梦         collection:客户A
 *   code:ox27gsk          风格码 / --sref / --profile 等 MJ 码
 *   rating:>=4            rating:4
 *   kind:image / video
 *   task:t2i / 文生图      task:i2i / 图生图
 *   is:favorite / unrated / rated
 *   has:prompt / negative / note
 *   before:2026-10-20     after:2026-10-01
 *
 * 未知的 key:value 会留在自由文本里，不会报错。
 */

import type { TaskMode } from '../../shared/types'

export type RatingOp = '>=' | '<=' | '>' | '<' | '='
export type QueryKind = 'image' | 'video'
export type QueryFlag = 'favorite' | 'unrated' | 'rated'
export type QueryHas = 'prompt' | 'negative' | 'note'

export interface ParsedQuery {
  text: string
  tags: string[]
  models: string[]
  platforms: string[]
  collections: string[]
  /** 风格码 / MJ 码（code:ox27gsk） */
  codes: string[]
  ratings: { op: RatingOp; value: number }[]
  kinds: QueryKind[]
  /** 生成方式（task:t2i / task:图生图） */
  tasks: TaskMode[]
  flags: QueryFlag[]
  has: QueryHas[]
  before?: string
  after?: string
  errors: string[]
}

const TOKEN = /(tag|model|platform|collection|code|rating|kind|task|is|has|before|after):(?:"([^"]*)"|(\S+))/gi

function normalizeValue(v: string): string {
  return v.trim().toLowerCase()
}

export function parseQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = {
    text: '',
    tags: [],
    models: [],
    platforms: [],
    collections: [],
    codes: [],
    ratings: [],
    kinds: [],
    tasks: [],
    flags: [],
    has: [],
    errors: []
  }
  if (!raw.trim()) return out

  out.text = raw
    .replace(TOKEN, (match, keyRaw, quoted, bare) => {
      const key = String(keyRaw).toLowerCase()
      const value = String(quoted ?? bare ?? '').trim()
      if (!value) {
        out.errors.push(`${key}: 后面缺少值`)
        return ' '
      }

      if (key === 'rating') {
        const m = /^(>=|<=|>|<|=)?(\d(?:\.\d+)?)$/.exec(value)
        const n = m ? Number(m[2]) : NaN
        if (!m || !Number.isFinite(n) || n < 0 || n > 5) {
          out.errors.push(`rating:${value} 不是 0–5 的评分`)
          return ' '
        }
        out.ratings.push({ op: (m[1] as RatingOp) || '=', value: n })
        return ' '
      }

      if (key === 'kind') {
        const v = normalizeValue(value)
        if (v === 'image' || v === '图片' || v === '图像') out.kinds.push('image')
        else if (v === 'video' || v === '视频') out.kinds.push('video')
        else {
          out.errors.push(`kind:${value} 只能是 image / video`)
        }
        return ' '
      }

      if (key === 'task') {
        const v = normalizeValue(value)
        if (v === 't2i' || v === '文生图' || v === '文生' || v === 'text2image')
          out.tasks.push('t2i')
        else if (v === 'i2i' || v === '图生图' || v === '图生' || v === 'img2img')
          out.tasks.push('i2i')
        else out.errors.push(`task:${value} 只能是 t2i / i2i / 文生图 / 图生图`)
        return ' '
      }

      if (key === 'is') {
        const v = normalizeValue(value)
        if (v === 'favorite' || v === '收藏' || v === '已收藏') out.flags.push('favorite')
        else if (v === 'unrated' || v === '未评分' || v === '未打分') out.flags.push('unrated')
        else if (v === 'rated' || v === '已评分' || v === '已打分') out.flags.push('rated')
        else out.errors.push(`is:${value} 不认识`)
        return ' '
      }

      if (key === 'has') {
        const v = normalizeValue(value)
        if (v === 'prompt' || v === 'positive' || v === '提示词' || v === '正向')
          out.has.push('prompt')
        else if (v === 'negative' || v === '负向') out.has.push('negative')
        else if (v === 'note' || v === '备注') out.has.push('note')
        else out.errors.push(`has:${value} 不认识`)
        return ' '
      }

      if (key === 'before' || key === 'after') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          out.errors.push(`${key}:${value} 需要 YYYY-MM-DD`)
          return ' '
        }
        out[key] = value
        return ' '
      }

      if (key === 'tag') out.tags.push(value)
      else if (key === 'model') out.models.push(value)
      else if (key === 'platform') out.platforms.push(value)
      else if (key === 'collection') out.collections.push(value)
      else if (key === 'code') out.codes.push(value)
      return ' '
    })
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  return out
}
