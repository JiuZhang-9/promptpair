# PromptPair · 提示词配对

把**提示词**和它产出的**图片/视频**配成一对，本地管理、打标分类、打包带走。

一个提示词 → 多张结果图。全部存在你自己的硬盘上，不上云，不需要登录。

<p align="center">
  <img src="build/icon.png" width="96" alt="PromptPair">
</p>

<p align="center">
  <a href="https://github.com/JiuZhang-9/promptpair/releases/latest">
    <img src="https://img.shields.io/github/v/release/JiuZhang-9/promptpair?label=%E4%B8%8B%E8%BD%BD&style=for-the-badge" alt="下载最新版">
  </a>
  <img src="https://img.shields.io/github/actions/workflow/status/JiuZhang-9/promptpair/ci.yml?label=CI" alt="CI">
  <img src="https://img.shields.io/badge/platform-Windows%20x64-6c8cff" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-4fd1a5" alt="License">
</p>

## 下载安装

**[⇩ 点这里下载最新版 PromptPair-Setup.exe](https://github.com/JiuZhang-9/promptpair/releases/latest)**

安装时 Windows 会提示「未知发布者」（因为没买代码签名证书），点 **更多信息 → 仍要运行** 即可。
装好之后，以后有新版本会**自动提示升级**，不用再来这里下载。

---

## 为什么是"配对"而不是"图库"

普通素材管理工具只关心**文件**。但生成式创作的资产其实是**一条提示词 + 它跑出来的 N 个结果**——分开存，也就失去了复用价值。

所以本工具的第一性设计只有三条：

1. **配对**：一条记录 = 1 个提示词 + N 个产物（一对多）
2. **元数据**：标签、集合、评分、生成参数（模型 / seed / 尺寸 / 步数 / CFG）
3. **可搬运**：整个库是一个文件夹，可以整体搬走；导出的分享包**对方不装软件也能看**

其余（画廊、搜索、批量操作）都是这三条之上的界面。

---

## 功能

| 能力 | 说明 |
| --- | --- |
| 一对多 | 同一提示词的多张/多段产物共用一条记录，画廊里横滑查看 |
| 三种录入 | 拖拽 + 粘贴 / 整目录批量导入 / 浏览器插件框选采集 |
| 浏览器采集 | 任意网页框选图片/视频；`blob:` 或受保护时先转 data URL；读不到还可以拖框截图 |
| 自动识别 | 读同名 `.txt`、PNG 内嵌参数（SD WebUI）、ComfyUI `.json`，从文件名猜 seed 与尺寸 |
| 自动打标 | 按父文件夹名生成标签；自动识别 13 个生成平台 |
| 连号合并 | `xxx_1.png` `xxx_2.png` 自动合成一条记录 |
| 去重 | 内容哈希去重（精确）+ 感知哈希检测（近似），可一键清理 |
| 打标效率 | 多选批量加/移标签、批量评分、批量归入集合 |
| 标签治理 | 按使用数排序，批量重命名 / 合并 / 删除；自动提示近似重复标签 |
| 快捷键 | `Ctrl+J`/`Ctrl+K` 移动焦点、`Space` 选中、`1`–`5` 评分、`?` 查看全部，不看鼠标走完打标流程 |
| 布局 | 设置改为居中弹窗；左右栏可收起（`Ctrl+B` / `Ctrl+Shift+B`），状态记住 |
| 卡片操作 | 悬停或 `Ctrl+C` 复制提示词；`Ctrl+滚轮` 缩放；空白拖拽框选；点空白取消选中 |
| 模型显示 | 卡片/详情显示生成模型；编辑器基础区可直接改；AI 模型在设置里常显 |
| AI 打标（可选） | 接入任意 OpenAI 兼容接口，候选标签确认后才写入；不填 Key 时完全离线 |
| 分享 | 导出 `.promptpack`（可导回、含原图/视频）或单页 HTML（双击即看、直接复制）；预览页自带浏览 |
| 自动更新 | GitHub Releases + electron-updater，静默检查、一键重启 |

---

## 快速开始（普通用户）

1. 下载 `PromptPair-Setup-x.y.z.exe`，双击安装（Windows 会提示"未知发布者"，点「更多信息 → 仍要运行」）
2. 首次打开会在「文档\PromptPair」创建素材库
3. 把图片拖进窗口 → 粘贴提示词 → 打标签 → 保存

详细图文步骤见 **[docs/使用手册.md](docs/使用手册.md)**。

---

## 开发

```bash
npm install          # 安装依赖
npm run dev          # 开发模式（热更新）
npm run typecheck    # 类型检查
npm run build        # 只编译，不打包
npm run dist         # 生成 Windows 安装包到 release/
npm run clean        # 清空构建产物（构建失败时先跑它）
```

### 验收脚本

```bash
# 如果环境里设置了 ELECTRON_RUN_AS_NODE，先去掉它
env -u ELECTRON_RUN_AS_NODE npx electron scripts/verify-import.cjs   # 导入管线
env -u ELECTRON_RUN_AS_NODE npx electron scripts/verify-pack.cjs     # 分享包端到端
env -u ELECTRON_RUN_AS_NODE npx electron scripts/verify-tags.cjs     # 标签治理
env -u ELECTRON_RUN_AS_NODE npx electron scripts/verify-ai.cjs       # AI 全链路（本地 mock）
env -u ELECTRON_RUN_AS_NODE npx electron scripts/verify-keys.cjs     # 键盘与面板
env -u ELECTRON_RUN_AS_NODE npx electron scripts/verify-ui.cjs       # 布局、复制、缩放、框选
env -u ELECTRON_RUN_AS_NODE npx electron scripts/verify-share.cjs    # 单页 HTML 分享
env -u ELECTRON_RUN_AS_NODE npx electron scripts/verify-capture.cjs  # 浏览器采集接收端
```

> **产物目录只有一个：`release/`。**
> 构建报「文件被占用」时，先 `npm run clean` 再重来，
> **不要**用 `--config.directories.output=xxx` 换个目录绕过去 —— 那正是仓库里一度出现
> `rel/`、`rel2/` 三个产物目录的原因。规则见 [docs/发布规范.md 第 9 节](docs/发布规范.md)。
>
> 本地打好的安装包会**按版本号保留**在 `release/`，`npm run clean` 不会删它们；只有坏包才删。

### 环境要求

- Node.js ≥ 20（推荐 22）
- Windows 10/11 x64

### 目录结构

```
src/
├─ main/            Electron 主进程（有 Node 权限）
│  ├─ index.ts      窗口、自定义协议、生命周期
│  ├─ ipc.ts        全部 IPC 契约（渲染层唯一入口）
│  ├─ library.ts    库存储：原子写、迁移、CRUD
│  ├─ media.ts      内容寻址入库、缩略图、感知哈希
│  ├─ sidecar.ts    旁车文件 / PNG 内嵌元数据 / 平台识别
│  ├─ importer.ts   导入编排 + 规则引擎（连号合并、自动打标）
│  ├─ exporter.ts   .promptpack 打包 / 解包 / 合并
│  ├─ preview.ts    分享包自带的静态浏览页
│  ├─ duplicates.ts 近似重复检测（dHash + 并查集）
│  ├─ ai.ts        AI 辅助打标（OpenAI 兼容接口）
│  ├─ capture.ts    浏览器采集的本地接收端（127.0.0.1）
│  ├─ updater.ts    自动更新
│  └─ config.ts     应用配置（存 userData，不进库）
├─ preload/         contextBridge 白名单 API
├─ renderer/        React 界面
└─ shared/types.ts  数据模型（唯一事实来源）
extension/          Chrome / Edge 插件（MV3，通用框选）
build/              图标与 NSIS 脚本
scripts/            图标生成、演示库、视觉验收截图
docs/               规范与手册
```

### 技术栈

Electron 33 · React 18 · TypeScript · Vite (electron-vite) · Zustand · fflate
无原生模块依赖 —— 这是刻意选择：克隆下来 `npm install` 就能构建成功，不需要 Visual Studio Build Tools。

---

## 数据存在哪

```
文档\PromptPair\
├─ library.json        全部结构化数据（可读的 JSON）
├─ library.json.bak    上一次保存的备份
├─ media/ab/<sha>.png  原始文件（按 SHA-256 内容寻址）
└─ thumbs/ab/<sha>.jpg 缩略图
```

整个文件夹可以直接复制到 U 盘、另一台电脑，或压缩发给别人（对方装同款即可打开）。

应用配置单独存在 `%APPDATA%\PromptPair\config.json`，**不随库走**。

---

## 路线图

| 版本 | 主题 | 状态 |
| --- | --- | --- |
| 0.1.0 | 能用：配对 / 录入 / 打标 / 分享 / 自动更新 | ✅ |
| 0.2.0 | 专业：黑白灰设计体系 | ✅ |
| 0.2.1 | 修复：自动更新报错 | ✅ |
| 0.3.0 | 打得快：标签治理、快捷键、AI 辅助打标 | ✅ 已并入 0.3.1 |
| 0.3.1 | 补丁：Ctrl 快捷键、帮助入口、窗口显示修复 | ✅ 已发布 |
| 0.4.0 | 顺手：设置弹窗、左右栏收起、快捷复制、缩放、框选 | ✅ 已发布 |
| 0.4.1 | 补丁：栏位动画不抖、Shift+右键复制 | ✅ 已发布 |
| 0.5.0 | 分享：单页 HTML、模型显示与设置 | ✅ 已发布 |
| 0.5.1 | 补丁：浏览器采集 blob 图片修复 | ✅ 已发布 |
| 0.5.2 | 补丁：浏览器拖框截图采集、点卡片不再缩放 | ✅ 已发布 |
| 0.6.0 | 看得清：大字号、卡片打星/收藏/标签、界面比例 | ✅ 已发布 |
| 0.7.0 | 视频：时长与分辨率、悬停预览，黑白灰调柔 | ✅ 已发布 |
| 0.7.1 | 界面细则：卡片固定尺寸（收放不缩放） | ✅ 已发布 |
| 0.8.0 | 模型词表：受控录入、模型管理、模型筛选 | ✅ 已发布 |
| 0.8.1 | 补丁：分享包携带模型词表 | ✅ 已发布 |
| 0.9.0 | 找得到：保存视图、相似图搜索 | 待排 |
| 0.10.0 | 带得走：静态站点、增量分享包 | 待排 |
| 1.0.0 | 敢托付：迁移保障、性能基线 | 远期 |

完整清单（含每项的**验收标准**与"明确不做"的范围）见 **[docs/路线图.md](docs/路线图.md)**。

---

## 发布

版本、提交、标签、日志的规则见 **[docs/发布规范.md](docs/发布规范.md)**。摘要：

- 版本号遵循 **SemVer 2.0.0**，标签格式 `v1.2.3`
- 提交遵循 **Conventional Commits**（`feat(import): ...`）
- 变更日志遵循 **Keep a Changelog 1.1.0**
- 打 tag 推送到 GitHub → Actions 自动构建并发布 Release → 客户端自动更新

第一次发版前，把仓库地址填进去：

```bash
node scripts/set-repo.mjs 你的GitHub用户名
```

---

## 许可

MIT
