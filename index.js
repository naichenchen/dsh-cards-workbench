// dsh-cards-workbench 后端：起 /cards/ 路由，返回会话地图 web app（iframe 加载）
// 参考 dsh-synapse 的 index.js 路由注册模式。cards 不存自己的数据，只读 DSH 会话，
// 所以后端极简：只负责吐 HTML + 静态资源。数据桥在 client.js（前端）通过 postMessage 走。
import { readFile } from 'node:fs/promises'

export const name = 'cards-workbench'
export const inject = ['webServer']

const HERE = new URL('./', import.meta.url)
const readOwn = (rel) => readFile(new URL(rel, HERE), 'utf8')

function sendFile(res, type, body) {
  res.writeHead(200, {
    'content-type': type,
    // 禁掉一切缓存：插件频繁迭代，浏览器缓存旧 js 会造成"改了没生效"的假象
    'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
    'pragma': 'no-cache',
    'expires': '0',
  })
  res.end(body)
}

// iframe 内的 HTML：只引 card.css + CardWorkbench.js（React 已 bundle 进 JS，自包含，不依赖 CDN/CSP）
// ★ 关键：iframe 是独立文档，拿不到 DSH 父窗口的主题变量（--bg/--ink/--hairline…），
//   所以这里注入一套等价的变量定义（含明暗两套），并把 DSH 的 data-ds-dark-theme 同步过来
//   （client.js 收到主题推送后会给 iframe 的 documentElement 设 data-cards-theme）。
// 构建时间戳：每次 build 由 build.js 写入 build-stamp.json，用作 ?v= 防缓存
let BUILD_STAMP = String(Date.now())
try { BUILD_STAMP = JSON.parse(await readOwn('build-stamp.json')).stamp } catch { /* 用默认 */ }

function page() {
  return `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>脉络图</title>
  <link rel="stylesheet" href="/cards/card.css?v=${BUILD_STAMP}">
  <style>
    html,body{margin:0;height:100%;overflow:hidden}
    /* #root 必须是 flex 容器，.cw 的 flex:1 才能拿到高度，内部滚动才生效 */
    #root{height:100%;display:flex;flex-direction:column;min-height:0;overflow:hidden}
    body{background:var(--bg);color:var(--ink)}
    :root{
      --bg:#ffffff; --bg-sidebar:#f7f8fa; --ink:#1f2328; --ink-dim:#57606a; --ink-faint:#8b949e;
      --hairline:#e5e7eb; --menu-bg:#ffffff; --menu-hover:#f3f4f6;
      --accent:#2563eb; --accent-soft:rgba(37,99,235,.10); --accent-tint-border:rgba(37,99,235,.35);
      --danger:#dc2626; --danger-bg:#fef2f2; --panel:#ffffff;
      --shadow-sm:0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.10);
      color-scheme: light;
    }
    :root[data-cards-theme="dark"]{
      --bg:#1a1a1a; --bg-sidebar:#141414; --ink:#e8e8e8; --ink-dim:#a8a8a8; --ink-faint:#7a7a7a;
      --hairline:#2e2e2e; --menu-bg:#202020; --menu-hover:#2a2a2a;
      --accent:#5b9dff; --accent-soft:rgba(91,157,255,.16); --accent-tint-border:rgba(91,157,255,.4);
      --danger:#f87171; --danger-bg:rgba(248,113,113,.12); --panel:#1a1a1a;
      --shadow-sm:0 1px 2px rgba(0,0,0,.4), 0 1px 3px rgba(0,0,0,.3);
      color-scheme: dark;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="/cards/CardWorkbench.js?v=${BUILD_STAMP}"></script>
</body>
</html>`
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/cards',
    handler: (_req, res) => { res.writeHead(302, { location: '/cards/' }); res.end() }
  }), 'cards: redirect')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/cards/',
    handler: (_req, res) => sendFile(res, 'text/html; charset=utf-8', page())
  }), 'cards: page')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/cards/CardWorkbench.js',
    handler: async (_req, res) => sendFile(res, 'text/javascript; charset=utf-8', await readOwn('public/CardWorkbench.js'))
  }), 'cards: app')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/cards/card.css',
    handler: async (_req, res) => sendFile(res, 'text/css; charset=utf-8', await readOwn('src/card.css'))
  }), 'cards: styles')
}
