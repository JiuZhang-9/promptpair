/**
 * 生成 .promptpack 里自带的静态预览页（单文件、零依赖、双击即开）。
 * 这是「分享」体验的关键：收包的人不需要装 PromptPair 就能看图、看提示词、复制提示词。
 */

export interface PreviewAsset {
  rel: string
  thumb?: string
  /** 库内 asset id，单页 HTML 导出时用来回读文件；预览页不展示 */
  assetId?: string
  /** 文件展示名（单页 HTML 里 rel 是 data URL，不能再从路径取文件名） */
  name?: string
  kind: 'image' | 'video'
  w?: number
  h?: number
  /** false = 只有封面，不播放原视频（单页 HTML 用） */
  playable?: boolean
}

export interface PreviewItem {
  title: string
  positive: string
  negative: string
  note: string
  rating: number
  tags: string[]
  collections: string[]
  model?: string
  seed?: string
  size?: string
  steps?: number
  cfg?: number
  sampler?: string
  platform?: string
  url?: string
  createdAt: string
  assets: PreviewAsset[]
}

export interface PreviewPack {
  name: string
  exportedAt: string
  appVersion: string
  items: PreviewItem[]
  tags: { name: string; color: string }[]
  collections: { name: string; color: string }[]
}

const CSS = `
:root{
  --bg:#0a0a0b; --surface:#0f0f11; --surface-2:#141416; --surface-3:#1b1b1e;
  --line:#1f1f23; --line-2:#2b2b30; --fg:#f4f4f5; --fg-2:#a2a3a8; --fg-3:#6c6d73; --fg-4:#494a4f;
  --invert:#f4f4f5; --invert-fg:#0a0a0b; --ok:#3dd68c; --warn:#e5a94d;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);
  font-family:'Segoe UI Variable Text',-apple-system,'Segoe UI','Microsoft YaHei',system-ui,sans-serif;
  font-size:13px;line-height:1.45;-webkit-font-smoothing:antialiased}
a{color:var(--fg);text-decoration:none}
.top{position:sticky;top:0;z-index:20;background:rgba(10,10,11,.9);
  backdrop-filter:blur(16px);border-bottom:1px solid var(--line);padding:15px 26px 12px}
.brand{display:flex;align-items:center;gap:9px;font-weight:600;font-size:13px;letter-spacing:-.01em}
.dot{width:9px;height:9px;border-radius:3px;background:var(--fg)}
.meta{color:var(--fg-4);font-size:11px;margin-left:auto;font-weight:400;font-variant-numeric:tabular-nums}
.ctl{display:flex;gap:10px;margin-top:13px;flex-wrap:wrap;align-items:center}
input[type=search]{background:var(--surface-2);border:1px solid var(--line);color:var(--fg);
  padding:8px 12px;border-radius:6px;font-size:12.5px;min-width:280px;outline:none;transition:.13s}
input[type=search]::placeholder{color:var(--fg-4)}
input[type=search]:focus{border-color:var(--fg-4);background:var(--surface-3)}
.chip{background:transparent;border:1px solid var(--line-2);color:var(--fg-2);
  padding:5px 10px;border-radius:4px;font-size:11px;cursor:pointer;user-select:none;
  transition:.13s;white-space:nowrap}
.chip:hover{border-color:var(--line-2);color:var(--fg);background:rgba(255,255,255,.05)}
.chip.on{background:var(--invert);border-color:var(--invert);color:var(--invert-fg);font-weight:500}
.grid{display:grid;gap:14px;padding:22px 26px 64px;
  grid-template-columns:repeat(auto-fill,minmax(228px,1fr))}
.card{background:var(--surface-2);border:1px solid var(--line);border-radius:10px;
  overflow:hidden;cursor:pointer;transition:.14s;display:flex;flex-direction:column}
.card:hover{border-color:#3a3a40;transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,0,0,.42)}
.card-copy{display:inline-flex;align-items:center;align-self:flex-start;margin-top:2px;
  background:transparent;border:1px solid var(--line-2);color:var(--fg-3);padding:3px 8px;
  border-radius:4px;font-size:10px;cursor:pointer;transition:.12s;font-family:inherit}
.card-copy:hover{background:rgba(255,255,255,.07);color:var(--fg);border-color:#3a3a40}
.hint{font-size:10.5px;color:var(--fg-4);margin-top:8px}
.video-note{font-size:11px;color:var(--fg-4);margin-top:10px;text-align:center;line-height:1.6}
.thumb{position:relative;background:var(--surface-3);aspect-ratio:1/1;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.thumb .badge{position:absolute;left:8px;top:8px;background:rgba(10,10,11,.72);
  border:1px solid rgba(255,255,255,.1);color:#fff;font-size:10px;padding:2px 7px;
  border-radius:4px;backdrop-filter:blur(10px)}
.thumb .cnt{position:absolute;right:8px;top:8px;background:rgba(10,10,11,.82);
  border:1px solid rgba(255,255,255,.1);color:#fff;font-size:10px;padding:2px 7px;
  border-radius:4px;font-weight:600;font-variant-numeric:tabular-nums}
.body{padding:9px 11px 11px;display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--line)}
.t{font-size:12px;font-weight:600;letter-spacing:-.008em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p{font-size:10.5px;color:var(--fg-3);line-height:1.5;display:-webkit-box;
  -webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;min-height:31px}
.tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:2px}
.tag{font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(255,255,255,.05);
  border:1px solid var(--line);color:var(--fg-3)}
.empty{padding:90px 24px;text-align:center;color:var(--fg-4);font-size:12.5px}
.modal{position:fixed;inset:0;background:rgba(6,6,7,.72);backdrop-filter:blur(6px);
  display:none;z-index:50;padding:4vh 4vw}
.modal.on{display:flex;align-items:center;justify-content:center}
.panel{background:var(--surface);border:1px solid var(--line-2);border-radius:14px;
  width:min(1100px,96vw);max-height:92vh;overflow:hidden;display:flex;flex-direction:column;
  box-shadow:0 24px 64px rgba(0,0,0,.62)}
.phead{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line)}
.phead .x{margin-left:auto;cursor:pointer;color:var(--fg-3);font-size:20px;line-height:1;
  padding:2px 9px;border-radius:6px;transition:.12s}
.phead .x:hover{background:rgba(255,255,255,.07);color:var(--fg)}
.pbody{display:grid;grid-template-columns:1.35fr 1fr;overflow:hidden;min-height:0}
@media(max-width:860px){.pbody{grid-template-columns:1fr;overflow:auto}}
.stage{background:#060607;display:flex;align-items:center;justify-content:center;
  padding:16px;min-height:280px;overflow:auto;position:relative}
.stage img,.stage video{max-width:100%;max-height:74vh;border-radius:8px;display:block}
.nav{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:8px;
  background:rgba(10,10,11,.78);border:1px solid rgba(255,255,255,.1);padding:5px 10px;
  border-radius:999px;backdrop-filter:blur(12px)}
.nav span{cursor:pointer;color:#fff;font-size:11px;padding:2px 6px;opacity:.75;font-variant-numeric:tabular-nums}
.nav span:hover{opacity:1}
.info{padding:18px 20px 30px;overflow-y:auto;border-left:1px solid var(--line)}
.sect{margin-bottom:19px}
.sect h4{margin:0 0 7px;font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;
  color:var(--fg-4);font-weight:600}
.pbox{background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:11px 12px;
  font-size:11.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word;
  font-family:ui-monospace,'Cascadia Code',Consolas,monospace;color:var(--fg-2)}
.btn{display:inline-flex;align-items:center;gap:6px;background:transparent;
  border:1px solid var(--line-2);color:var(--fg-2);padding:5px 11px;border-radius:6px;
  font-size:11px;cursor:pointer;margin-top:9px;transition:.12s;font-family:inherit}
.btn:hover{background:rgba(255,255,255,.07);color:var(--fg);border-color:#3a3a40}
.kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:11.5px}
.kv .k{color:var(--fg-4)}
.kv .v{color:var(--fg-2);word-break:break-all;font-variant-numeric:tabular-nums}
.stars{color:var(--fg);letter-spacing:2px;font-size:11px}
.foot{padding:20px 26px;color:var(--fg-4);font-size:10.5px;border-top:1px solid var(--line);text-align:center}
.toast{position:fixed;bottom:26px;left:50%;transform:translate(-50%,20px);opacity:0;
  background:var(--invert);color:var(--invert-fg);padding:8px 16px;border-radius:999px;
  font-size:12px;font-weight:600;transition:.24s;pointer-events:none;z-index:99}
.toast.on{opacity:1;transform:translate(-50%,0)}
`

const JS = `
const DATA = JSON.parse(document.getElementById('pp-data').textContent);
const $ = (s,r=document)=>r.querySelector(s);
const el = (t,c)=>{const e=document.createElement(t); if(c) e.className=c; return e;};
let state = { q:'', tags:new Set() };

function allTags(){ return DATA.tags; }

function renderChips(){
  const box = $('#chips'); box.innerHTML='';
  const sorted = [...allTags()].sort((a,b)=>b.n-a.n);
  for(const t of sorted){
    const c = el('div','chip'+(state.tags.has(t.name)?' on':''));
    c.textContent = t.name + ' ' + t.n;
    c.onclick = ()=>{ state.tags.has(t.name)?state.tags.delete(t.name):state.tags.add(t.name); renderChips(); render(); };
    box.appendChild(c);
  }
}

function filtered(){
  const q = state.q.trim().toLowerCase();
  return DATA.items.filter(it=>{
    if(state.tags.size){
      const names = it.tags.map(t=>t.toLowerCase());
      for(const t of state.tags) if(!names.includes(t.toLowerCase())) return false;
    }
    if(!q) return true;
    const hay = [it.title,it.positive,it.negative,it.note,it.model,it.platform,(it.tags||[]).join(' ')].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function stars(n){ return '★★★★★'.slice(0,Math.max(0,Math.min(5,n||0))) + '☆☆☆☆☆'.slice(0,5-Math.max(0,Math.min(5,n||0))); }

function render(){
  const g = $('#grid'); g.innerHTML='';
  const list = filtered();
  $('#count').textContent = list.length + ' / ' + DATA.items.length + ' 条';
  if(!list.length){ const e = el('div','empty'); e.style.gridColumn='1/-1'; e.textContent='没有匹配的条目'; g.appendChild(e); return; }
  for(const it of list){
    const card = el('div','card');
    const th = el('div','thumb');
    const a0 = it.assets[0];
    const img = el('img'); img.loading='lazy'; img.alt=it.title;
    img.src = a0 ? (a0.thumb || a0.rel) : '';
    if(!a0) img.style.display='none';
    th.appendChild(img);
    if(a0 && a0.kind==='video'){ const b=el('div','badge'); b.textContent='视频'; th.appendChild(b); }
    if(it.assets.length>1){ const b=el('div','cnt'); b.textContent='×'+it.assets.length; th.appendChild(b); }
    card.appendChild(th);
    const body = el('div','body');
    const t = el('div','t'); t.textContent = it.title; body.appendChild(t);
    const p = el('div','p'); p.textContent = it.positive || '（无提示词）'; body.appendChild(p);
    if(it.tags.length){
      const tw = el('div','tags');
      for(const n of it.tags.slice(0,4)){
        const tg = el('div','tag'); tg.textContent=n;
        tw.appendChild(tg);
      }
      body.appendChild(tw);
    }
    if(it.positive){
      const cp = el('button','card-copy');
      cp.textContent = '复制提示词';
      cp.onclick = (e)=>{ e.stopPropagation(); copy(it.positive, '提示词'); };
      body.appendChild(cp);
    }
    card.appendChild(body);
    card.onclick = ()=>open(it);
    g.appendChild(card);
  }
}

let cur = null, curIdx = 0;
function open(it){ cur = it; curIdx = 0; paint(); $('#modal').classList.add('on'); }
function close(){ $('#modal').classList.remove('on'); cur=null; }

function copy(text, label){
  if(!text) return;
  const done = ()=>toast(label ? '已复制：' + label : '已复制');
  const fail = ()=>{
    try{
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? done() : toast('复制失败，请手动选中');
    }catch(e){ toast('复制失败，请手动选中'); }
  };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done).catch(fail);
  } else {
    fail();
  }
}

function allText(it){
  const parts = [];
  if(it.positive) parts.push(it.positive);
  if(it.negative) parts.push('Negative: ' + it.negative);
  if(it.note) parts.push('备注：' + it.note);
  const ps = [];
  if(it.model) ps.push('模型: ' + it.model);
  if(it.size) ps.push('尺寸: ' + it.size);
  if(it.seed) ps.push('Seed: ' + it.seed);
  if(it.steps) ps.push('步数: ' + it.steps);
  if(it.cfg) ps.push('CFG: ' + it.cfg);
  if(it.sampler) ps.push('采样器: ' + it.sampler);
  if(ps.length) parts.push(ps.join('\\n'));
  return parts.join('\\n\\n');
}

function paint(){
  const it = cur; if(!it) return;
  $('#mTitle').textContent = it.title;
  $('#mSub').textContent = [it.platform, it.createdAt&&it.createdAt.slice(0,10)].filter(Boolean).join(' · ');
  const stage = $('#stage'); stage.innerHTML='';
  const a = it.assets[curIdx];
  if(a){
    const canPlay = a.kind === 'video' && a.playable !== false && a.rel;
    if(canPlay){
      const v = document.createElement('video');
      v.src = a.rel; v.controls = true; v.autoplay = true; v.loop = true;
      if(a.thumb) v.poster = a.thumb;
      stage.appendChild(v);
    } else {
      const im = document.createElement('img');
      im.src = a.thumb || a.rel;
      if(!im.getAttribute('src')) im.style.display='none';
      stage.appendChild(im);
      if(a.kind === 'video'){
        const note = el('div','video-note');
        note.textContent = a.playable === false
          ? '单页分享不含原视频；完整视频请用 .promptpack 查看'
          : '这个视频没有可用的封面';
        stage.appendChild(note);
      }
    }
    if(it.assets.length>1){
      const nav = el('div','nav');
      const prev = el('span'); prev.textContent='‹';
      const ind = el('span'); ind.textContent = (curIdx+1)+' / '+it.assets.length;
      const next = el('span'); next.textContent='›';
      prev.onclick=(e)=>{e.stopPropagation(); curIdx=(curIdx-1+it.assets.length)%it.assets.length; paint();};
      next.onclick=(e)=>{e.stopPropagation(); curIdx=(curIdx+1)%it.assets.length; paint();};
      nav.append(prev,ind,next); stage.appendChild(nav);
    }
  }

  const info = $('#info'); info.innerHTML='';
  const add = (title, node)=>{
    const s = el('div','sect'); const h = el('h4'); h.textContent=title; s.appendChild(h); s.appendChild(node); info.appendChild(s);
  };
  const pbox = (text, label)=>{
    const b = el('div','pbox'); b.textContent = text || '（空）';
    const btn = el('button','btn'); btn.textContent='复制';
    btn.onclick = ()=>copy(text, label);
    const wrap = el('div'); wrap.appendChild(b);
    if(text) wrap.appendChild(btn);
    return wrap;
  };
  add('正向提示词', pbox(it.positive, '正向提示词'));
  if(it.negative) add('负向提示词', pbox(it.negative, '负向提示词'));
  if(it.note){ const d=el('div'); d.style.cssText='font-size:12.5px;line-height:1.7;color:#c3cbd8;white-space:pre-wrap'; d.textContent=it.note; add('备注', d); }

  const allBtn = el('button','btn');
  allBtn.textContent = '复制全部（提示词 + 参数）';
  allBtn.onclick = ()=>copy(allText(it), '全部');
  add('一次性复制', allBtn);

  const params = [];
  if(it.model) params.push(['模型', it.model]);
  if(it.size) params.push(['尺寸', it.size]);
  if(it.seed) params.push(['Seed', it.seed]);
  if(it.steps) params.push(['步数', it.steps]);
  if(it.cfg) params.push(['CFG', it.cfg]);
  if(it.sampler) params.push(['采样器', it.sampler]);
  if(it.rating) params.push(['评分', stars(it.rating)]);
  if(it.url) params.push(['来源页', it.url]);
  if(params.length){
    const kv = el('div','kv');
    for(const [k,v] of params){
      const kk = el('div','k'); kk.textContent=k;
      const vv = el('div','v');
      if(k==='来源页' && /^https?:/i.test(v)){
        const ln = el('a'); ln.href=v; ln.target='_blank'; ln.rel='noreferrer'; ln.textContent=v; vv.appendChild(ln);
      } else {
        vv.textContent=v;
      }
      kv.append(kk,vv);
    }
    const wrap = el('div'); wrap.appendChild(kv);
    const cp = el('button','btn');
    cp.textContent='复制参数';
    cp.onclick=()=>copy(params.map(p=>p[0]+': '+p[1]).join('\\n'), '参数');
    wrap.appendChild(cp);
    add('生成参数', wrap);
  }
  if(it.tags.length){
    const tw = el('div','tags');
    for(const n of it.tags){
      const tg = el('div','tag'); tg.textContent=n;
      tw.appendChild(tg);
    }
    add('标签', tw);
  }
  const assetsInfo = el('div','kv');
  it.assets.forEach((a,i)=>{
    const kk = el('div','k'); kk.textContent = '#'+(i+1);
    const vv = el('div','v'); vv.textContent = [a.kind, a.w&&a.h? a.w+'×'+a.h:'', a.name || a.rel.split('/').pop()].filter(Boolean).join(' · ');
    assetsInfo.append(kk,vv);
  });
  add('产物（共 '+it.assets.length+' 个）', assetsInfo);
}

function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(t._t); t._t = setTimeout(()=>t.classList.remove('on'), 1600);
}

$('#q').oninput = (e)=>{ state.q = e.target.value; render(); };
$('#close').onclick = close;
$('#modal').onclick = (e)=>{ if(e.target.id==='modal') close(); };
document.addEventListener('keydown', (e)=>{
  if(e.key==='Escape') close();
  if($('#modal').classList.contains('on')){
    if(e.key==='ArrowLeft' && cur){ curIdx=(curIdx-1+cur.assets.length)%cur.assets.length; paint(); }
    if(e.key==='ArrowRight' && cur){ curIdx=(curIdx+1)%cur.assets.length; paint(); }
  }
});
renderChips(); render();
`

export function buildPreviewHtml(pack: PreviewPack): string {
  const tagCount = new Map<string, number>()
  for (const it of pack.items) for (const t of it.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1)
  const tagColors: Record<string, string[]> = {}
  for (const t of pack.tags) {
    if (!tagColors[t.name]) tagColors[t.name] = []
    tagColors[t.name].push(t.color)
  }

  const payload = {
    name: pack.name,
    exportedAt: pack.exportedAt,
    items: pack.items,
    tags: [...tagCount.entries()].map(([name, n]) => ({ name, n })),
    tagColors
  }

  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(pack.name)} · PromptPair 分享包</title>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div class="brand">
    <span class="dot"></span>
    <span>${escapeHtml(pack.name)}</span>
    <span class="meta" id="count"></span>
  </div>
  <div class="ctl">
    <input id="q" type="search" placeholder="搜索提示词 / 标题 / 标签…" autocomplete="off">
    <div id="chips" style="display:flex;gap:6px;flex-wrap:wrap"></div>
  </div>
  <div class="hint">点卡片看大图；卡片上的「复制提示词」可直接复制。</div>
</header>
<main class="grid" id="grid"></main>
<footer class="foot">
  由 PromptPair ${escapeHtml(pack.appVersion)} 导出于 ${escapeHtml(pack.exportedAt)} · 共 ${pack.items.length} 条记录
</footer>
<div class="modal" id="modal">
  <div class="panel" onclick="event.stopPropagation()">
    <div class="phead">
      <div>
        <div style="font-size:14px;font-weight:600" id="mTitle"></div>
        <div style="font-size:11.5px;color:var(--fg-3);margin-top:2px" id="mSub"></div>
      </div>
      <div class="x" id="close">×</div>
    </div>
    <div class="pbody">
      <div class="stage" id="stage"></div>
      <div class="info" id="info"></div>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script type="application/json" id="pp-data">${json}</script>
<script>${JS}</script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
