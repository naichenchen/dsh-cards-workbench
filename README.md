# 脉络图 · dsh-cards-workbench

> 把 DSH 的每次对话摊成一张画布 —— **一卡一回合**，连线表示顺序，寒暄自动折叠。

DSH（DeepSeek Harness）的前端插件。在你的对话区顶部，和「对话 / 轨迹」并列多出一个「**脉络图**」tab。

---

## 它解决什么问题

DSH 原生对话是**线性的长列表**，聊到几十上百轮之后：

- 想回顾「上次那个结论是什么」，得一路往上滚
- 分不清哪些是重点、哪些是寒暄
- 看不到对话的**结构**，只有一坨文字

脉络图把整场对话铺开成二维画布：

```
┌─────────┐      ┌─────────┐      ┌─────────┐
│ 回合 1  │ ───▶ │ 回合 2  │ ───▶ │ 回合 3  │
│ 你的提问 │      │ 你的提问 │      │ 你的提问 │
│ AI 回复  │      │ AI 回复  │      │ AI 回复  │
└─────────┘      └─────────┘      └─────────┘
                       │
                       │ ⑂ 分支
                       ▼
                  ┌─────────┐
                  │ 接着聊   │
                  └─────────┘
```

**一眼看到对话全貌**，点卡片看完整内容，拖拽自由排版。

---

## 主要功能

| 功能 | 说明 |
|---|---|
| **一卡一回合** | 每张卡片 = 你问的一段 + AI 答的一段 |
| **顺序连线** | 卡片之间用曲线连起来，看清时间线 |
| **只看重点 / 看全部** | 自动识别寒暄和碎片，一键折叠 |
| **卡片展开** | 点一下看这一回合的完整问答 |
| **自由拖拽** | 卡片位置自己摆，布局本地保存 |
| **画布平移缩放** | 滚轮 / 拖背景 |
| **⑂ 接着聊** | 从任意回合延续，消息直接发进当前会话 |
| **会话列表** | 所有会话一览，点卡片进入 |
| **深浅色主题** | 跟随 DSH 主题自动切换 |

### 关于「只看重点」的筛选规则

会自动折叠掉这三类：

- **寒暄附和** —— 嗯 / 好的 / 谢谢 / ok …
- **短碎片** —— 提问少于 5 个字
- **随口一问** —— 提问 < 12 字 **且** 回答 < 100 字

系统注入消息（运行时快照、权限通知等）**不会伪装成你的提问**，而是挂到对应回合里、加 `⟪系统⟫` 前缀。切「看全部」可以全部看到。

---

## 安装

前提：已装 DSH，且版本 **0.2.0 或以上**。

### 1. 拿到插件

```bash
git clone <本仓库地址> dsh-cards-workbench
cd dsh-cards-workbench
npm install
npm run build
```

### 2. 注册到 DSH profile

编辑你的 DSH profile（一般在 `~/.dsh/profiles/web/`）：

**`package.json`**：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["...已有的...", "dsh-cards-workbench"]
    }
  },
  "dependencies": {
    "dsh-cards-workbench": "link:<你的克隆路径>/dsh-cards-workbench"
  }
}
```

### 3. 装依赖并重启 DSH

```bash
cd ~/.dsh/profiles/web
pnpm install
```

然后**完全重启 DSH**（客户端插件产物要重启才会进模块图）。

打开对话，顶部应该多出「脉络图」tab。

---

## 开发

```bash
npm run build     # 编译 src/CardWorkbench.tsx → public/CardWorkbench.js
npm run check     # 语法自检
```

**改完必须重启 DSH 才生效。** DSH 的客户端插件 bundle 只有在启动时才会重新进模块图 —— 改完文件直接"看不到变化"是最常见的坑。

### 目录结构

```
dsh-cards-workbench/
├── package.json          # 插件清单：dsh.bundle + dsh.client
├── cordis.patch.yml      # 把插件塞进 profile
├── index.js              # 后端：起 /cards/ 路由，吐 HTML + 静态资源
├── client.js             # 前端桥：注册 tab，iframe ↔ DSH ctx API 的 postMessage
├── build.js              # esbuild 构建脚本
├── src/
│   ├── CardWorkbench.tsx # 画布 UI（主要源码）
│   └── card.css          # 样式（纯 CSS 变量，无外部依赖）
└── public/
    └── CardWorkbench.js  # 构建产物（已打包 React，自包含）
```

### 架构简述

```
DSH 主窗口
  └─ client.js（注册 conversation.view tab）
       └─ <iframe src="/cards/">          ← 独立文档，避免样式污染
            └─ CardWorkbench.js（画布 UI）
                 ↕ postMessage 桥
            client.js 转发 → DSH ctx.sessions API
```

**为什么用 iframe？** 隔离样式和 React 运行时，避免跟 DSH 自身的 UI 打架。

**为什么 React 要打包进产物？** iframe 里引不到外部的 React（CSP + 无共享模块表），所以产物必须自包含。

---

## 已知限制

- **依赖 DSH 内部 API** —— 用的是 `ctx.sessions` / `ctx.slots` 等内部服务，DSH 大版本升级可能需要适配
- **历史分页** —— 超长会话首次打开需要翻页，慢一点（之后走缓存）
- **会话列表缓存** —— 为"秒开"，列表有内存缓存，手动刷新按钮可强刷
- **不是实时同步** —— 发送消息后新回合出现有轻微延迟

---

## 兼容性

| 项 | 要求 |
|---|---|
| DSH | `0.2.0+` |
| Node | `>= 22` |
| 平台 | Web / 桌面端（Electron 外壳） |

---

## 许可

MIT
