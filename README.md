# PromptPair · 提示词配对

把**提示词**和它产出的**图片/视频**配成一对，本地管理、打标分类、打包带走。

一个提示词 → 多张结果图。全部存在你自己的硬盘上，不上云，不需要登录。

<p align="center">
  <img src="build/icon.png" width="96" alt="PromptPair">
</p>

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
| 自动识别 | 读同名 `.txt`、PNG 内嵌参数（SD WebUI）、ComfyUI `.json`，从文件名猜 seed 与尺寸 |
| 自动打标 | 按父文件夹名生成标签；自动识别 13 个生成平台 |
| 连号合并 | `xxx_1.png` `xxx_2.png` 自动合成一条记录 |
| 去重 | 内容哈希去重（精确）+ 感知哈希检测（近似），可一键清理 |
| 打标效率 | 多选批量加/移标签、批量评分、批量归入集合 |
| 分享 | 导出 `.promptpack`，内含数据 + 媒体 + **自带浏览页**，双击即看 |
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
```

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
