/**
 * Append-only JSONL store for file-operation records.
 *
 * The in-memory list is a bounded, newest-last cache of the durable file; the
 * file is the record of truth and survives restarts. Writes are serialized so
 * two tool results cannot interleave half a line.
 */
import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const LOAD_TAIL_BYTES = 8 * 1024 * 1024
const ROTATE_CHECK_EVERY = 50

/**
 * Create the log over one directory.
 * @param {object} options
 * @param {string} options.dir - directory holding `operations.jsonl`.
 * @param {number} [options.maxEntries] - newest entries kept in memory and served.
 * @param {number} [options.maxFileBytes] - size at which the file rotates to `operations.1.jsonl`.
 * @param {(error: unknown) => void} [options.onError] - sink for background write failures.
 * @returns {{
 *   append: (entry: object) => void,
 *   list: (limit?: number) => object[],
 *   size: () => number,
 *   path: string,
 *   dispose: () => Promise<void>,
 * }}
 */
export function createOperationLog({
  dir,
  maxEntries = 2000,
  maxFileBytes = 4 * 1024 * 1024,
  onError = () => {},
}) {
  const file = join(dir, 'operations.jsonl')
  let entries = []
  let queue = Promise.resolve()
  let appends = 0
  let disposed = false

  try {
    mkdirSync(dir, { recursive: true })
    entries = loadTail(file, maxEntries)
  } catch (error) {
    onError(error)
  }

  function append(entry) {
    if (disposed) return
    entries.push(entry)
    if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries)
    queue = queue.then(() => {
      try {
        appends += 1
        if (appends % ROTATE_CHECK_EVERY === 0) rotateIfNeeded(file, maxFileBytes)
        appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
      } catch (error) {
        onError(error)
      }
    })
  }

  function list(limit = maxEntries) {
    const count = Math.max(0, Math.min(limit, entries.length))
    return entries.slice(entries.length - count).reverse()
  }

  return {
    append,
    list,
    size: () => entries.length,
    path: file,
    dispose: async () => {
      disposed = true
      await queue
    },
  }
}

function rotateIfNeeded(file, maxFileBytes) {
  if (!existsSync(file)) return
  if (statSync(file).size <= maxFileBytes) return
  const previous = `${file}.1`
  rmSync(previous, { force: true })
  renameSync(file, previous)
  writeFileSync(file, '', 'utf8')
}

function loadTail(file, maxEntries) {
  if (!existsSync(file)) return []
  const size = statSync(file).size
  const start = Math.max(0, size - LOAD_TAIL_BYTES)
  let text
  if (start === 0) {
    text = readFileSync(file, 'utf8')
  } else {
    const fd = openSync(file, 'r')
    try {
      const buffer = Buffer.alloc(size - start)
      readSync(fd, buffer, 0, buffer.length, start)
      text = buffer.toString('utf8')
    } finally {
      closeSync(fd)
    }
  }
  if (start > 0) {
    const newline = text.indexOf('\n')
    text = newline === -1 ? '' : text.slice(newline + 1)
  }
  const records = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const record = JSON.parse(trimmed)
      if (isRecord(record)) records.push(record)
    } catch {
      // A torn trailing line is expected after a crash; later lines stay readable.
    }
  }
  return records.slice(-maxEntries)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null
}
