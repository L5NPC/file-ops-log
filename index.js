/**
 * Host half of the file-operation log.
 *
 * Observes the shared tool pipeline (`tools/pre-execute` → `tools/result`),
 * classifies mutating and reading operations on files, appends them to a
 * durable JSONL log, and serves the newest records to the Web GUI over one
 * authenticated Fetch route. The Client page is registered in `client.js`.
 */
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { classifyToolCall } from './lib/classify.js'
import { createOperationLog } from './lib/store.js'

export const name = 'file-ops-log'
export const inject = ['tools', 'connection']

/** Exact Fetch route below `/api`; the Client addresses it document-relatively. */
const API_PATH = '/api/file-ops.log'
const DEFAULT_LIMIT = 2000
const MAX_PENDING = 1024
const MAX_ERROR_LENGTH = 200
const KINDS = ['create', 'modify', 'delete', 'move', 'copy', 'read', 'other']

/**
 * Activate the recorder and its read route.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 */
export function apply(ctx) {
  const log = createOperationLog({
    dir: dataDirectory(),
    onError: error => console.error('[file-ops-log] writing the operation log failed:', error),
  })
  ctx.effect(() => () => log.dispose(), 'file-ops-log: log store')

  /** Calls awaiting their final outcome, keyed by call id. */
  const pending = new Map()
  ctx.effect(() => () => pending.clear(), 'file-ops-log: pending calls')

  ctx.on('tools/pre-execute', (exec, next) => {
    try {
      const infos = classifyToolCall(exec.name, exec.arguments)
      if (infos.length > 0) {
        pending.set(String(exec.callId), {
          infos,
          startedAt: Date.now(),
          sessionId: exec.agent === undefined ? '' : String(exec.agent.id),
        })
        if (pending.size > MAX_PENDING) {
          const oldest = pending.keys().next().value
          if (oldest !== undefined) pending.delete(oldest)
        }
      }
    } catch (error) {
      console.error('[file-ops-log] classifying a pending call failed:', error)
    }
    return next()
  })

  ctx.on('tools/result', (exec, result) => {
    try {
      const key = String(exec.callId)
      const started = pending.get(key)
      pending.delete(key)
      // Re-classify with the outcome: `write` reports "Created file" only there.
      const classified = classifyToolCall(exec.name, exec.arguments, result)
      const infos = classified.length > 0 ? classified : (started?.infos ?? [])
      if (infos.length === 0) return
      const finishedAt = Date.now()
      const startedAt = started?.startedAt ?? finishedAt
      const failed = result !== null && typeof result === 'object' && result.isError === true
      const sessionId = started?.sessionId ?? (exec.agent === undefined ? '' : String(exec.agent.id))
      // One call with several operations shares one aggregate outcome: when it
      // failed, each fragment's own success is unknown rather than failed.
      const status = failed ? (infos.length > 1 ? 'unknown' : 'failed') : 'ok'
      const callId = String(exec.callId)
      infos.forEach((info, index) => {
        log.append({
          id: randomUUID(),
          kind: info.kind,
          tool: exec.name,
          paths: info.paths,
          detail: info.detail,
          status,
          callId,
          fragmentIndex: index + 1,
          fragmentCount: infos.length,
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date(finishedAt).toISOString(),
          durationMs: Math.max(0, finishedAt - startedAt),
          sessionId,
          ...(failed ? { error: truncate(failureMessage(result), MAX_ERROR_LENGTH) } : {}),
        })
      })
    } catch (error) {
      console.error('[file-ops-log] recording a tool result failed:', error)
    }
  })

  const connection = ctx.get('connection')
  if (connection?.fetch === undefined) return
  ctx.effect(() => connection.fetch.register({
    path: API_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url)
      const limit = clampLimit(url.searchParams.get('limit'))
      const all = log.list()
      return new Response(JSON.stringify({
        entries: all.slice(0, limit),
        total: all.length,
        counts: countKinds(all),
        generatedAt: new Date().toISOString(),
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    },
  }), 'file-ops-log: fetch route')
}

/** Keep plugin-owned records outside the workspace and the session log. */
function dataDirectory() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'plugin-data', 'file-ops-log')
}

function countKinds(entries) {
  const counts = Object.fromEntries(KINDS.map(kind => [kind, 0]))
  for (const entry of entries) {
    if (typeof entry.kind === 'string' && entry.kind in counts) counts[entry.kind] += 1
  }
  return counts
}

function clampLimit(value) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(parsed, DEFAULT_LIMIT))
}

function failureMessage(result) {
  const error = result !== null && typeof result === 'object' ? result.error : undefined
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  return 'failed'
}

function truncate(value, limit) {
  if (typeof value !== 'string') return ''
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}
