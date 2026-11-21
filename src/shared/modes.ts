/**
 * 0.15.0 分得清：生成方式（T2I / I2I）与模型能力。
 *
 * 这里是纯函数，主进程（迁移 / 导入 / CLI / 分享包）和渲染层共用。
 * 约定：
 * - PromptEntry.task 只有 t2i / i2i 两种；老库迁移时推断一次，之后由用户改。
 * - ModelPreset.capabilities 描述「这个词表模型能做哪些事」，内置模型有默认值；
 *   自定义模型按 kind 给默认能力，也可以在模型管理里后续扩展。
 */
import type { ModelCapabilities, ModelKind, PromptParams, TaskMode } from './types'

export const TASK_LABEL: Record<TaskMode, string> = {
  t2i: '文生图',
  i2i: '图生图'
}

export const TASK_SHORT: Record<TaskMode, string> = {
  t2i: '文生',
  i2i: '图生'
}

export const CAPABILITY_LABEL: Record<keyof ModelCapabilities, string> = {
  t2i: '文生',
  i2i: '图生',
  edit: '编辑',
  imagePrompt: '垫图',
  styleRef: '风格码'
}

const IMAGE_CAPS: ModelCapabilities = {
  t2i: true,
  i2i: true,
  edit: true,
  imagePrompt: false,
  styleRef: false
}

const VIDEO_CAPS: ModelCapabilities = {
  t2i: true,
  i2i: true,
  edit: false,
  imagePrompt: false,
  styleRef: false
}

const OTHER_CAPS: ModelCapabilities = {
  t2i: true,
  i2i: false,
  edit: false,
  imagePrompt: false,
  styleRef: false
}

const MJ_CAPS: ModelCapabilities = {
  t2i: true,
  i2i: true,
  edit: true,
  imagePrompt: true,
  styleRef: true
}

/** 内置 / 自定义模型的默认能力；未知模型按 kind 兜底 */
export function defaultCapabilities(
  name: string,
  kind: ModelKind = 'other'
): ModelCapabilities {
  const n = String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (n === 'midjourney' || n === 'mj' || n.startsWith('midjourney ')) {
    return { ...MJ_CAPS }
  }
  if (kind === 'video') return { ...VIDEO_CAPS }
  if (kind === 'image') return { ...IMAGE_CAPS }
  return { ...OTHER_CAPS }
}

/** 合并词表里的自定义能力与默认能力 */
export function capabilitiesOf(
  preset: { name?: string; kind?: ModelKind; capabilities?: ModelCapabilities } | undefined,
  fallbackName = '',
  fallbackKind: ModelKind = 'other'
): ModelCapabilities {
  const base = defaultCapabilities(preset?.name ?? fallbackName, preset?.kind ?? fallbackKind)
  return { ...base, ...(preset?.capabilities ?? {}) }
}

/** 能力是否全部关闭（用于界面判断） */
export function hasAnyCapability(caps: ModelCapabilities): boolean {
  return Object.values(caps).some(Boolean)
}

const NEGATED_REFERENCE =
  /无参考图|没有参考图|无需参考图|不需要参考图|不带参考图|纯文生图|纯文生|no reference image|without (a )?reference|text[- ]to[- ]image only/i

const I2I_MARKERS =
  /参考图|垫图|图生图|上传的?图|基于(这张|图片|原图)|编辑(这张|图片|原图)|改图|换装|替换(人物|背景|主体)|局部重绘|扩图|保持(人物|角色|主体|形象)|image prompt|reference image|uploaded image|based on the (image|photo)|edit (the|this|provided) (image|photo)|keep the (character|subject|person)|inpaint|outpaint|image[- ]to[- ]image|img2img|face swap/i

/**
 * 老库迁移 / 新录入时的默认生成方式推断。
 * 只做「明显是图生图」的判断，其余默认文生图；用户可随时改。
 */
export function inferTask(input: {
  positive?: string
  negative?: string
  note?: string
  params?: PromptParams
}): TaskMode {
  const extra = input.params?.extra ?? {}
  if (
    (extra['reference'] ?? '').trim() ||
    (extra['cref'] ?? '').trim() ||
    (extra['imagePrompt'] ?? '').trim() ||
    (extra['image_prompt'] ?? '').trim() ||
    (extra['inputImage'] ?? '').trim()
  ) {
    return 'i2i'
  }
  const text = `${input.positive ?? ''}\n${input.note ?? ''}\n${input.negative ?? ''}`
  if (NEGATED_REFERENCE.test(text)) return 't2i'
  if (I2I_MARKERS.test(text)) return 'i2i'
  return 't2i'
}

/** 卡片 / 详情里按媒体类型显示：文生图 / 图生图 / 文生视频 / 图生视频 */
export function taskLabel(task: TaskMode, kind?: 'image' | 'video' | string): string {
  if (kind === 'video') return task === 'i2i' ? '图生视频' : '文生视频'
  return TASK_LABEL[task]
}
