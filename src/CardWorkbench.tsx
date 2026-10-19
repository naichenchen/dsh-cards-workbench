/* 脉络图（Thread Map）—— 把一次对话摊成一张画布（DSH 插件 · 移植自 Hermes 气泡谱）
   ────────────────────────────────────────────────────────────
   设计参考：dsh-synapse（把 DSH 对话摊成一张地图：只看思路节点，不复制全文）
     · 一级：会话列表 —— 每张卡是一个会话
     · 点进去：该会话的画布 —— 每张卡是一个「对话回合」（你问 + 我答）
     · 卡片连卡片 = 对话顺序（第 1 轮 → 第 2 轮 → …）
     · 默认只留有实质内容的回合（寒暄自动折叠），可切「看全部」

   数据：postMessage 桥 → DSH client.js → ctx.sessions / ctx.uiConversation
   主题：只用应用主题变量，明暗自动跟随
*/
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { JSX, WheelEvent as ReactWheelEvent } from 'react'
import './card.css'

/* ── postMessage 桥（跟 DSH client.js 通信，替代原 window.hib）──
   iframe 内的组件通过 window.parent.postMessage 向 DSH 主窗口发请求，
   client.js 拿到后调 ctx.sessions/uiConversation API，再把结果回传。 */
const BRIDGE = {
  _seq: 0,
  _pending: new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>(),
  init() {
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.data?.source !== 'dsh-cards') return
      if (e.data.type === 'response') {
        const p = this._pending.get(e.data.reqId)
        if (p) { this._pending.delete(e.data.reqId); p.resolve(e.data) }
      } else if (e.data.type === 'error') {
        const p = this._pending.get(e.data.reqId)
        if (p) { this._pending.delete(e.data.reqId); p.reject(new Error(e.data.error || 'bridge error')) }
      } else if (e.data.type === 'refresh') {
        window.dispatchEvent(new CustomEvent('cards:refresh'))
      } else if (e.data.type === 'theme') {
        document.documentElement.setAttribute('data-cards-theme', e.data.dark ? 'dark' : 'light')
      }
    })
  },
  request<T = any>(op: string, payload: any = {}, timeoutMs = 10000): Promise<T> {
    const reqId = ++this._seq
    return new Promise((resolve, reject) => {
      // ★ 超时保护：父窗口没回（切会话竞态/桥断了）也不能永远卡在"加载中"
      const timer = setTimeout(() => {
        if (this._pending.has(reqId)) {
          this._pending.delete(reqId)
          reject(new Error('bridge timeout (' + op + ')'))
        }
      }, timeoutMs)
      this._pending.set(reqId, {
        resolve: (v: any) => { clearTimeout(timer); resolve(v as T) },
        reject: (e: any) => { clearTimeout(timer); reject(e) },
      })
      window.parent.postMessage({ source: 'dsh-cards', type: 'request', reqId, op, payload }, location.origin)
    })
  },
}
BRIDGE.init()

type Lang = 'zh' | 'en'
type Pos = { x: number; y: number }

const T: Record<Lang, Record<string, string>> = {
  zh: {
    title: '脉络图',
    sub: '每次对话摊成一张画布 · 一卡一回合',
    refresh: '刷新',
    loading: '加载中…',
    emptyH: '从第一次对话开始',
    emptyP: '每聊一次，这里就多一个会话',
    detail: '打开',
    close: '关闭',
    noBridge: '接口缺失（桥没连上）',
    you: '你',
    ai: 'DSH',
    search: '搜索会话…',
    loadMore: '加载更多',
    loadOlder: '加载更早',
    noMatch: '没有匹配的会话',
    showing: '显示',
    loadAll: '全部加载',
    sortNew: '最新',
    sortOld: '最早',
    back: '返回列表',
    untitled: '(无标题会话)',
    turn: '回合',
    turnCount: '个回合',
    kept: '重点',
    total: '共',
    canvasEmpty: '这个会话还没有内容',
    noContent: '(这段对话没有可显示的内容)',
    composePh: '继续这个对话…（回车发送）',
    send: '发送',
    sending: '发送中…',
    reset: '重置布局',
    branch: '分支',
    branchHint: '在这一回合接着聊（发到本会话，原会话照常追加回合）',
    branchPh: '接着说…（回车发送到本会话）',
    branchOpened: '✓ 已发到本会话',
    branchTip: '（画布上会多出这一回合）',
    branchConfirm: '',
    branchOpenNew: '',
    modeKey: '只看重点',
    modeAll: '看全部',
    sysMsg: '系统注入',
    pickHint: '点一张卡，看它这一回合的完整内容',
    chitchat: '寒暄',
    noKeyTurns: '这个会话没有「重点回合」——切「看全部」试试',
  },
  en: {
    title: 'Thread Map',
    sub: 'each conversation is a canvas · each card is a turn',
    refresh: 'Refresh',
    loading: 'loading…',
    emptyH: 'Start with your first conversation',
    emptyP: 'every chat adds a session here',
    detail: 'Open',
    close: 'Close',
    noBridge: 'bridge unavailable',
    you: 'You',
    ai: 'DSH',
    search: 'Search sessions…',
    loadMore: 'Load more',
    loadOlder: 'Load earlier',
    noMatch: 'No matching sessions',
    showing: 'showing',
    loadAll: 'Load all',
    sortNew: 'Newest',
    sortOld: 'Oldest',
    back: 'Back to list',
    untitled: '(untitled)',
    turn: 'Turn',
    turnCount: 'turns',
    kept: 'key',
    total: 'of',
    canvasEmpty: 'This conversation has no content yet',
    noContent: '(nothing to show in this conversation)',
    composePh: 'Continue this conversation… (Enter to send)',
    send: 'Send',
    sending: 'sending…',
    reset: 'Reset layout',
    branch: 'Branch',
    branchHint: 'keep chatting from this turn (sends into THIS session)',
    branchPh: 'say more… (Enter → send to this session)',
    branchOpened: '✓ sent to this session',
    branchTip: '(a new turn appears on the canvas)',
    branchConfirm: '',
    branchOpenNew: '',
    modeKey: 'Key only',
    modeAll: 'All',
    sysMsg: 'system',
    pickHint: 'Click a card to read that turn in full',
    chitchat: 'chit-chat',
    noKeyTurns: 'No key turns here — try “All”',
  },
}

function fmtWhen(raw: string, lang: Lang): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)
  if (diffMin < 1) return lang === 'zh' ? '刚刚' : 'just now'
  if (diffMin < 60) return lang === 'zh' ? `${diffMin} 分钟前` : `${diffMin}m ago`
  if (diffMin < 1440) return lang === 'zh' ? `${Math.floor(diffMin / 60)} 小时前` : `${Math.floor(diffMin / 60)}h ago`
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// DSH 会话消息（从 client.js postMessage 收到，{role, text}）
type HistoryMessage = { role: string; text: string }
// DSH 会话列表项
type HibSession = { id: string; title: string; lastActive: string; workspace?: string }

// 寒暄 / 空回合：不算「重点」
const CHITCHAT = /^[\s，。！？~～、,.!?]*(好的?|好|嗯+|哦+|噢+|呃+|啊+|可以|行|去吧?|谢谢|谢|多谢|thanks?|thank you|ok|okay|收到|了解|明白|知道了?|继续|是的?|对|对的?|没问题|辛苦了?|哈哈+|嘿嘿+|emmm?|hmm+|nice|cool|赞|👍|🙏|爱你|晚安|早安|早|bye|再见|好的吧|那好|那行|开始吧|好嘞|OK呀)[\s，。！？~～、,.!?]*$/i

/* 系统注入消息（不是真人对话）——默认不显示成回合，「看全部」时仍可见：
   · <system-reminder> / <skill_content> / <command-* 等标签块
   · "Current runtime context. This snapshot supersedes…" 运行时快照
   · "[model changed: …]" / "[session started…]" 这类方括号系统通知
   · 权限/审批策略变更通知
   Hermes 原版就过滤了运行时快照，移植时漏了；这里补齐并加宽。 */
const SYS_INJECT = /^\s*(<system-reminder>|<skill_content>|<command-|Current runtime context\.|Current DSH file policy|Approval prompts are disabled|\[model changed:|\[session |\[context |\[cron )/i

// 整条消息就是一对标签包裹（如 <system-reminder>…</system-reminder>）
const SYS_WRAPPED = /^\s*<(system-reminder|skill_content|command-[a-z-]+)>[\s\S]*<\/\1>\s*$/i

function isSysInject(text: string): boolean {
  const s = (text || '').trim()
  if (!s) return false
  if (SYS_INJECT.test(s)) return true
  if (SYS_WRAPPED.test(s)) return true
  return false
}

// 一个「对话回合」= 你说的一段 + 我回的一段
interface Turn { no: number; user: string; ai: string; key: boolean; sys?: boolean }

function isKey(tn: Turn): boolean {
  const u = (tn.user || '').replace(/\[\d{4}-\d{2}-\d{2}[^\]]*\]/g, '').trim()
  const uShort = u.replace(/[\s，。！？~～、,.!?]/g, '')
  const a = (tn.ai || '').trim()
  if (tn.sys) return false                      // 整回合都是系统注入（无真人提问）：折叠
  if (!uShort && a.length < 20) return false   // 完全没内容
  if (CHITCHAT.test(u)) return false            // 纯附和/寒暄一律折叠（不管我回了多长）
  if (uShort.length < 5) return false           // 太短的碎片（"A" / "B" / "嗯"）
  // ★ 「重点」的实质门槛：你问得够长，或者回答够长。
  //   之前只看寒暄/碎片，导致正经对话里两个视图完全一样（没有可折叠的东西）。
  //   现在：太短的一问一答（问<12字 且 答<100字）算「随口一问」，折叠进「看全部」。
  if (uShort.length < 12 && a.length < 100) return false
  return true
}

function toTurns(msgs: HistoryMessage[]): Turn[] {
  const turns: Turn[] = []
  let cur: Turn | null = null
  for (const m of msgs) {
    const text = m.text || ''
    if (m.role === 'user') {
      // ★ 系统注入不单独成回合：挂到当前回合的 ai 侧（用 ⟪系统⟫ 前缀标出），
      //   否则一条通知就把完整对话切成两个假回合（"回合23 的你说的是系统通知"就是这么来的）。
      if (isSysInject(text)) {
        if (cur) cur.ai += (cur.ai ? '\n' : '') + '⟪系统⟫ ' + text
        else cur = { no: turns.length + 1, user: '', ai: '⟪系统⟫ ' + text, key: true, sys: true }
        continue
      }
      if (cur) turns.push(cur)
      cur = { no: turns.length + 1, user: text, ai: '', key: true, sys: false }
    } else {
      if (!cur) cur = { no: turns.length + 1, user: '', ai: '', key: true, sys: false }
      cur.ai += (cur.ai ? '\n' : '') + text
    }
  }
  if (cur) turns.push(cur)
  return turns
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/* ★ 等 AI 回复落地。
   DSH 的 session.prompt(..., 'queue') 只负责把消息【投递进队列】，它 resolve 时
   AI 往往还没开始跑 —— 此时立刻 load() 只能看到「你问了、没人答」的半截回合，
   画布上就是「发完消息没回复」。
   这里轮询到该回合真正闭合（最后一条不是 user）再让上层渲染。
   @returns 拿到的最新消息列表；超时则返回最后一次读到的（不让 UI 卡死） */
async function waitForTurnSettled(
  loadOnce: () => Promise<HistoryMessage[] | null>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<HistoryMessage[] | null> {
  const timeoutMs = opts.timeoutMs ?? 120000
  const intervalMs = opts.intervalMs ?? 1200
  const deadline = Date.now() + timeoutMs
  let last: HistoryMessage[] | null = null
  let sawUser = false
  while (Date.now() < deadline) {
    last = await loadOnce()
    if (last) {
      const tail = last[last.length - 1]
      // 末尾是 assistant → 这一轮已经答完，可以收工
      if (tail && tail.role === 'assistant') return last
      // 末尾是 user：说明已投递、正在等回复，继续等
      if (tail && tail.role === 'user') sawUser = true
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  // 超时：返回最后读到的内容（可能仍是半截），至少不丢已显示的东西
  void sawUser
  return last
}

/* ══ 会话画布：一个会话 = 一张画布，卡片 = 对话回合 ══ */
function ConvCanvas(props: {
  lang: Lang; sessionId: string; title: string; onBack: () => void
  input: string; setInput?: (s: string) => void
  skills?: string[]; toolsets?: string[]; reasoning?: string; permission?: string
  onDetailOpen?: (open: boolean) => void
  onSessionChange?: (sid: string) => void
}): JSX.Element {
  const { lang, sessionId, title, onBack } = props
  const t = T[lang]

  const CW = 268, CH = 138, GAP_Y = 44
  const LAYOUT_KEY = 'hib:sessionmap:' + sessionId

  const [msgs, setMsgs] = useState<HistoryMessage[] | null>(null)
  const [mode, setMode] = useState<'key' | 'all'>('key')
  const [pos, setPos] = useState<Record<string, Pos>>({})
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ id: string; sx: number; sy: number; ox: number; oy: number } | null>(null)
  const movedRef = useRef(false)   // 本次按住有没有真的拖动过（区分点击/拖拽）
  const [panning, setPanning] = useState<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const [sel, setSel] = useState<number | null>(null)   // 点开哪一回合
  // ── 分支：从一个回合分叉出去的新对话（新会话）──
  const [branches, setBranches] = useState<{ id: string; from: number; x: number; y: number; text: string; sid?: string; sidTitle?: string; busy?: boolean }[]>([])
  const [localInput, setLocalInput] = useState('')
  const [sending, setSending] = useState(false)
  // 输入状态优先用外面（App）的——底部控制条和这里共用同一份，不搞两套
  const input = props.setInput ? props.input : localInput
  const setInput = props.setInput || setLocalInput
  const boardRef = useRef<HTMLDivElement | null>(null)
  // 画布宽度（决定列数）：随窗口/侧栏变化重算
  const [boardW, setBoardW] = useState(1200)
  useEffect(() => {
    const measure = () => { const w = boardRef.current?.clientWidth; if (w) setBoardW(w) }
    measure()
    window.addEventListener('resize', measure)
    const t = setTimeout(measure, 300)   // iframe 布局稳定后再量一次
    return () => { window.removeEventListener('resize', measure); clearTimeout(t) }
  }, [])

  const [diag, setDiag] = useState<string>('')
  const [hasMore, setHasMore] = useState(false)
  // ★ 竞态守卫：切会话时旧请求若晚到，不能覆盖新会话的数据（否则卡"加载中"/0回合）
  const reqSeqRef = useRef(0)

  /* 只取数据、不动界面 —— 给"等回复"轮询用（轮询期间不该每 1.2 秒重渲染一次） */
  const fetchMessages = async (): Promise<HistoryMessage[] | null> => {
    try {
      const r = await BRIDGE.request<{ messages: HistoryMessage[] }>('history', { sessionId }, 120000)
      return Array.isArray(r.messages) ? r.messages : null
    } catch { return null }
  }

  const load = async () => {
    const mySeq = ++reqSeqRef.current
    try {
      // 首次加载要翻全部历史（可能几十页），超时给足 120 秒
      const r = await BRIDGE.request<{ messages: HistoryMessage[]; diag?: any; hasMore?: boolean }>('history', { sessionId }, 120000)
      if (mySeq !== reqSeqRef.current) return   // 已被更新的请求取代，丢弃
      setMsgs(Array.isArray(r.messages) ? r.messages : [])
      setHasMore(r.hasMore === true)
      if (r.diag) setDiag(JSON.stringify(r.diag).slice(0, 600))
      else setDiag('')
    } catch (e) {
      if (mySeq !== reqSeqRef.current) return
      setMsgs([]); setDiag('ERR: ' + (e as Error).message)
    }
  }
  // 加载更早的历史（DSH 事件窗口是分段的，一次只给一屏）
  const loadOlder = async () => {
    const mySeq = ++reqSeqRef.current
    setOlderBusy(true)
    try {
      const r = await BRIDGE.request<{ messages: HistoryMessage[]; hasMore?: boolean }>('older', { sessionId }, 15000)
      if (mySeq !== reqSeqRef.current) return
      setMsgs(Array.isArray(r.messages) ? r.messages : [])
      setHasMore(r.hasMore === true)
    } catch { /* 失败保持现状 */ } finally { setOlderBusy(false) }
  }
  const [olderBusy, setOlderBusy] = useState(false)
  useEffect(() => {
    // 切会话时先把状态复位到"加载中"，避免看到上一个会话的残留
    setMsgs(null); setDiag(''); setHasMore(false)
    void load()
    /* eslint-disable-next-line */
  }, [sessionId])
  // 外部（App 底部浮层）发完消息后，这里刷新一次
  useEffect(() => {
    const h = () => { void load() }
    window.addEventListener('cards:refresh', h)
    return () => window.removeEventListener('cards:refresh', h)
    /* eslint-disable-next-line */
  }, [sessionId])
  // 告诉外层（App）：当前画布对应哪个会话 —— 底部浮层的发送目标
  useEffect(() => { props.onSessionChange?.(sessionId) /* eslint-disable-next-line */ }, [sessionId])

  // 布局持久化（按会话分别存）
  useEffect(() => {
    try { const raw = localStorage.getItem(LAYOUT_KEY); if (raw) { const j = JSON.parse(raw); if (j?.pos) setPos(j.pos); if (Array.isArray(j?.branches)) setBranches(j.branches) } } catch { /* ignore */ }
    /* eslint-disable-next-line */
  }, [sessionId])
  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ pos, branches })) } catch { /* ignore */ }
  }, [pos, branches, LAYOUT_KEY])

  const allTurns = msgs ? toTurns(msgs) : []
  allTurns.forEach((tn) => { tn.key = isKey(tn) })
  const turns = mode === 'key' ? allTurns.filter((tn) => tn.key) : allTurns
  // 诊断：确认筛选是否真的生效（mode / 总数 / 筛后数 / 被筛掉的系统数）
  const dbg = `mode=${mode} all=${allTurns.length} shown=${turns.length} sys=${allTurns.filter(x => x.sys).length} nokey=${allTurns.filter(x => !x.key).length}`

  // ★ 布局：列数按画布实际宽度自适应（窗口宽就多列），行优先铺开。
  //   位置只由「在 turns 数组里的索引」决定——之前把回合号 no 和索引 i 混用，
  //   「只看重点」过滤后两者错位，导致卡片乱飞、连线错乱。
  const COLS = Math.max(1, Math.min(6, Math.floor((boardW - 40) / (CW + 30)) || 2))
  const defaultPos = (i: number): Pos => ({
    x: 40 + (i % COLS) * (CW + 30),
    y: 30 + Math.floor(i / COLS) * (CH + 34),
  })
  const posOf = (_no: number, i: number): Pos => pos[String(_no)] || defaultPos(i)

  // ★ 画布真实尺寸：按所有卡片（含手动拖动过的）最大边界算，不再写死 6000×6000。
  //   写死会导致卡片超出范围时永远看不到（"内容看不全"的根因）。
  const boardSize = (() => {
    let maxX = 0, maxY = 0
    turns.forEach((tn, i) => { const q = posOf(tn.no, i); maxX = Math.max(maxX, q.x + CW); maxY = Math.max(maxY, q.y + CH) })
    branches.forEach((br) => { maxX = Math.max(maxX, br.x + 264); maxY = Math.max(maxY, br.y + 122) })
    return { w: Math.max(maxX + 60, 400), h: Math.max(maxY + 60, 300) }
  })()

  // 拖卡片 / 平移画布
  useEffect(() => {
    if (!drag && !panning) return
    const move = (e: MouseEvent) => {
      if (drag) {
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true
        const nx = Math.max(0, drag.ox + dx)
        const ny = Math.max(0, drag.oy + dy)
        if (drag.id.startsWith('b')) setBranches((bs) => bs.map((x) => x.id === drag.id ? { ...x, x: nx, y: ny } : x))
        else setPos((p) => ({ ...p, [drag.id]: { x: nx, y: ny } }))
      } else if (panning) setPan({ x: panning.ox + (e.clientX - panning.sx), y: panning.oy + (e.clientY - panning.sy) })
    }
    const up = () => {
      // 只是点了一下（没拖动）→ 打开详细栏；真拖动过 → 不打开（免得挡路线）
      if (drag && !movedRef.current && !drag.id.startsWith('b')) setSel(Number(drag.id))
      movedRef.current = false
      setDrag(null); setPanning(null)
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [drag, panning])

  // ★ 滚轮回归原生滚动（画布已可滚动）。原来这里 preventDefault + 手动平移 pan，
  //   会把原生滚动拦掉 → 表现为"滑不动"。pan 现在只由拖拽背景触发。
  const onWheel = (_e: ReactWheelEvent) => { /* 交给浏览器原生滚动 */ }

  const doSend = async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await BRIDGE.request('send', { sessionId, text })
      setInput('')
      // ★ send 只代表"已投递"，AI 还没回。先刷一次让提问立刻出现，
      //   再等到回合闭合（末尾是 assistant）后刷新，回复才会显示出来。
      await load()
      const settled = await waitForTurnSettled(fetchMessages)
      if (settled) {
        setMsgs(settled)
      } else {
        await load()
      }
    } catch { /* 发送失败：保持输入不丢，让用户重试 */ } finally { setSending(false) }
  }

  // 顺序连线：回合 i → i+1
  // ★ 分支卡 = 把输入的内容发进当前会话（与底部输入框同一条通道）。
  //   注意不要在这里调用 fork：fork 会新建会话，而用户期望的是"在当前会话接着说"。
  const sendBranch = async (id: string) => {
    const br = branches.find((x) => x.id === id)
    if (!br || !br.text.trim() || br.busy) return
    setBranches((bs) => bs.map((x) => x.id === id ? { ...x, busy: true } : x))
    try {
      await BRIDGE.request('send', { sessionId, text: br.text.trim() })
      // 发出去后这张草稿卡就完成使命了：移除它，回合会出现在画布上
      setBranches((bs) => bs.filter((x) => x.id !== id))
      await load()
      // ★ 同 doSend：等 AI 真正答完再刷新，否则新卡片上只有问、没有答
      const settled = await waitForTurnSettled(fetchMessages)
      if (settled) setMsgs(settled)
    } catch {
      // 发送失败：保留卡片和已输入文字，让用户重试（不丢内容）
      setBranches((bs) => bs.map((x) => x.id === id ? { ...x, busy: false } : x))
    }
  }

  const linkD = (a: Pos, b: Pos) => {
    const sx = a.x + CW, sy = a.y + CH / 2, ex = b.x, ey = b.y + CH / 2
    const dx = Math.min(Math.max(50, Math.abs(ex - sx) * 0.4), 180)
    return `M${sx} ${sy} C${sx + dx} ${sy}, ${ex - dx} ${ey}, ${ex} ${ey}`
  }

  const selTurn = sel != null ? turns.find((x) => x.no === sel) : null

  // 告诉外层（App）：详细栏是否打开 —— 打开时底部控制条才缩起来
  useEffect(() => { props.onDetailOpen?.(!!selTurn) /* eslint-disable-next-line */ }, [!!selTurn])

  return (
    <div className="cw">
      <header className="cw-bar">
        <button className="cw-btn" onClick={onBack}>← {t.back}</button>
        <div className="cw-brand">
          <h2>{title || sessionId}</h2>
          <small>{mode === 'key' ? `${t.kept} ${turns.length} / ${t.total} ${allTurns.length} ${t.turnCount}` : `${t.total} ${allTurns.length} ${t.turnCount}`}</small>
          <small style={{ opacity: .55, fontSize: 10 }}>{dbg}</small>
        </div>
        <span className="cw-spacer" />
        <div className="cw-seg">
          <button className={'cw-segbtn' + (mode === 'key' ? ' on' : '')} onClick={() => setMode('key')}>{t.modeKey}</button>
          <button className={'cw-segbtn' + (mode === 'all' ? ' on' : '')} onClick={() => setMode('all')}>{t.modeAll}</button>
        </div>
        <button className="cw-btn" onClick={() => { setPos({}); setPan({ x: 0, y: 0 }) }}>{t.reset}</button>
      </header>

      <div className="cw-body">
        <div
          className={'cw-board' + (panning ? ' panning' : '')}
          ref={boardRef}
          onMouseDown={(e) => {
            const el = e.target as HTMLElement
            if (el === boardRef.current || el.classList.contains('cw-board-inner')) setPanning({ sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y })
          }}
          onWheel={onWheel}
        >
          <div className="cw-board-inner" style={{ width: boardSize.w, height: boardSize.h, transform: `translate(${pan.x}px, ${pan.y}px)` }}>
            {!msgs ? (
              <div className="cw-hint">{t.loading}</div>
            ) : turns.length === 0 ? (
              <div className="cw-hint big" style={{ position: 'absolute', left: 30, top: 30 }}>
                {mode === 'key' ? t.noKeyTurns : t.canvasEmpty}
                {diag && <pre style={{ marginTop: 12, fontSize: 10, opacity: .7, whiteSpace: 'pre-wrap', maxWidth: 900 }}>{diag}</pre>}
              </div>
            ) : (
              <>
                <svg className="cw-links" width={boardSize.w} height={boardSize.h} aria-hidden="true">
                  {turns.slice(1).map((tn, i) => (
                    <path key={tn.no} className="cw-link" d={linkD(posOf(turns[i].no, i), posOf(tn.no, i + 1))} />
                  ))}
                  {branches.map((br) => {
                    const fi = turns.findIndex((x) => x.no === br.from)
                    if (fi < 0) return null
                    const a = posOf(br.from, fi)
                    const sx = a.x + CW, sy = a.y + CH / 2, ex = br.x, ey = br.y + 60
                    const dx = Math.min(Math.max(50, Math.abs(ex - sx) * 0.4), 180)
                    return <path key={br.id} className="cw-link branch" d={`M${sx} ${sy} C${sx + dx} ${sy}, ${ex - dx} ${ey}, ${ex} ${ey}`} />
                  })}
                </svg>
                {turns.map((tn, i) => {
                  const q = posOf(tn.no, i)
                  return (
                    <div
                      key={tn.no}
                      className={'cw-card cw-turn' + (sel === tn.no ? ' on' : '')}
                      style={{ position: 'absolute', left: q.x, top: q.y, width: CW, height: CH }}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        movedRef.current = false
                        setDrag({ id: String(tn.no), sx: e.clientX, sy: e.clientY, ox: q.x, oy: q.y })
                      }}
                      title={oneLine(tn.user).slice(0, 240)}
                    >
                      <div className="cw-turn-h">
                        <span className="cw-turn-no">{t.turn} {tn.no}</span>
                        {tn.sys ? <span className="cw-turn-tag sys">{t.sysMsg}</span> : (!tn.key && <span className="cw-turn-tag">{t.chitchat}</span>)}
                        <span className="cw-spacer" />
                        <button
                          className="cw-branch-btn"
                          title={t.branchHint}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            const id = 'b' + Date.now().toString(36)
                            setBranches((bs) => [...bs, { id, from: tn.no, x: q.x + 300, y: q.y + 110, text: '' }])
                          }}
                        >⑂</button>
                      </div>
                      <div className="cw-turn-q">{clip(oneLine(tn.user) || '—', 62)}</div>
                      <div className="cw-turn-a">{clip(oneLine(tn.ai) || '…', 92)}</div>
                    </div>
                  )
                })}
                {/* 分支卡：从某一回合延续出去的追问输入框 */}
                {branches.map((br) => (
                  <div
                    key={br.id}
                    className={'cw-card cw-branch' + (br.busy ? ' busy' : '')}
                    style={{ position: 'absolute', left: br.x, top: br.y, width: 264, height: 122 }}
                    onMouseDown={(e) => { e.stopPropagation(); setDrag({ id: br.id, sx: e.clientX, sy: e.clientY, ox: br.x, oy: br.y }) }}
                  >
                    <div className="cw-turn-h">
                      <span className="cw-turn-no branch">⑂ {t.branch} · {t.turn} {br.from}</span>
                      <span className="cw-spacer" />
                      <button
                        className="cw-detail-x"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setBranches((bs) => bs.filter((x) => x.id !== br.id)) }}
                      >×</button>
                    </div>
                    {br.busy ? (
                      <div className="cw-branch-done">
                        <span>{t.sending}</span>
                      </div>
                    ) : (
                      <input
                        className="cw-branch-input"
                        value={br.text}
                        placeholder={t.branchPh}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => setBranches((bs) => bs.map((x) => x.id === br.id ? { ...x, text: e.target.value } : x))}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void sendBranch(br.id) } }}
                      />
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {selTurn && (
        <aside className="cw-detail">
            <header className="cw-detail-h">
              <b>{t.turn} {selTurn.no}</b>
              <span className="cw-spacer" />
              <button className="cw-detail-x" onClick={() => setSel(null)} title={t.close}>×</button>
            </header>
            <div className="cw-detail-body">
              {selTurn.user && (
                <div className="cw-msg user"><span className="cw-role">{t.you}</span><div className="cw-text">{selTurn.user}</div></div>
              )}
              {selTurn.ai && (
                <div className="cw-msg assistant"><span className="cw-role">{t.ai}</span><div className="cw-text">{selTurn.ai}</div></div>
              )}
            </div>
        </aside>
        )}
      </div>
    </div>
  )
}

/* ══ 会话列表：每张卡是一个会话 ══ */
// 会话清单模块级缓存：从画布返回 / 从聊天页切回来时秒开（后台再刷新）
let SESSIONS_CACHE: HibSession[] | null = null

/* ★ 缓存失效：DSH 侧删掉会话后，缓存里仍留着那条记录 → 列表继续显示已删会话
   （"删了还显示"的老毛病）。这里主动清掉，让下次进入列表重新拉取。 */
function invalidateSessionsCache() { SESSIONS_CACHE = null }

function SessionList(props: { lang: Lang; onEnter: (id: string, title: string) => void }): JSX.Element {
  const { lang, onEnter } = props
  const t = T[lang]
  const [sessions, setSessions] = useState<HibSession[] | null>(SESSIONS_CACHE)
  const [err, setErr] = useState('')
  const [tick, setTick] = useState(0)
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(50)
  const [sortBy, setSortBy] = useState<'recent' | 'old'>('recent')

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await BRIDGE.request<{ sessions: HibSession[] }>('sessions')
        if (!alive) return
        const list = Array.isArray(r.sessions) ? r.sessions : []
        SESSIONS_CACHE = list
        setSessions(list)
        setErr('')
      } catch { if (alive && !SESSIONS_CACHE) setErr(t.noBridge) }
    }
    void load()
    return () => { alive = false }
  }, [tick])

  /* ★ 与画布同步：client.js 在会话变化时推 cards:refresh。
     以前只有画布监听，列表要靠手动点 ⟳ —— 在画布里发消息/建会话后，
     列表看起来"没更新"。现在列表也跟着刷。 */
  useEffect(() => {
    const h = () => { invalidateSessionsCache(); setTick((x) => x + 1) }
    window.addEventListener('cards:refresh', h)
    return () => window.removeEventListener('cards:refresh', h)
  }, [])

  const ql = q.trim().toLowerCase()
  const all = sessions || []
  const filtered = ql ? all.filter((s) => (s.title || '').toLowerCase().includes(ql)) : all
  const sorted = sortBy === 'old' ? [...filtered].reverse() : filtered
  const shown = sorted.slice(0, limit)
  const hasMore = sorted.length > shown.length

  return (
    <div className="cw">
      <header className="cw-bar">
        <div className="cw-brand"><h2>{t.title}</h2><small>{t.sub}</small></div>
        <input className="cw-search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(50) }} placeholder={t.search} />
        <div className="cw-seg">
          <button className={'cw-segbtn' + (sortBy === 'recent' ? ' on' : '')} onClick={() => setSortBy('recent')}>{t.sortNew}</button>
          <button className={'cw-segbtn' + (sortBy === 'old' ? ' on' : '')} onClick={() => setSortBy('old')}>{t.sortOld}</button>
        </div>
        <button className="cw-btn" onClick={() => setTick((x) => x + 1)}>⟳ {t.refresh}</button>
        {hasMore && (
          <button className="cw-btn on" onClick={() => setLimit(sorted.length)}>{t.loadAll}</button>
        )}
        <span className="cw-spacer" />
        {sessions && <span className="cw-meta">{t.showing} {shown.length} / {sorted.length}</span>}
      </header>

      {err && <div className="cw-err"><span>{err}</span><button onClick={() => setErr('')}>×</button></div>}

      <div className="cw-canvas">
        {!sessions ? (
          <div className="cw-hint">{t.loading}</div>
        ) : sessions.length === 0 ? (
          <div className="cw-empty">
            <div className="cw-empty-h">{t.emptyH}</div>
            <div className="cw-empty-p">{t.emptyP}</div>
          </div>
        ) : shown.length === 0 ? (
          <div className="cw-hint big">{t.noMatch}</div>
        ) : (
          shown.map((s) => (
            <div key={s.id} className="cw-card" onClick={() => onEnter(s.id, s.title)} title={s.workspace || s.id}>
              <div className="cw-card-body">
                <b className="cw-card-title">{s.title || t.untitled}</b>
                <span className="cw-card-when">{fmtWhen(s.lastActive, lang)}</span>
              </div>
              <div className="cw-card-foot">
                <button className="cw-mini" onClick={(e) => { e.stopPropagation(); onEnter(s.id, s.title) }}>{t.detail}</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/* ══ 外层：列表 ↔ 画布 ══ */
export default function CardWorkbench(props: {
  lang?: Lang
  onSwitchChat?: () => void
  mapInput?: string
  setMapInput?: (s: string) => void
  mapSkills?: string[]
  mapToolsets?: string[]
  mapReasoning?: string
  mapPermission?: string
  onDetailOpen?: (open: boolean) => void
  onSessionChange?: (sid: string) => void
}): JSX.Element {
  const lang: Lang = props.lang === 'en' ? 'en' : 'zh'
  const [canvasId, setCanvasId] = useState('')
  const [canvasTitle, setCanvasTitle] = useState('')

  if (canvasId) {
    return (
      <ConvCanvas
        lang={lang}
        sessionId={canvasId}
        title={canvasTitle}
        onBack={() => { setCanvasId(''); setCanvasTitle(''); props.onSessionChange?.('') }}
        input={props.mapInput ?? ''}
        setInput={props.setMapInput}
        skills={props.mapSkills}
        toolsets={props.mapToolsets}
        reasoning={props.mapReasoning}
        permission={props.mapPermission}
        onDetailOpen={props.onDetailOpen}
        onSessionChange={props.onSessionChange}
      />
    )
  }
  return <SessionList lang={lang} onEnter={(id, title) => { setCanvasId(id); setCanvasTitle(title) }} />
}

// ── iframe 内自渲染（bundle 模式：React 打进本文件，不依赖外部 CDN/CSP）──
if (typeof document !== 'undefined' && document.getElementById('root')) {
  createRoot(document.getElementById('root')).render(<CardWorkbench />)
}
