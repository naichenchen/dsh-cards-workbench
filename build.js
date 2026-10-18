// esbuild 构建：src/CardWorkbench.tsx → public/CardWorkbench.js
// external react/react-dom → 用 iframe HTML 里引的全局 React（UMD）
// css loader 设为 empty → tsx 里的 import './card.css' 当空（靠 HTML <link> 引样式）
import * as esbuild from 'esbuild'
import { writeFileSync } from 'node:fs'

await esbuild.build({
  entryPoints: ['src/CardWorkbench.tsx'],
  bundle: true,
  // react/react-dom 打包进来（自包含，不依赖 CDN/CSP，绕过 DSH iframe 外部脚本限制）
  format: 'iife',
  globalName: 'CardWorkbenchMod',
  outfile: 'public/CardWorkbench.js',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'empty' },
  target: ['chrome110'],
  logLevel: 'info',
})

// 写构建时间戳 → index.js 用它给 js/css 加 ?v=，彻底防浏览器缓存旧产物
const stamp = String(Date.now())
writeFileSync('build-stamp.json', JSON.stringify({ stamp, at: new Date().toISOString() }), 'utf8')

console.log('build ok: public/CardWorkbench.js  (stamp ' + stamp + ')')
