// dsh-cards-workbench「脉络图」前端（DSH 侧栏 tab 模式）
// - ctx.slots.inject("sidebar.panellist") → 侧栏顶部第三个图标（跟对话/轨迹/schedule 并列）
// - ctx.slots.inject("main")              → 选中时主区显示脉络图页面
// - 页面内用 iframe 挂 /cards/，通过 postMessage 桥到 ctx.sessions API
// 参考：dsh-client-ui-schedule 的 PANEL_ID + main + panellist 双注册模式
window.__ModuleLoader__.load({
  id: 'dsh-cards-workbench',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')

    const PANEL_ID = 'cards-workbench'
    const SOURCE = 'cards-workbench'

    // DSH 事件流 → 脉络图的 {role, text}（照 synapse app.js messagesFromEvents）
    const messagesFromEvents = (events) => {
      if (!Array.isArray(events)) return []
      return events.flatMap(e => {
        const content = e?.data?.message?.content ?? e?.data?.content
        const text = Array.isArray(content)
          ? content.filter(b => b?.type === 'text').map(b => b.text).filter(Boolean).join('\n')
          : ''
        if (e?.type === 'user/message' && text) return [{ role: 'user', text }]
        if (e?.type === 'assistant/message' && text) return [{ role: 'assistant', text }]
        return []
      })
    }

    module.exports.inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'uiConversation']
    module.exports.apply = (ctx) => {
      // ── 桥：iframe(脉络图) ↔ DSH ctx API ──
      const listSessions = () => {
        const snap = ctx.sessions.list.getSnapshot()
        // 兼容多种快照形状：ids+byId（synapse 用法）或 items 数组
        const rows = Array.isArray(snap?.items)
          ? snap.items
          : (snap?.ids ?? []).map(id => snap.byId?.[id]).filter(Boolean)
        return rows.map(s => ({
          id: s.id,
          title: s.displayTitle ?? s.title ?? '(无标题)',
          lastActive: s.lastActive ?? s.updatedAt ?? null,
          workspace: s.cwd ?? null,
        }))
      }

      // 从一条 entry 取 {role,text}（entry 里是 event，event.data.message.content 或 event.data.content）
      const entryToMsg = (entry) => {
        if (!entry) return null
        const ev = entry.event ?? entry
        const type = ev?.type ?? entry?.type
        const content = ev?.data?.message?.content ?? ev?.data?.content ?? ev?.message?.content ?? ev?.content
        let text = ''
        if (Array.isArray(content)) text = content.filter(b => b?.type === 'text').map(b => b.text).filter(Boolean).join('\n')
        else if (typeof content === 'string') text = content
        if (!text) return null
        if (type === 'user/message') return { role: 'user', text }
        if (type === 'assistant/message') return { role: 'assistant', text }
        return null
      }

      // 带超时的 await（切会话时 retain().ready 可能永不 resolve，不能无限等）
      const withTimeout = (p, ms, tag) => Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + tag)), ms)),
      ])

      // ★ 会话引用缓存：retain 后【不立即 release】，保持会话激活（后台读历史的前提）。
      //   否则未激活的冷会话读不到窗口；而 release 后 DSH 会回收，下次又要重来。
      //   只保留最近若干个，多了自动释放，避免占资源。
      const heldRefs = new Map()   // sessionId -> reference
      const MAX_HELD = 6
      const holdSession = async (sessionId) => {
        if (heldRefs.has(sessionId)) return heldRefs.get(sessionId)
        const ref = ctx.sessions.retain(sessionId, { source: SOURCE })
        // 大会话首次激活可能要一会儿，给足时间（这是"打开卡片"动作，慢一点可接受）
        await withTimeout(ref.ready, 20000, 'ready')
        heldRefs.set(sessionId, ref)
        // 超量释放最旧的（Map 保持插入序）
        while (heldRefs.size > MAX_HELD) {
          const [oldId, oldRef] = heldRefs.entries().next().value
          if (oldId === sessionId) break
          heldRefs.delete(oldId)
          try { oldRef.release?.() } catch { /* ignore */ }
        }
        return ref
      }

      // ★ 把该会话的历史窗口「加载到底」：DSH 默认只装最近约 50 条消息
      //   （session.d.ts: loadOlder 每次≥50条/≤500条，hasMore 表示还有更早）。
      //   反复调 loadOlder 直到 hasMore=false，这样画布能拿到全部回合。
      //   上限做保护，避免超长会话把主线程拖死。
      const loadedAll = new Set()   // 已加载到底的会话，避免重复翻
      const loadAllHistory = async (sess, sessionId, maxPages = 40) => {
        if (!sess || loadedAll.has(sessionId)) return
        try {
          for (let i = 0; i < maxPages; i++) {
            const win = (sess.eventSource ?? sess.events)?.getSnapshot?.()
            if (!win || win.hasMore !== true) { loadedAll.add(sessionId); break }
            await withTimeout(sess.loadOlder?.(), 12000, 'loadOlder#' + i)
          }
        } catch { /* 翻页失败就用已有部分 */ }
      }

      const readHistory = async (sessionId) => {
        let lastDiag = null
        // ① 先看已激活的 binding（当前会话走这条，最快）
        try {
          const b0 = ctx.sessions.binding(sessionId)
          const s0 = b0?.session
          if (s0) {
            await loadAllHistory(s0, sessionId)
            const e0 = (s0.eventSource ?? s0.events)?.getSnapshot?.()?.entries
            if (Array.isArray(e0) && e0.length) {
              const out0 = e0.map(entryToMsg).filter(Boolean)
              if (out0.length) return out0
            }
          }
        } catch { /* next */ }
        // ② 后台激活（retain 并持有）→ 读 eventSource 窗口
        try {
          const ref = await holdSession(sessionId)
          const binding = ref.binding ?? ctx.sessions.binding(sessionId)
          const sess = binding?.session
          await loadAllHistory(sess, sessionId)
          const src = sess?.eventSource ?? sess?.events
          const win = src?.getSnapshot?.()
          const entries = win?.entries
          if (Array.isArray(entries) && entries.length) {
            const out = entries.map(entryToMsg).filter(Boolean)
            if (out.length) return out
            lastDiag = { __diag: true, where: 'held/eventSource', count: entries.length, hasMore: win?.hasMore, sample: entries.slice(0, 2) }
          } else {
            lastDiag = { __diag: true, where: 'held/eventSource', hasSess: !!sess, hasSrc: !!src, win: win ? Object.keys(win) : null, entryCount: entries?.length ?? null }
          }
        } catch (e) { lastDiag = { __diag: true, where: 'hold threw', err: String(e && e.message || e) } }
        // ② 不 retain，直接读已激活的 binding（会话正在聊天时它一定在）
        try {
          const binding = ctx.sessions.binding(sessionId)
          const sess = binding?.session
          const win = (sess?.eventSource ?? sess?.events)?.getSnapshot?.()
          const entries = win?.entries
          if (Array.isArray(entries) && entries.length) {
            const out = entries.map(entryToMsg).filter(Boolean)
            if (out.length) return out
            return { __diag: true, where: 'direct/eventSource', count: entries.length, sample: entries.slice(0, 2) }
          }
        } catch (e) { /* next */ }
        // ③ 兜底：uiConversation 的 chat 视图节点
        try {
          const binding = ctx.uiConversation.binding(sessionId)
          const chat = binding && binding.target('chat')
          const snap = chat?.getSnapshot?.()
          const raw = snap?.nodes instanceof Map ? [...snap.nodes.values()] : (Array.isArray(snap?.nodes) ? snap.nodes : [])
          const out = raw.map(entryToMsg).filter(Boolean)
          if (out.length) return out
          if (raw.length) return { __diag: true, where: 'chat-nodes', count: raw.length, sample: raw.slice(0, 2) }
        } catch (e) { /* next */ }
        return lastDiag ?? { __diag: true, where: 'all-empty' }
      }

      const sendMessage = async (sessionId, text) => {
        let reference
        try {
          reference = ctx.sessions.retain(sessionId, { source: SOURCE })
          await reference.ready
        } catch { reference?.release(); throw new Error('会话不可用') }
        try {
          const result = await reference.binding.session.prompt([{ type: 'text', text }], 'queue')
          if (!result.ok) throw new Error(result.error?.message ?? 'DSH 未接受消息')
        } finally { reference.release() }
      }

      const forkSession = async (sessionId, atSeq) => {
        const id = await ctx.sessions.fork({
          sessionId,
          atSeq: Number.isInteger(atSeq) ? atSeq : undefined,
          increaseTitle: true,
        })
        const snap = ctx.sessions.list.getSnapshot()
        return { id, title: snap.byId?.[id]?.displayTitle ?? 'DSH 分支' }
      }

      // 加载更早的历史（DSH 窗口分段，hasMore 时调 session.loadOlder()）
      const loadOlder = async (sessionId) => {
        try {
          // 用同一个 held 引用（已激活的会话），避免重新 retain
          const ref = await holdSession(sessionId)
          const sess = (ref.binding ?? ctx.sessions.binding(sessionId))?.session
          await withTimeout(sess?.loadOlder?.(), 15000, 'loadOlder')
          const win = (sess?.eventSource ?? sess?.events)?.getSnapshot?.()
          const entries = win?.entries
          return {
            messages: Array.isArray(entries) ? entries.map(entryToMsg).filter(Boolean) : [],
            hasMore: win?.hasMore === true,
          }
        } catch (e) { return { messages: [], hasMore: false, error: String(e && e.message || e) } }
      }

      // 读窗口（同时带回 hasMore，让 UI 知道还能不能加载更早）
      const readHistoryWithMore = async (sessionId) => {
        const r = await readHistory(sessionId)
        let hasMore = false
        try {
          const b = ctx.sessions.binding(sessionId)
          hasMore = (b?.session?.eventSource ?? b?.session?.events)?.getSnapshot?.()?.hasMore === true
        } catch { /* ignore */ }
        if (Array.isArray(r)) return { messages: r, hasMore }
        return { messages: [], hasMore, ...r }
      }

      // ── 主区页面：iframe 挂 /cards/ ──
      const CardsPage = () => {
        const frameRef = React.useRef(null)
        const respond = React.useCallback((win, reqId, ok, payload) => {
          win?.postMessage({ source: 'dsh-cards', type: ok ? 'response' : 'error', reqId, ...payload }, location.origin)
        }, [])

        React.useEffect(() => {
          const onMessage = (event) => {
            if (event.origin !== location.origin || event.data?.source !== 'dsh-cards') return
            if (event.data.type !== 'request') return
            const { reqId, op, payload } = event.data
            const win = frameRef.current?.contentWindow
            if (op === 'sessions') { respond(win, reqId, true, { sessions: listSessions() }); return }
            if (op === 'history') { readHistoryWithMore(payload.sessionId).then(r => respond(win, reqId, true, r)).catch(e => respond(win, reqId, false, { error: e.message })); return }
            if (op === 'older') { loadOlder(payload.sessionId).then(r => respond(win, reqId, true, r)).catch(e => respond(win, reqId, false, { error: e.message })); return }
            if (op === 'send') { sendMessage(payload.sessionId, payload.text).then(() => respond(win, reqId, true, {})).catch(e => respond(win, reqId, false, { error: e.message })); return }
            if (op === 'fork') { forkSession(payload.sessionId, payload.atSeq).then(r => respond(win, reqId, true, { session: r })).catch(e => respond(win, reqId, false, { error: e.message })); return }
          }
          window.addEventListener('message', onMessage)
          return () => window.removeEventListener('message', onMessage)
        }, [respond])

        // 会话变化 → 推 refresh 给 iframe
        React.useEffect(() => {
          const push = () => {
            const win = frameRef.current?.contentWindow
            const dark = document.body?.hasAttribute?.('data-ds-dark-theme') === true
            win?.postMessage({ source: 'dsh-cards', type: 'theme', dark }, location.origin)
            win?.postMessage({ source: 'dsh-cards', type: 'refresh' }, location.origin)
          }
          const un = ctx.sessions.list.subscribe(push)
          const obs = typeof MutationObserver === 'undefined' ? null : new MutationObserver(push)
          if (obs && document.body) obs.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
          return () => { un(); obs?.disconnect() }
        }, [])

        // ★ 照抄轨迹的做法：外层 div 带 data-conversation-composer-overlay 标记，
        //   并声明 bottom-clearance 变量。DSH 的 shell 据此把它当「覆盖 composer 的视图」处理，
        //   那条拖拽调高度的分隔线就不会露出来（轨迹依赖的正是这个机制）。
        return React.createElement('div', {
          className: 'dsh-cards-view',
          'data-conversation-composer-overlay': '',
          style: {
            // 与轨迹一致：给底部 composer 留出空间（高度由 DSH 的 --dsh-composer-height 提供）
            '--dsh-cards-bottom-clearance': 'calc(var(--dsh-composer-height, 152px) + 16px)',
            paddingBottom: 'var(--dsh-cards-bottom-clearance)',
            boxSizing: 'border-box',
            width: '100%',
            height: '100%',
            minHeight: 0,
            display: 'flex',
            overflow: 'hidden',
          },
        }, React.createElement('iframe', {
          ref: frameRef,
          src: '/cards/',
          title: '脉络图',
          style: { display: 'block', width: '100%', height: '100%', border: 0, flex: 1, minHeight: 0 },
          onLoad: () => {
            const win = frameRef.current?.contentWindow
            const dark = document.body?.hasAttribute?.('data-ds-dark-theme') === true
            win?.postMessage({ source: 'dsh-cards', type: 'theme', dark }, location.origin)
            win?.postMessage({ source: 'dsh-cards', type: 'refresh' }, location.origin)
          },
        }))
      }

      // ── 侧栏 tab 图标（脉络图）──
      const CardsIcon = (props) => React.createElement('svg', {
        width: props?.size ?? 16,
        height: props?.size ?? 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, [
        React.createElement('circle', { key: 'a', cx: 3.5, cy: 4, r: 1.8 }),
        React.createElement('circle', { key: 'b', cx: 12.5, cy: 8, r: 1.8 }),
        React.createElement('circle', { key: 'c', cx: 3.5, cy: 12, r: 1.8 }),
        React.createElement('path', { key: 'd', d: 'M5.3 4.6 L10.7 7.3' }),
        React.createElement('path', { key: 'e', d: 'M5.3 11.4 L10.7 8.7' }),
      ])

      // 说明：那条「拖拽调高度」分隔线不靠 CSS 隐藏——照抄轨迹用
      // data-conversation-composer-overlay 让 DSH 按「覆盖式视图」处理（见 CardsPage）。

      // ── 注册成"对话 | 轨迹 | 脉络图"的第三个 tab ──
      // conversation.view = 主区顶部那排视图 tab（chat=order0 / trajectory=order10）
      // 脉络图 order 20 → 排在轨迹后面（照抄 dsh-client-ui-chat L12303 的注册模式）
      ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: PANEL_ID,
        order: 20,
        label: () => '脉络图',
      }, CardsPage)), 'cards-workbench: conversation view tab')
    }
    return module.exports
  },
})
