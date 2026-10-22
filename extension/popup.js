const dot = document.getElementById('dot')
const statusText = document.getElementById('statusText')
const pickBtn = document.getElementById('pick')
const shotBtn = document.getElementById('shot')
const retryBtn = document.getElementById('retry')

let connected = false

async function check() {
  statusText.textContent = '正在检测桌面端…'
  dot.className = 'dot'
  pickBtn.disabled = true
  shotBtn.disabled = true
  const res = await chrome.runtime.sendMessage({ type: 'PP_STATUS' })
  if (res && res.port) {
    connected = true
    dot.className = 'dot on'
    statusText.textContent = `已连接 · 端口 ${res.port}`
    pickBtn.disabled = false
    shotBtn.disabled = false
  } else {
    connected = false
    dot.className = 'dot off'
    statusText.textContent = '未找到 PromptPair，请先打开桌面端'
    pickBtn.disabled = true
    shotBtn.disabled = true
  }
}

async function startPick() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.id) return
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
  } catch (e) {
    /* 已注入 */
  }
  // 取当前选中的文字作为提示词
  let selection = ''
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => String(window.getSelection ? window.getSelection().toString() : '')
    })
    selection = (r && r[0] && r[0].result) || ''
  } catch (e) {
    /* ignore */
  }
  await chrome.tabs.sendMessage(tab.id, {
    type: 'PP_START_PICK',
    selection,
    pageUrl: tab.url || '',
    pageTitle: tab.title || ''
  })
  window.close()
}

async function startShot() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.id) return
  let selection = ''
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => String(window.getSelection ? window.getSelection().toString() : '')
    })
    selection = (r && r[0] && r[0].result) || ''
  } catch (e) {
    /* ignore */
  }
  await chrome.runtime.sendMessage({ type: 'PP_START_SHOT', tabId: tab.id, selection })
  window.close()
}

pickBtn.addEventListener('click', startPick)
shotBtn.addEventListener('click', startShot)
retryBtn.addEventListener('click', check)
check()
