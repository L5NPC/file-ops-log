/**
 * Client half of the file-operation log: a sidebar panel entry and the page it
 * opens. Reads the Host's authenticated JSON route; filters by operation type
 * and sorts by time locally.
 */
window.__ModuleLoader__.load({
  id: 'file-ops-log',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'file-ops-log'
    const PANEL_ID = 'file-ops-log'
    const API_ROUTE = 'api/file-ops.log'
    const POLL_MS = 8000
    const KINDS = ['create', 'modify', 'delete', 'move', 'copy', 'read', 'other']

    const EN = {
      panelLabel: 'File operations',
      pageTitle: 'File operation log',
      pageSubtitle: 'File operations recorded from Harness agents, newest first.',
      refresh: 'Refresh',
      refreshing: 'Refreshing',
      searchPlaceholder: 'Search paths, commands, tools, conversations',
      sortNewest: 'Newest first',
      sortOldest: 'Oldest first',
      filterLabel: 'Filter by operation type',
      filterAll: 'All',
      today: 'Today',
      yesterday: 'Yesterday',
      loading: 'Loading the operation log…',
      loadError: 'The operation log could not be loaded.',
      retry: 'Try again',
      failed: 'Failed',
      unknown: 'Outcome unknown',
      session: 'Session',
      openSession: 'Open conversation',
      sessionUnavailable: 'This conversation is not in the current list',
      parentConversation: 'parent conversation',
      subagent: 'Subagent',
      noPaths: 'No path captured',
      autoRefresh: 'Updates every 8 seconds.',
      showing: 'Showing {shown} of {total}',
      updatedAt: 'Updated {time}',
      staleNotice: 'Could not refresh; showing the last update.',
      windowNotice: 'Newest 2000 records are kept here; older records remain in the log file.',
      groupedHint: 'Several operations from one tool call; the outcome applies to the whole call.',
      emptyTitle: 'No file operations recorded yet',
      emptyHint: 'Operations appear here while agents create, edit, move, delete, or read files.',
      emptyFiltered: 'No operations match these filters',
      emptyFilteredHint: 'Change the operation type or search text, or refresh the log.',
      clearFilters: 'Clear filters',
      'kind.create': 'Create',
      'kind.modify': 'Modify',
      'kind.delete': 'Delete',
      'kind.move': 'Move',
      'kind.copy': 'Copy',
      'kind.read': 'Read',
      'kind.other': 'Other',
    }

    const ZH = {
      panelLabel: '文件操作',
      pageTitle: '文件操作日志',
      pageSubtitle: '记录 Harness 智能体的文件操作，按时间倒序排列。',
      refresh: '刷新',
      refreshing: '刷新中',
      searchPlaceholder: '搜索路径、命令、工具或对话',
      sortNewest: '最新优先',
      sortOldest: '最早优先',
      filterLabel: '按操作类型筛选',
      filterAll: '全部',
      today: '今天',
      yesterday: '昨天',
      loading: '正在加载操作日志…',
      loadError: '无法加载操作日志。',
      retry: '重试',
      failed: '失败',
      unknown: '结果未知',
      session: '会话',
      openSession: '打开会话',
      sessionUnavailable: '当前会话列表中找不到该对话',
      parentConversation: '上级对话',
      subagent: '子代理',
      noPaths: '未捕获路径',
      autoRefresh: '每 8 秒自动更新。',
      showing: '显示 {shown} / {total} 条',
      updatedAt: '更新于 {time}',
      staleNotice: '刷新失败，当前显示的是上次更新的数据。',
      windowNotice: '这里保留最新的 2000 条记录，更早的记录仍在日志文件中。',
      groupedHint: '同一次工具调用包含多个操作，结果状态对应整个调用。',
      emptyTitle: '还没有文件操作记录',
      emptyHint: '当智能体创建、修改、移动、删除或读取文件时，记录会出现在这里。',
      emptyFiltered: '没有符合筛选条件的操作',
      emptyFilteredHint: '请调整操作类型或搜索内容，或刷新日志。',
      clearFilters: '清除筛选',
      'kind.create': '创建',
      'kind.modify': '修改',
      'kind.delete': '删除',
      'kind.move': '移动',
      'kind.copy': '复制',
      'kind.read': '读取',
      'kind.other': '其他',
    }

    const FORMATTERS = new Map()

    /* The locale service maintains <html lang>, so formatters follow the UI language. */
    function activeLocale() {
      const language = typeof document === 'undefined' ? '' : document.documentElement.lang
      return language === '' ? undefined : language
    }

    function formatters() {
      const locale = activeLocale()
      const key = locale ?? ''
      const cached = FORMATTERS.get(key)
      if (cached !== undefined) return cached
      const value = {
        time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        day: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' }),
      }
      FORMATTERS.set(key, value)
      return value
    }

    /* Styles are component-local: unmounting the panel removes them. */
    const CSS = `
.fol-page{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}
.fol-page :focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.fol-search input:focus-visible{outline:none}
.fol-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.fol-content{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.fol-heading{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px;padding-top:28px;margin-bottom:18px}
[data-platform='darwin'] .fol-heading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.fol-heading h1{flex:0 1 auto;min-width:0;max-width:100%;margin:0;font-size:20px;line-height:28px;font-weight:500}
.fol-subtitle{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.fol-actions{display:flex;flex:none;align-items:center;gap:8px;white-space:nowrap}
.fol-refresh{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:16px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;transition:background .15s}
@media (hover:hover){.fol-refresh:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.fol-refresh:disabled{opacity:.55;cursor:default}
.fol-refresh svg{width:14px;height:14px;flex:none}
.fol-chips{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-bottom:4px}
.fol-chip{display:inline-flex;flex:none;align-items:center;gap:6px;height:28px;padding:0 10px;border:0;border-radius:14px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:14px;line-height:22px;white-space:nowrap;cursor:pointer}
@media (hover:hover){.fol-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.fol-chip[aria-pressed='true']{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.fol-chip-count{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
.fol-chip[aria-pressed='true'] .fol-chip-count{color:var(--dsw-alias-label-secondary)}
.fol-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0 0}
.fol-search{display:flex;flex:1 1 220px;min-width:170px;align-items:center;gap:8px;height:36px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:12px;color:var(--dsw-alias-label-tertiary);transition:border-color .15s}
@media (hover:hover){.fol-search:hover{border-color:var(--dsw-alias-border-l2)}}
.fol-search:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.fol-search svg{width:14px;height:14px;flex:none}
.fol-search input{flex:1;min-width:0;height:100%;padding:0;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px}
.fol-search input::placeholder{color:var(--dsw-alias-label-caption)}
.fol-sort{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:0;border-radius:16px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer}
.fol-sort svg{width:13px;height:13px;flex:none}
.fol-stats{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;margin:18px 0 2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.fol-day{margin-top:16px}
.fol-day-title{margin:0 0 6px;font-size:12px;line-height:18px;font-weight:500;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary)}
.fol-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.fol-row{display:grid;grid-template-columns:66px minmax(0,1fr);gap:12px;padding:10px 12px;border-radius:12px}
@media (hover:hover){.fol-row:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.fol-time{padding-top:1px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.fol-main{display:flex;flex-direction:column;gap:2px;min-width:0}
.fol-line{display:flex;align-items:center;gap:8px;min-width:0}
.fol-badge{display:inline-flex;flex:none;align-items:center;height:20px;padding:0 7px;border-radius:10px;font-size:11px;line-height:20px;font-weight:500}
.fol-badge-create{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}
.fol-badge-modify{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}
.fol-badge-delete{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent)}
.fol-badge-move{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent)}
.fol-badge-copy{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
.fol-badge-read{color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 12%,transparent)}
.fol-badge-other{color:var(--dsw-alias-label-tertiary);background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 12%,transparent)}
.fol-path{display:flex;flex:1 1 auto;align-items:baseline;min-width:0;overflow:hidden;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:20px}
.fol-dir{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px}
.fol-base{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.fol-more{flex:none;font-family:inherit;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.fol-status-failed{flex:none;font-size:11px;line-height:20px;color:var(--dsw-alias-state-error-primary)}
.fol-status-unknown{flex:none;font-size:11px;line-height:20px;color:var(--dsw-alias-state-warn-primary)}
.fol-frag{flex:none;padding:0 5px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:8px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
.fol-sep{color:var(--dsw-alias-label-caption)}
.fol-window-note{flex-basis:100%;color:var(--dsw-alias-label-caption)}
.fol-detail{margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.fol-meta{margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.fol-session{display:inline-flex;align-items:center;gap:4px;max-width:320px;min-width:0;padding:0;border:0;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;vertical-align:bottom}
@media (hover:hover){.fol-session:not(:disabled):hover{color:var(--dsw-alias-state-business-primary);text-decoration:underline}}
.fol-session:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.fol-session-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fol-session svg{width:11px;height:11px;flex:none}
.fol-session-prefix{flex:none;font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.fol-session-tag{flex:none;padding:0 4px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:6px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary)}
.fol-row-error{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);word-break:break-word}
.fol-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:64px 24px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.fol-empty svg{width:40px;height:40px;margin-bottom:8px;color:var(--dsw-alias-label-tertiary)}
.fol-empty-title{margin:0;font-size:14px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary)}
.fol-empty-hint{max-width:420px;margin:0;font-size:13px;line-height:20px}
.fol-empty button{margin-top:10px;height:32px;padding:0 14px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:16px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
@media (hover:hover){.fol-empty button:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.fol-status{padding:48px 0;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.fol-inline-error{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.fol-inline-error button{height:24px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.fol-load-error{display:flex;flex-direction:column;align-items:flex-start;gap:10px;margin-top:24px;padding:16px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:12px;font-size:13px;color:var(--dsw-alias-state-error-primary)}
.fol-load-error span{color:var(--dsw-alias-label-secondary);font-size:12px}
.fol-load-error button{height:32px;padding:0 14px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:16px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
@media (max-width:640px){
.fol-content{padding-inline:20px}
.fol-row{grid-template-columns:54px minmax(0,1fr);gap:10px;padding-inline:8px}
}
`

    function Icon({ size = 16 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': true, style: { display: 'block' },
      },
      h('rect', {
        x: 4.25, y: 3.25, width: 15.5, height: 17.5, rx: 3.25,
        stroke: 'currentColor', strokeWidth: 1.5,
      }),
      h('path', { d: 'M8.5 8V16.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      h('circle', { cx: 8.5, cy: 8.75, r: 1.15, fill: 'currentColor' }),
      h('circle', { cx: 8.5, cy: 12.25, r: 1.15, fill: 'currentColor' }),
      h('circle', { cx: 8.5, cy: 15.75, r: 1.15, fill: 'currentColor' }),
      h('path', {
        d: 'M11.75 8.75H16M11.75 12.25H16M11.75 15.75H16',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
      }))
    }

    function RefreshIcon() {
      return h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M13.25 8a5.25 5.25 0 1 1-1.6-3.78M13.25 2.5v3.1h-3.1',
          stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    function SearchIcon() {
      return h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('circle', { cx: 7, cy: 7, r: 4.25, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', { d: 'M10.25 10.25 13.5 13.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }))
    }

    function SortIcon({ order }) {
      return h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: order === 'desc' ? 'M8 3v10M4.5 9.5 8 13l3.5-3.5' : 'M8 13V3M4.5 6.5 8 3l3.5 3.5',
          stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    function OpenIcon() {
      return h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M9.5 3.5h3v3M12.25 3.75 7.5 8.5M11.5 9.25v2.5a.75.75 0 0 1-.75.75h-6.5a.75.75 0 0 1-.75-.75v-6.5a.75.75 0 0 1 .75-.75H7',
          stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    function useOperationLog() {
      const [state, setState] = useState({ data: null, loading: true, refreshing: false, error: null })
      const controllerRef = useRef(null)

      const load = useCallback(async () => {
        // One read at a time: a timer tick never cancels a manual refresh.
        if (controllerRef.current !== null) return
        const controller = new AbortController()
        controllerRef.current = controller
        setState(previous => previous.data === null
          ? { ...previous, loading: true }
          : { ...previous, refreshing: true })
        try {
          const url = new URL(API_ROUTE, document.baseURI)
          url.searchParams.set('limit', '2000')
          const response = await fetch(url, {
            signal: controller.signal,
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          setState({ data: normalize(payload), loading: false, refreshing: false, error: null })
        } catch (error) {
          if (controller.signal.aborted) return
          setState(previous => ({
            data: previous.data,
            loading: false,
            refreshing: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        } finally {
          if (controllerRef.current === controller) controllerRef.current = null
        }
      }, [])

      useEffect(() => {
        load()
        const timer = setInterval(() => {
          if (typeof document === 'undefined' || !document.hidden) load()
        }, POLL_MS)
        return () => {
          clearInterval(timer)
          controllerRef.current?.abort()
        }
      }, [load])

      return { ...state, reload: load }
    }

    function normalize(payload) {
      const raw = payload !== null && typeof payload === 'object' && Array.isArray(payload.entries)
        ? payload.entries
        : []
      const entries = raw.filter(entry => entry !== null && typeof entry === 'object'
        && typeof entry.kind === 'string' && typeof entry.startedAt === 'string')
      const total = payload !== null && typeof payload === 'object' && Number.isFinite(payload.total)
        ? payload.total
        : entries.length
      const counts = payload !== null && typeof payload === 'object' && payload.counts !== null
        && typeof payload.counts === 'object' ? payload.counts : {}
      const generatedAt = payload !== null && typeof payload === 'object'
        && typeof payload.generatedAt === 'string' ? payload.generatedAt : null
      return { entries, total, counts, generatedAt }
    }

    function formatTime(value) {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? '--:--:--' : formatters().time.format(date)
    }

    function formatDay(value) {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? '—' : formatters().day.format(date)
    }

    function dayKey(date) {
      const pad = number => String(number).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    function dayLabel(value, t) {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return '—'
      const today = new Date()
      const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
      if (dayKey(date) === dayKey(today)) return t('today')
      if (dayKey(date) === dayKey(yesterday)) return t('yesterday')
      return formatDay(value)
    }

    function durationText(milliseconds) {
      if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) return ''
      if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`
      if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1)} s`
      return `${Math.floor(milliseconds / 60000)}m ${Math.round((milliseconds % 60000) / 1000)}s`
    }

    function splitPath(value) {
      const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
      return index <= 0 ? { dir: '', base: value } : { dir: value.slice(0, index + 1), base: value.slice(index + 1) }
    }

    function shortSessionId(sessionId) {
      const trimmed = sessionId.replace(/^session-/, '')
      return trimmed.length > 8 ? trimmed.slice(0, 8) : trimmed
    }

    /**
     * Resolve the conversation behind an operation. A subagent session that the
     * list cannot open falls back to its parent conversation.
     */
    function resolveSessionInfo(sessionId, catalog) {
      if (typeof sessionId !== 'string' || sessionId === '') return null
      const byId = catalog !== null && typeof catalog === 'object' && catalog.byId !== null && typeof catalog.byId === 'object'
        ? catalog.byId
        : {}
      const ids = catalog !== null && typeof catalog === 'object' && Array.isArray(catalog.ids) ? catalog.ids : []
      const summary = byId[sessionId]
      const available = id => typeof id === 'string' && ids.includes(id)
      const target = summary === undefined ? null
        : available(summary.id) ? summary.id
          : available(summary.parentId) ? summary.parentId
            : null
      const targetSummary = target !== null && target !== sessionId ? byId[target] : undefined
      return {
        id: sessionId,
        title: targetSummary?.displayTitle
          ?? summary?.displayTitle
          ?? shortSessionId(sessionId),
        target,
        viaParent: target !== null && target !== sessionId,
        subagent: summary?.origin === 'subagent',
      }
    }

    function useSessionCatalog(sessions) {
      const [catalog, setCatalog] = useState(() => (sessions === null || sessions === undefined
        ? null
        : sessions.list.getSnapshot()))
      useEffect(() => {
        if (sessions === null || sessions === undefined) return undefined
        const sync = () => { setCatalog(sessions.list.getSnapshot()) }
        sync()
        return sessions.list.subscribe(sync)
      }, [sessions])
      return catalog
    }

    function entryTime(entry) {
      const value = Date.parse(entry.startedAt)
      return Number.isFinite(value) ? value : 0
    }

    function matchesQuery(entry, query, sessionTitle) {
      if (query === '') return true
      const paths = Array.isArray(entry.paths) ? entry.paths : []
      const haystack = [entry.tool, entry.detail, entry.sessionId, sessionTitle, ...paths]
        .filter(value => typeof value === 'string')
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    }

    function Chip({ label, count, selected, onSelect }) {
      return h('button', {
        type: 'button', className: 'fol-chip', 'aria-pressed': selected, onClick: onSelect,
      },
      h('span', null, label),
      h('span', { className: 'fol-chip-count' }, String(count)))
    }

    function Row({ entry, t, catalog, openSession }) {
      const kind = KINDS.includes(entry.kind) ? entry.kind : 'other'
      const paths = Array.isArray(entry.paths) ? entry.paths.filter(path => typeof path === 'string' && path !== '') : []
      const primaryPath = paths.length > 0 ? paths[0] : null
      const pathParts = primaryPath === null ? { dir: '', base: t('noPaths') } : splitPath(primaryPath)
      const extra = paths.length - 1
      const session = resolveSessionInfo(entry.sessionId, catalog)
      const meta = []
      if (typeof entry.tool === 'string' && entry.tool !== '') meta.push(h('span', { key: 'tool' }, entry.tool))
      const duration = durationText(entry.durationMs)
      if (duration !== '') meta.push(h('span', { key: 'duration' }, duration))
      if (session !== null) {
        const verb = session.target === null
          ? t('sessionUnavailable')
          : `${t('openSession')}: ${session.title}${session.viaParent ? ` (${t('parentConversation')})` : ''}`
        meta.push(h('button', {
          key: 'session',
          type: 'button',
          className: 'fol-session',
          disabled: session.target === null,
          title: verb,
          'aria-label': verb,
          onClick: () => {
            if (session.target !== null && typeof openSession === 'function') openSession(session.target)
          },
        },
        h('span', { className: 'fol-session-prefix' }, t('session')),
        session.subagent ? h('span', { className: 'fol-session-tag' }, t('subagent')) : null,
        h('span', { className: 'fol-session-label' }, session.title),
        session.target === null ? null : h(OpenIcon)))
      }
      const metaNodes = []
      meta.forEach((node, index) => {
        if (index > 0) metaNodes.push(h('span', { key: `sep-${index}`, className: 'fol-sep', 'aria-hidden': true }, '·'))
        metaNodes.push(node)
      })
      const fragment = typeof entry.fragmentCount === 'number' && entry.fragmentCount > 1
        ? `${typeof entry.fragmentIndex === 'number' ? entry.fragmentIndex : 1}/${entry.fragmentCount}`
        : ''
      const status = entry.status === 'failed' ? 'failed' : entry.status === 'unknown' ? 'unknown' : 'ok'
      return h('li', { className: 'fol-row' },
        h('div', { className: 'fol-time' }, formatTime(entry.startedAt)),
        h('div', { className: 'fol-main' },
          h('div', { className: 'fol-line' },
            h('span', { className: `fol-badge fol-badge-${kind}` }, t(`kind.${kind}`)),
            h('span', { className: 'fol-path', title: paths.join('\n') || t('noPaths') },
              pathParts.dir === '' ? null : h('span', { className: 'fol-dir' }, pathParts.dir),
              h('span', { className: 'fol-base' }, pathParts.base)),
            extra > 0 ? h('span', { className: 'fol-more', title: paths.slice(1).join('\n') }, `+${extra}`) : null,
            fragment === ''
              ? null
              : h('span', { className: 'fol-frag', title: t('groupedHint') }, fragment),
            status === 'ok' ? null : h('span', { className: `fol-status-${status}` }, t(status))),
          typeof entry.detail === 'string' && entry.detail !== ''
            ? h('div', { className: 'fol-detail', title: entry.detail }, entry.detail)
            : null,
          metaNodes.length > 0 ? h('div', { className: 'fol-meta' }, metaNodes) : null,
          typeof entry.error === 'string' && entry.error !== ''
            ? h('div', { className: 'fol-row-error' }, entry.error)
            : null))
    }

    function EmptyState({ filtered, t, onClear }) {
      return h('div', { className: 'fol-empty', role: 'status', 'aria-live': 'polite' },
        h(Icon, { size: 40 }),
        h('p', { className: 'fol-empty-title' }, filtered ? t('emptyFiltered') : t('emptyTitle')),
        h('p', { className: 'fol-empty-hint' }, filtered ? t('emptyFilteredHint') : t('emptyHint')),
        filtered ? h('button', { type: 'button', onClick: onClear }, t('clearFilters')) : null)
    }

    function FileOpsPage(props) {
      const t = typeof props.t === 'function' ? props.t : key => key
      const log = useOperationLog()
      const catalog = useSessionCatalog(props.sessions)
      const openSession = typeof props.openSession === 'function' ? props.openSession : null
      const [kind, setKind] = useState('all')
      const [query, setQuery] = useState('')
      const [order, setOrder] = useState('desc')

      const entries = log.data !== null ? log.data.entries : []
      const counts = log.data !== null ? log.data.counts : {}
      const total = log.data !== null ? log.data.total : 0
      const filtered = kind !== 'all' || query.trim() !== ''

      const visible = useMemo(() => {
        const needle = query.trim().toLowerCase()
        const rows = entries.filter(entry => (kind === 'all' || entry.kind === kind)
          && matchesQuery(entry, needle, resolveSessionInfo(entry.sessionId, catalog)?.title ?? ''))
        rows.sort((left, right) => order === 'desc'
          ? entryTime(right) - entryTime(left)
          : entryTime(left) - entryTime(right))
        return rows
      }, [entries, kind, query, order, catalog])

      const groups = useMemo(() => {
        const result = []
        let current = null
        for (const entry of visible) {
          const key = dayKey(new Date(entry.startedAt))
          if (current === null || current.key !== key) {
            current = { key, date: entry.startedAt, items: [] }
            result.push(current)
          }
          current.items.push(entry)
        }
        return result
      }, [visible])

      const countFor = candidate => candidate === 'all'
        ? total
        : Number.isFinite(counts[candidate]) ? counts[candidate] : 0

      const header = h('div', { className: 'fol-heading' },
        h('div', { className: 'fol-heading-text' },
          h('h1', null, t('pageTitle')),
          h('p', { className: 'fol-subtitle' }, t('pageSubtitle'))),
        h('div', { className: 'fol-actions' },
          h('button', {
            type: 'button', className: 'fol-refresh', onClick: () => { log.reload() },
            disabled: log.loading || log.refreshing,
            'aria-busy': log.loading || log.refreshing,
            'aria-label': t('refresh'),
          }, h(RefreshIcon), h('span', null, log.refreshing ? t('refreshing') : t('refresh')))))

      const chips = h('div', { className: 'fol-chips', role: 'group', 'aria-label': t('filterLabel') },
        h(Chip, {
          key: 'all', label: t('filterAll'), count: countFor('all'),
          selected: kind === 'all', onSelect: () => { setKind('all') },
        }),
        KINDS.map(candidate => h(Chip, {
          key: candidate, label: t(`kind.${candidate}`), count: countFor(candidate),
          selected: kind === candidate, onSelect: () => { setKind(candidate) },
        })))

      const tools = h('div', { className: 'fol-tools' },
        h('label', { className: 'fol-search' },
          h(SearchIcon),
          h('input', {
            type: 'search', value: query, placeholder: t('searchPlaceholder'),
            'aria-label': t('searchPlaceholder'),
            onChange: event => { setQuery(event.target.value) },
          })),
        h('button', {
          type: 'button', className: 'fol-sort',
          onClick: () => { setOrder(current => current === 'desc' ? 'asc' : 'desc') },
        }, h(SortIcon, { order }), h('span', null, order === 'desc' ? t('sortNewest') : t('sortOldest'))))

      const generated = log.data !== null && log.data.generatedAt !== null
        ? t('updatedAt', { time: formatTime(log.data.generatedAt) })
        : t('autoRefresh')
      const stats = h('div', { className: 'fol-stats' },
        h('span', null, t('showing', { shown: visible.length, total })),
        h('span', null, generated),
        total >= 2000 ? h('span', { className: 'fol-window-note' }, t('windowNotice')) : null)
      const inlineError = log.data !== null && log.error !== null
        ? h('div', { className: 'fol-inline-error', role: 'status' },
          h('span', null, `${t('staleNotice')} ${log.error}`),
          h('button', { type: 'button', onClick: () => { log.reload() } }, t('retry')))
        : null

      let body
      if (log.data === null && log.loading) {
        body = h('div', { className: 'fol-status', role: 'status', 'aria-live': 'polite' }, t('loading'))
      } else if (log.data === null) {
        body = h('div', { className: 'fol-load-error', role: 'alert' },
          h('strong', null, t('loadError')),
          log.error !== null ? h('span', null, log.error) : null,
          h('button', { type: 'button', onClick: () => { log.reload() } }, t('retry')))
      } else if (visible.length === 0) {
        body = h(EmptyState, {
          filtered, t,
          onClear: () => { setKind('all'); setQuery('') },
        })
      } else {
        body = h('div', { 'aria-busy': log.loading || log.refreshing },
          groups.map(group => h('section', { className: 'fol-day', key: group.key },
          h('h2', { className: 'fol-day-title' }, dayLabel(group.date, t)),
            h('ul', { className: 'fol-list' },
              group.items.map(entry => h(Row, { key: entry.id, entry, t, catalog, openSession }))))))
      }

      return h('div', { className: 'fol-page' },
        h('style', null, CSS),
        h('div', { className: 'fol-scroll' },
          h('div', { className: 'fol-content' },
            header,
            chips,
            tools,
            stats,
            inlineError,
            body)))
    }

    return {
      inject: ['slots', 'locale', 'sessions', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'file-ops-log: dictionaries')
        const t = ctx.locale.bind(NS)
        const services = {
          sessions: ctx.sessions,
          openSession: sessionId => { ctx.uiWorkspace.openSession(sessionId) },
        }
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 15,
          locale: NS,
          label: () => t('panelLabel'),
        }, Icon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => services,
        }, FileOpsPage))
      },
    }
  },
})
