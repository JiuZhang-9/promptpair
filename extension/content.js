/* PromptPair 框选采集器（注入到页面里运行）
 *
 * 交互：进入框选模式 → 鼠标悬停高亮目标图/视频 → 单击确认 → 发送给桌面端
 * 退出：Esc 或右键
 * 说明：所有样式都用内联 style 设置，避免被页面 CSP 拦截；不影响页面原有事件。
 */

;(function () {
  if (window.__ppPickerInstalled) {
    // 已注入过，只需由监听器接收新指令
    return
  }
  window.__ppPickerInstalled = true

  let state = null // { selection, pageUrl, pageTitle, platform, overlay, box, bar }
  let shotState = null

  const HOST_ID = '__pp_picker_host__'

  function ensureHost() {
    let host = document.getElementById(HOST_ID)
    if (!host) {
      host = document.createElement('div')
      host.id = HOST_ID
      host.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483647',
        'pointer-events:none',
        'display:block'
      ].join(';')
      document.documentElement.appendChild(host)
    }
    return host
  }

  function removeUi() {
    const host = document.getElementById(HOST_ID)
    if (host) host.remove()
  }

  function isMediaEl(el) {
    if (!el) return false
    const tag = el.tagName
    if (tag === 'IMG' || tag === 'VIDEO') return true
    if (tag === 'CANVAS') return true
    // 背景图
    try {
      const bg = getComputedStyle(el).backgroundImage
      if (bg && bg !== 'none' && bg.includes('url(')) {
        const r = el.getBoundingClientRect()
        return r.width > 120 && r.height > 120
      }
    } catch (e) {
      /* ignore */
    }
    return false
  }

  /** 从被点击元素向上找，或向下找面积最大的媒体元素 */
  function resolveTarget(el) {
    if (!el) return null
    if (isMediaEl(el)) return el

    // 向下找最大的 img/video
    let best = null
    let bestArea = 0
    const kids = el.querySelectorAll ? el.querySelectorAll('img,video,canvas') : []
    for (const k of kids) {
      const r = k.getBoundingClientRect()
      const area = r.width * r.height
      if (area > bestArea) {
        bestArea = area
        best = k
      }
    }
    if (best && bestArea > 4000) return best

    // 向上找 3 层
    let p = el.parentElement
    for (let i = 0; i < 3 && p; i++) {
      const cand = p.querySelector('img,video,canvas')
      if (cand) return cand
      p = p.parentElement
    }
    return null
  }

  function urlOf(el) {
    if (!el) return null
    const tag = el.tagName
    if (tag === 'IMG') return el.currentSrc || el.src || null
    if (tag === 'VIDEO') return el.currentSrc || el.src || null
    if (tag === 'CANVAS') {
      try {
        return el.toDataURL('image/png')
      } catch (e) {
        return null
      }
    }
    try {
      const bg = getComputedStyle(el).backgroundImage
      const m = /url\(["']?(.*?)["']?\)/.exec(bg)
      if (m) return m[1]
    } catch (e) {
      /* ignore */
    }
    return null
  }

  /**
   * 尽量在页面里把图片读成 data URL。
   * 典型场景：img.src 是 blob:（生成平台常见），桌面端主进程无法访问；
   * 或者图片需要页面登录态才能下载。普通跨域图 CORS 不允许时会失败，
   * 返回 null，继续走原来的 imageUrl 让桌面端带 Referer 去拉。
   */
  async function toDataUrl(url) {
    if (!url) return null
    if (url.startsWith('data:')) return url
    try {
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) return null
      const blob = await res.blob()
      if (!/^(image|video)\//.test(blob.type || '')) return null
      // 本地接收端请求体上限 64MB，留出 base64 膨胀空间
      if (blob.size > 24 * 1024 * 1024) return null
      return await new Promise((resolve) => {
        const fr = new FileReader()
        fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null)
        fr.onerror = () => resolve(null)
        fr.readAsDataURL(blob)
      })
    } catch (e) {
      return null
    }
  }

  /** 尽力猜测页面上的提示词（用户没选文字时的兜底） */
  function guessPrompt() {
    const sels = [
      'textarea[placeholder*="提示词"]',
      'textarea[placeholder*="prompt" i]',
      'textarea[placeholder*="描述"]',
      '[class*="prompt"] textarea',
      '[class*="prompt"] [contenteditable="true"]',
      '[data-testid*="prompt"]'
    ]
    for (const s of sels) {
      const el = document.querySelector(s)
      if (el) {
        const v = el.value || el.innerText || el.textContent || ''
        if (v.trim().length > 4) return v.trim()
      }
    }
    return ''
  }

  function showBox(rect) {
    if (!state) return
    state.box.style.cssText = [
      'position:fixed',
      `left:${rect.left}px`,
      `top:${rect.top}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
      'border:2px solid #6c8cff',
      'background:rgba(108,140,255,0.12)',
      'border-radius:6px',
      'box-shadow:0 0 0 9999px rgba(8,10,16,0.45)',
      'pointer-events:none',
      'transition:all 60ms linear'
    ].join(';')
  }

  function toast(msg, kind) {
    const host = ensureHost()
    const t = document.createElement('div')
    const bg = kind === 'err' ? '#ff6b81' : '#35d39b'
    const fg = kind === 'err' ? '#2a0710' : '#04211a'
    t.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:32px',
      'transform:translateX(-50%)',
      `background:${bg}`,
      `color:${fg}`,
      'font:600 13px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      'padding:10px 18px',
      'border-radius:999px',
      'box-shadow:0 10px 30px rgba(0,0,0,0.35)',
      'pointer-events:none',
      'z-index:2147483647',
      'max-width:70vw',
      'text-align:center'
    ].join(';')
    t.textContent = msg
    host.appendChild(t)
    setTimeout(() => t.remove(), kind === 'err' ? 4200 : 2400)
  }

  /* ────────── 截图采集（拖框） ────────── */

  function stopShot() {
    const s = shotState
    shotState = null
    if (!s) return
    try {
      s.host.remove()
    } catch (e) {
      /* ignore */
    }
    window.removeEventListener('mousemove', s.onMove, true)
    window.removeEventListener('mouseup', s.onUp, true)
    window.removeEventListener('keydown', s.onKey, true)
  }

  function startShot(opts) {
    if (state) stop()
    stopShot()

    const host = document.createElement('div')
    host.id = '__pp_shot_host__'
    host.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;user-select:none;'

    const box = document.createElement('div')
    box.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'width:0',
      'height:0',
      'border:2px solid #6c8cff',
      'background:rgba(108,140,255,0.12)',
      'box-shadow:0 0 0 9999px rgba(8,10,16,0.45)',
      'border-radius:4px',
      'display:none',
      'pointer-events:none'
    ].join(';')

    const bar = document.createElement('div')
    bar.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:18px',
      'transform:translateX(-50%)',
      'background:rgba(18,22,30,0.96)',
      'color:#e7ecf5',
      'font:500 13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      'padding:10px 16px',
      'border-radius:12px',
      'border:1px solid rgba(108,140,255,0.5)',
      'box-shadow:0 12px 40px rgba(0,0,0,0.5)',
      'pointer-events:none',
      'white-space:nowrap'
    ].join(';')
    const sel = (opts.selection || '').trim()
    bar.textContent = sel
      ? `拖动框选要截图的区域（已捕获 ${sel.length} 字提示词）· Esc 取消`
      : '拖动框选要截图的区域 · Esc 取消'

    host.append(box, bar)
    document.documentElement.appendChild(host)

    const s = { host, box, opts, start: null, rect: null }
    const draw = (x, y) => {
      if (!s.start) return
      const left = Math.min(s.start.x, x)
      const top = Math.min(s.start.y, y)
      const width = Math.abs(x - s.start.x)
      const height = Math.abs(y - s.start.y)
      s.rect = { left, top, width, height }
      box.style.display = 'block'
      box.style.left = left + 'px'
      box.style.top = top + 'px'
      box.style.width = width + 'px'
      box.style.height = height + 'px'
    }

    s.onMove = (e) => draw(e.clientX, e.clientY)
    s.onUp = (e) => {
      if (!s.start) return
      draw(e.clientX, e.clientY)
      const rect = s.rect
      s.start = null
      if (!rect || rect.width < 8 || rect.height < 8) {
        s.rect = null
        box.style.display = 'none'
        return
      }
      void finishShot(rect)
    }
    s.onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        stopShot()
        toast('已取消截图', 'err')
      }
    }

    host.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      s.start = { x: e.clientX, y: e.clientY }
      s.rect = null
      draw(e.clientX, e.clientY)
    })
    window.addEventListener('mousemove', s.onMove, true)
    window.addEventListener('mouseup', s.onUp, true)
    window.addEventListener('keydown', s.onKey, true)
    shotState = s
  }

  /** 把标签页截图按拖框区域裁剪出来 */
  function cropShot(src, rect) {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        try {
          const scaleX = img.width / window.innerWidth
          const scaleY = img.height / window.innerHeight
          const sx = Math.max(0, Math.round(rect.left * scaleX))
          const sy = Math.max(0, Math.round(rect.top * scaleY))
          const sw = Math.max(1, Math.min(img.width - sx, Math.round(rect.width * scaleX)))
          const sh = Math.max(1, Math.min(img.height - sy, Math.round(rect.height * scaleY)))
          const canvas = document.createElement('canvas')
          canvas.width = sw
          canvas.height = sh
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            resolve(null)
            return
          }
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
          resolve(canvas.toDataURL('image/png'))
        } catch (e) {
          resolve(null)
        }
      }
      img.onerror = () => resolve(null)
      img.src = src
    })
  }

  async function finishShot(rect) {
    const s = shotState
    if (!s) return
    const opts = s.opts
    stopShot()
    // 等遮罩层从画面里消失，再让后台截标签页
    await new Promise((r) => setTimeout(r, 150))

    try {
      const shot = await chrome.runtime.sendMessage({ type: 'PP_SHOT_REGION' })
      if (!shot || !shot.ok || !shot.dataUrl) {
        toast((shot && shot.message) || '截图失败，请重试', 'err')
        return
      }
      const dataUrl = await cropShot(shot.dataUrl, rect)
      if (!dataUrl) {
        toast('截图裁剪失败，请重试', 'err')
        return
      }
      const payload = {
        dataUrl,
        pageUrl: opts.pageUrl || location.href,
        pageTitle: opts.pageTitle || document.title,
        promptText: (opts.selection || '').trim() || guessPrompt(),
        negativeText: '',
        platform: opts.platform || '网页采集'
      }
      const res = await chrome.runtime.sendMessage({ type: 'PP_CAPTURE', payload })
      if (res && res.ok) toast('截图已收进 PromptPair 素材库 ✓', 'ok')
      else toast((res && res.message) || '发送失败', 'err')
    } catch (e) {
      toast('截图失败：' + e.message, 'err')
    }
  }

  function start(opts) {
    if (state) stop()
    stopShot()
    const host = ensureHost()

    const box = document.createElement('div')
    host.appendChild(box)

    const bar = document.createElement('div')
    bar.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:18px',
      'transform:translateX(-50%)',
      'background:rgba(18,22,30,0.96)',
      'color:#e7ecf5',
      'font:500 13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      'padding:10px 16px',
      'border-radius:12px',
      'border:1px solid rgba(108,140,255,0.5)',
      'box-shadow:0 12px 40px rgba(0,0,0,0.5)',
      'display:flex',
      'align-items:center',
      'gap:10px',
      'pointer-events:none',
      'z-index:2147483647',
      'white-space:nowrap'
    ].join(';')

    const dot = document.createElement('span')
    dot.style.cssText =
      'width:8px;height:8px;border-radius:3px;background:linear-gradient(135deg,#6c8cff,#9d7cff);display:inline-block'
    const txt = document.createElement('span')
    const sel = (opts.selection || '').trim()
    txt.textContent = sel
      ? `点击要采集的图片（已捕获 ${sel.length} 字提示词）· Esc 取消`
      : '点击要采集的图片/视频 · Esc 取消'
    const kbd = document.createElement('span')
    kbd.textContent = 'Esc'
    kbd.style.cssText =
      'font:600 10px/1 ui-monospace,monospace;padding:3px 6px;border-radius:5px;background:rgba(255,255,255,0.12);color:#9aa4b5'

    bar.appendChild(dot)
    bar.appendChild(txt)
    bar.appendChild(kbd)
    host.appendChild(bar)

    state = { ...opts, box, bar, host }
    document.documentElement.style.cursor = 'crosshair'

    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('click', onClick, true)
    window.addEventListener('contextmenu', onContext, true)
    window.addEventListener('keydown', onKey, true)
  }

  function stop() {
    if (!state) return
    window.removeEventListener('mousemove', onMove, true)
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('contextmenu', onContext, true)
    window.removeEventListener('keydown', onKey, true)
    document.documentElement.style.cursor = ''
    removeUi()
    state = null
  }

  function onMove(e) {
    if (!state) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    // 忽略我们自己的浮层
    if (el && el.closest && el.closest('#' + HOST_ID)) return
    const target = resolveTarget(el)
    if (target) {
      showBox(target.getBoundingClientRect())
    } else if (state) {
      state.box.style.cssText = 'position:fixed;display:none'
    }
  }

  function onContext(e) {
    e.preventDefault()
    e.stopPropagation()
    stop()
    toast('已取消采集', 'err')
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      stop()
    }
  }

  async function onClick(e) {
    if (!state) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()

    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (el && el.closest && el.closest('#' + HOST_ID)) return

    const target = resolveTarget(el)
    const url = urlOf(target)
    const ctx = state

    if (!url) {
      toast('这个位置没找到图片，换个位置点一下', 'err')
      return
    }

    stop()

    // 先尝试在页面里读成 data URL：blob / 需要 cookie 的图片都能过
    const inline = await toDataUrl(url)
    const dataUrl = inline || (url.startsWith('data:') ? url : undefined)
    const payload = {
      imageUrl: dataUrl ? undefined : url,
      dataUrl,
      pageUrl: ctx.pageUrl || location.href,
      pageTitle: ctx.pageTitle || document.title,
      promptText: (ctx.selection || '').trim() || guessPrompt(),
      negativeText: '',
      platform: ctx.platform || '网页采集'
    }

    try {
      const res = await chrome.runtime.sendMessage({ type: 'PP_CAPTURE', payload })
      if (res && res.ok) {
        toast('已收进 PromptPair 素材库 ✓', 'ok')
      } else {
        toast((res && res.message) || '发送失败', 'err')
      }
    } catch (err) {
      toast('无法连接 PromptPair：' + err.message, 'err')
    }
  }

  /* 接收后台指令 */
  if (!window.__ppListenerInstalled) {
    window.__ppListenerInstalled = true
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'PP_START_PICK') {
        start(msg)
        sendResponse({ ok: true })
      }
      if (msg && msg.type === 'PP_START_SHOT') {
        startShot(msg)
        sendResponse({ ok: true })
      }
      return false
    })
  }
})()
