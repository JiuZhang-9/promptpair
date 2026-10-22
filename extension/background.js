/* PromptPair 采集插件 · 后台服务
 *
 * 设计要点（为什么这么做）：
 * 1. 不用 declarative content_scripts，改为 activeTab + 按需注入。
 *    → 用户没点插件时，本扩展读不到任何网页内容，安装时也不会弹"读取所有网站数据"的吓人提示。
 * 2. 与桌面端通信走 127.0.0.1 的本地端口探测（47821–47840）。
 *    插件不能直接调 Electron IPC，这是唯一既跨进程又无需额外权限的方式。
 * 3. 图片不在这里下载。只把 URL 交给桌面端，由主进程带 Referer 去取，
 *    这样图床防盗链也能过，且不占扩展的跨域配额。
 */

const PORT_START = 47821
const PORT_END = 47840

let cachedPort = 0

async function ping(port) {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 700)
    const res = await fetch(`http://127.0.0.1:${port}/ping`, { signal: ctl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const j = await res.json()
    return j && j.app === 'PromptPair' ? j : null
  } catch {
    return null
  }
}

async function findPort() {
  if (cachedPort) {
    const ok = await ping(cachedPort)
    if (ok) return cachedPort
    cachedPort = 0
  }
  for (let p = PORT_START; p <= PORT_END; p++) {
    const ok = await ping(p)
    if (ok) {
      cachedPort = p
      return p
    }
  }
  return 0
}

async function sendCapture(payload) {
  const port = await findPort()
  if (!port) {
    return {
      ok: false,
      message: '没找到正在运行的 PromptPair。请先打开桌面端程序再试。'
    }
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const j = await res.json()
    return j
  } catch (e) {
    return { ok: false, message: '发送失败：' + e.message }
  }
}

function guessPlatform(url, title) {
  const t = `${url} ${title}`.toLowerCase()
  const table = [
    [/jimeng|dreamina/, '即梦'],
    [/kling/, '可灵'],
    [/midjourney|mj\.com/, 'Midjourney'],
    [/liblib/, 'LiblibAI'],
    [/doubao/, '豆包'],
    [/tongyi|wanx/, '通义万相'],
    [/runway/, 'Runway'],
    [/pika/, 'Pika'],
    [/sora/, 'Sora'],
    [/hailuo|minimax/, '海螺'],
    [/vidu/, 'Vidu'],
    [/comfy/, 'ComfyUI']
  ]
  for (const [re, name] of table) if (re.test(t)) return name
  return '网页采集'
}

/* ── 右键菜单 ── */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'pp-capture',
      title: '用 PromptPair 采集选中内容',
      contexts: ['selection', 'image', 'video', 'page']
    })
    chrome.contextMenus.create({
      id: 'pp-shot',
      title: '用 PromptPair 截图采集（拖框）',
      contexts: ['selection', 'image', 'video', 'page']
    })
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return
  if (info.menuItemId === 'pp-shot') {
    await startShot(tab, info.selectionText || '')
    return
  }
  if (info.menuItemId !== 'pp-capture') return
  await startPick(tab, info.selectionText || '')
})

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'start-pick' && cmd !== 'start-shot') return
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  if (cmd === 'start-shot') await startShot(tab, '')
  else await startPick(tab, '')
})

/* ── 注入框选器 ── */

async function startPick(tab, selectionText) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    })
  } catch (e) {
    // 已经在页面里注入过也没关系
  }
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'PP_START_PICK',
      selection: selectionText,
      pageUrl: tab.url || '',
      pageTitle: tab.title || '',
      platform: guessPlatform(tab.url || '', tab.title || '')
    })
  } catch (e) {
    console.warn('[PromptPair] 无法与页面通信', e)
  }
}

async function startShot(tab, selectionText) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    })
  } catch (e) {
    // 已注入
  }
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'PP_START_SHOT',
      selection: selectionText,
      pageUrl: tab.url || '',
      pageTitle: tab.title || '',
      platform: guessPlatform(tab.url || '', tab.title || '')
    })
  } catch (e) {
    console.warn('[PromptPair] 无法启动截图', e)
  }
}

/* ── 消息总线 ── */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'PP_CAPTURE') {
    sendCapture(msg.payload).then(sendResponse)
    return true // 异步响应
  }
  if (msg?.type === 'PP_STATUS') {
    findPort().then((port) => sendResponse({ port }))
    return true
  }
  if (msg?.type === 'PP_SHOT_REGION') {
    const windowId = sender.tab?.windowId
    if (windowId == null) {
      sendResponse({ ok: false, message: '找不到当前标签页' })
      return false
    }
    chrome.tabs
      .captureVisibleTab(windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((e) => sendResponse({ ok: false, message: '截图失败：' + (e?.message || e) }))
    return true
  }
  if (msg?.type === 'PP_START_SHOT') {
    ;(async () => {
      try {
        const tab = msg.tabId
          ? await chrome.tabs.get(msg.tabId)
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
        if (tab?.id) await startShot(tab, msg.selection || '')
        sendResponse({ ok: !!tab?.id })
      } catch (e) {
        sendResponse({ ok: false, message: String(e?.message || e) })
      }
    })()
    return true
  }
  return false
})
