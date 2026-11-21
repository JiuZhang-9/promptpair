# AI 批量录入指南

> 目标：让 AI 帮你把网页 / 公众号文章 / 第三方工具里的提示词和图片，批量变成 PromptPair 里的记录。
> 结论先说：**不需要写 SQL**。PromptPair 的库是 `library.json`，录入走应用的 `--cli add --batch` 通道；AI 只需要产出批次 JSON。

---

## 一、先选路线

| 场景 | 推荐方式 | 说明 |
| --- | --- | --- |
| 一次只收几张图 | 浏览器插件框选采集 | 见使用手册第八节，不需要 AI |
| 一次几十到几百条 | **CLI 批次 JSON** | 本文重点；AI 负责提炼，PromptPair 负责下载/去重/缩略图/入库 |
| 想边看边改 | 浏览器插件 + 手动编辑 | AI 只做初稿，人工补标签 |

---

## 二、不需要 SQL

PromptPair 没有数据库：

- 一个库 = 一个文件夹（`library.json` + `media/` + `thumbs/`）
- 条目是 JSON 数组，图片按 sha256 内容寻址
- 批量录入由应用自己完成：内容哈希去重、缩略图、dHash、schema 迁移、写前备份

所以不要让 AI 生成 `INSERT` / `UPDATE`。让它生成一个**批次 JSON 文件**，再交给 CLI。

---

## 三、AI 负责什么、不负责什么

AI 适合：

- 读文章 / 网页 / 表格，提取标题、正向提示词、负向提示词、备注
- 从正文里识别 MJ 参数（`--ar --v --chaos --stylize --sref --profile --no …`）并拆成字段
- 给标签、集合、模型名起名
- 产出符合下面格式的 JSON

AI 不一定能：

- 把图片稳定下载到你的电脑（很多工具没有本地写文件权限）
- 绕过登录态 / 防盗链 / `blob:` 图片

因此推荐：

- **0.13.0 起**：让 AI 直接输出 `assets: [{ "url": "https://…" }]`，CLI 自动下载
- 如果图片下载失败：先手动或脚本把图存到本地，再把 `url` 改成 `path`

---

## 四、批次 JSON 格式

```json
{
  "entries": [
    {
      "originId": "wx-mj336:02",
      "title": "Vol.336 #02 中式超现实·借景抒怀",
      "positive": "extreme wide establishing shot, surreal Song dynasty lotus pond, monumental lotus leaves …",
      "negative": "",
      "note": "",
      "task": "t2i",
      "rating": 0,
      "favorite": false,
      "tags": [
        { "name": "武侠", "group": "题材" },
        { "name": "电影感", "group": "风格" }
      ],
      "collections": ["MJ 精选 Vol.336"],
      "params": {
        "model": "Midjourney",
        "extra": {
          "aspect": "3:4",
          "version": "8.2",
          "chaos": "5",
          "profile": "ox27gsk",
          "sref": "613512513",
          "mjCodes": "--sref 613512513 --profile ox27gsk",
          "mjCodeparam": "--chaos 5 --ar 3:4 --v 8.2 --sref 613512513 --profile ox27gsk",
          "mjCodeMode": "multi",
          "mjCodeCount": "2"
        }
      },
      "assets": [
        { "url": "https://example.com/original.png", "role": "原图" },
        { "url": "https://example.com/result.png", "role": "成图" }
      ]
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `originId` | 强烈建议 | 跨批次幂等键；重复执行更新同一条，不会重复创建 |
| `title` | 是 | 卡片标题 |
| `positive` | 是 | 正向提示词正文 |
| `negative` / `note` | 否 | 负向 / 备注 |
| `task` | 否 | `t2i` 文生 / `i2i` 图生；不填时按提示词里的「参考图 / 垫图 / 编辑」推断 |
| `rating` / `favorite` | 否 | 0–5 星 / 是否收藏 |
| `tags` | 否 | 字符串或 `{ name, group }`；不存在会自动创建，组不存在也会建 |
| `collections` | 否 | 集合名数组；不存在会自动创建 |
| `params.model` | 否 | 模型名；词表里没有会自动补一条 |
| `params.extra` | 否 | MJ 参数 / 风格码等自由 KV；**原样保留**，搜索和复制都能用 |
| `assets` | 否 | `{ path }` 本地文件，或 `{ url }` 远程图片/视频；顺序即展示顺序 |

> MJ 参数建议同时保留 `mjCodeparam`（原始参数串）和结构化字段（`aspect / version / sref / profile …`）。
> 复制「提示词+MJ参数」优先用 `mjCodeparam`，能原样拼回命令。

---

## 五、给 AI 的提示词模板

把下面这段和文章正文 / 网页链接一起发给 AI：

```text
你是提示词素材整理助手。请把给定内容整理成 PromptPair 批次 JSON。

要求：
1. 只输出 JSON，不要解释，不要 Markdown 代码块。
2. 顶层是 {"entries":[...]}。
3. 每篇文章/每个作品一条记录；同一条作品的原图与成图放在同一个 assets 数组里。
4. positive 只放提示词正文；MJ 参数从正文末尾剥离，放进 params.extra：
   - 保留原始参数串到 mjCodeparam
   - 拆分 aspect/version/chaos/stylize/weird/raw/hd/tile/sref/profile/styleWeight
   - 风格码同时拼一份到 mjCodes
   - 有多个码时 mjCodeMode 写 multi、mjCodeCount 写数量；单个写 solo
   - 负向词放进 negative，不要放进 positive
5. 标签优先复用我给过的标签名；没有就给 2–4 个简短中文标签，并标注组（风格/题材/镜头/画质/用途）。
6. collections 用文章名或栏目名。
7. params.model 用英文官方名（Midjourney / Seedream / Kling / Flux / SDXL …），不带版本号。
8. originId 用「来源:文章id:序号」这种稳定写法。
9. 图片地址只写 http/https URL；找不到图片就省略 assets。
10. 不要输出 SQL，不要输出数据库语句。

输出示例：
{"entries":[{"originId":"wx-article:01","title":"…","positive":"…","tags":["…"],"collections":["…"],"params":{"model":"Midjourney","extra":{"mjCodeparam":"…"}},"assets":[{"url":"https://…"}]}]}
```

如果 AI 不能直接访问网页，先把文章正文复制给它；图片链接可以保留在正文里，让它提取。

---

## 六、执行导入

假设 PromptPair 安装在默认位置：

```powershell
$exe = "$env:LOCALAPPDATA\Programs\PromptPair\PromptPair.exe"

# 1. 预检：只统计，不写库
& $exe --cli add --batch .\批次.json --dry-run

# 2. 正式写入（软件开着也可以，会自动转发给运行中的实例）
& $exe --cli add --batch .\批次.json
```

也可以用 `--library` 指定库路径：

```powershell
& $exe --cli add --batch .\批次.json --library "D:\我的素材库"
```

完成后回到 PromptPair：库会自动刷新，或者手动点一下当前筛选。

---

## 七、常见问题

**Q：AI 给的图片 URL 下载失败怎么办？**
A：常见原因是防盗链、登录态、`blob:` 临时地址。先把图手动存到本地，再把该条目的 `assets` 改成 `{ "path": "D:/图/xxx.png" }`。

**Q：会不会重复？**
A：同一 `originId` 重复执行是更新；媒体按 sha256 去重，同一个文件不会复制两份。

**Q：需要先退出软件吗？**
A：不需要。0.12.2 起写命令会转发给运行中的 PromptPair，由它自己导入并刷新界面；写前仍会自动备份 `library.json`。

**Q：能把标签组也一起建出来吗？**
A：可以。`tags` 用 `{ "name": "武侠", "group": "题材" }`，组不存在会自动创建。

**Q：批次很大怎么办？**
A：按文章 / 栏目拆成多个 JSON 分批执行；每批都有 `originId`，重复跑不会重复创建。

**Q：能让 AI 直接改 `library.json` 吗？**
A：不建议。绕过 CLI 就绕过了去重、缩略图、dHash 和备份；只在做纯数据修复、且软件已关闭时考虑。

---

## 八、最短路径（懒人版）

1. 把文章链接 / 正文 + 上面的提示词模板发给 AI
2. 保存 AI 输出的 JSON 为 `批次.json`
3. 运行 `PromptPair.exe --cli add --batch 批次.json --dry-run`
4. 没问题再运行一次去掉 `--dry-run`
5. 回软件里打星、补标签、整理集合

全程不需要 SQL，也不需要写代码。
