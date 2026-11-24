/**
 * Pure classification of tool calls into file operations.
 *
 * One job: turn a tool name, its parsed arguments, and (optionally) its final
 * result into stable log record fragments. One call can describe several
 * operations (a compound shell command, or one patch that adds and deletes), so
 * the classifier returns a list. No I/O, no Cordis, no clock — the caller adds
 * timestamps, session identity, and persistence.
 */

// Unix verbs plus PowerShell cmdlets/aliases and cmd built-ins (Windows).
const SHELL_DELETE = new Set([
  'rm', 'rmdir', 'unlink', 'shred', 'trash',
  'del', 'erase', 'rd', 'ri', 'remove-item',
])
const SHELL_MOVE = new Set([
  'mv', 'rename',
  'move', 'ren', 'mi', 'rni', 'move-item', 'rename-item',
])
const SHELL_COPY = new Set([
  'cp', 'rsync', 'ditto', 'ln', 'install',
  'copy', 'cpi', 'xcopy', 'robocopy', 'copy-item',
])
const SHELL_CREATE = new Set([
  'mkdir', 'touch', 'mktemp', 'mkfifo',
  'md', 'ni', 'new-item',
])
const SHELL_MODIFY = new Set([
  'tee', 'truncate', 'dd', 'sed', 'perl', 'patch',
  'set-content', 'add-content', 'clear-content', 'out-file', 'tee-object', 'ac', 'clc',
])
const SHELL_PREFIXES = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'then', 'do', 'else', '{', '}', 'exec', 'xargs'])

/** PowerShell parameters whose value is a filesystem path. */
const PS_PATH_FLAGS = new Set([
  '-path', '-literalpath', '-destination', '-filepath', '-destinationpath',
  '-newname', '-source', '-target', '-outfile',
])
/** PowerShell parameters whose value is not a path; skip the value instead of recording it. */
const PS_VALUE_FLAGS = new Set([
  '-itemtype', '-value', '-encoding', '-filter', '-include', '-exclude', '-credential',
  '-language', '-compressionlevel', '-name', '-type', '-verbose', '-erroraction',
  '-warningaction', '-informationaction', '-depth', '-stream', '-delimiter', '-totalcount',
  '-tail', '-first', '-last', '-skip', '-replace', '-pattern', '-patterntype',
])
/** Short PowerShell aliases for cmdlets, which take the same named parameters. */
const PS_ALIASES = new Set(['ni', 'mi', 'cpi', 'ri', 'rni', 'ac', 'clc'])
/** Cmdlets whose first positional argument is the file and whose later positionals are content. */
const PS_CONTENT_VERBS = new Set(['set-content', 'add-content', 'clear-content', 'out-file', 'ac', 'clc'])
/** Download cmdlets: their positional argument is a URL, and only -OutFile names a file. */
const PS_DOWNLOAD_VERBS = new Set(['invoke-webrequest', 'iwr'])

const MAX_PATHS = 20
const MAX_PATH_LENGTH = 500
const MAX_DETAIL_LENGTH = 1000

/**
 * Classify one tool call.
 * @param {string} name - model-facing tool name.
 * @param {unknown} args - parsed tool arguments.
 * @param {unknown} [result] - final tool result, when the call already settled.
 * @returns {{ kind: string, paths: string[], detail: string }[]} fragments; empty for a non-file operation.
 */
export function classifyToolCall(name, args, result) {
  const a = isRecord(args) ? args : {}
  switch (name) {
    case 'read':
    case 'read_image': {
      const paths = pickPaths(a, ['file_path', 'path'])
      return paths.length === 0 ? [] : [{ kind: 'read', paths, detail: '' }]
    }
    case 'write': {
      const paths = pickPaths(a, ['file_path', 'path'])
      if (paths.length === 0) return []
      // The settled result distinguishes creation from replacement.
      return [{ kind: createdByWrite(result) ? 'create' : 'modify', paths, detail: '' }]
    }
    case 'edit':
      return single('modify', pickPaths(a, ['file_path', 'path']), '')
    case 'apply_patch':
      return classifyPatch(a.input)
    case 'bash':
      return classifyShellCommand(typeof a.command === 'string' ? a.command : '')
    case 'pwsh':
      return classifyShellCommand(typeof a.command === 'string' ? a.command : '', { windows: true })
    case 'present': {
      const paths = Array.isArray(a.files)
        ? a.files.map(file => (isRecord(file) && typeof file.path === 'string' ? file.path : null)).filter(Boolean)
        : []
      return single('other', paths, 'deliverable')
    }
    default:
      if (name.startsWith('office_') || name === 'office_render' || name === 'office_convert' || name === 'office_recalculate') {
        const paths = pickPaths(a, ['file_path', 'path', 'output_path', 'outputPath', 'output'])
        return single('other', paths, 'office')
      }
      return []
  }
}

/**
 * Classify a shell command line into one fragment per recognized operation kind.
 * @param {string} command - shell command text.
 * @returns {{ kind: string, paths: string[], detail: string }[]} fragments; empty when no file operation is recognized.
 */
export function classifyShellCommand(command, options = {}) {
  if (typeof command !== 'string' || command.trim() === '') return []
  const windows = options.windows === true
  const detail = truncate(command.trim().replace(/\s+/gu, ' '), MAX_DETAIL_LENGTH)
  // A heredoc body is data, not commands: keep it out of verb and path detection.
  const source = stripHeredocs(command)
  const byKind = new Map()
  const add = (kind, paths) => {
    if (!byKind.has(kind)) byKind.set(kind, [])
    for (const path of paths) addPath(byKind.get(kind), path)
  }

  for (const segment of splitSegments(source)) {
    const tokens = tokenize(segment)
    let index = 0
    while (index < tokens.length && (isAssignment(tokens[index]) || SHELL_PREFIXES.has(tokens[index]))) index++
    if (index >= tokens.length) continue
    let verb = basename(tokens[index]).toLowerCase()
    let verbIndex = index

    if (verb === 'git' || verb === 'git.exe') {
      const sub = tokens[index + 1]
      if (sub !== 'rm' && sub !== 'mv') continue
      verb = sub === 'rm' ? 'git-rm' : 'git-mv'
      verbIndex = index + 1
    } else if (verb === 'find') {
      // A search root or a -name pattern is not the file that was deleted.
      if (tokens.some(token => token === '-delete')) add('delete', [])
      continue
    }

    if (PS_DOWNLOAD_VERBS.has(verb)) {
      const target = outputFilePath(tokens, verbIndex)
      if (target !== null) add('modify', [target])
      continue
    }

    const kind = shellKind(verb, tokens, index)
    if (kind === null) continue
    add(kind, shellPaths(verb, tokens, verbIndex, windows))
  }

  const redirected = redirectionTargets(stripQuoted(source))
  if (redirected.length > 0) add('modify', redirected)
  return fragments(byKind, detail)
}

function shellKind(verb, tokens, index) {
  if (SHELL_DELETE.has(verb) || verb === 'git-rm') return 'delete'
  if (SHELL_MOVE.has(verb) || verb === 'git-mv') return 'move'
  if (SHELL_COPY.has(verb)) return 'copy'
  if (SHELL_CREATE.has(verb)) return 'create'
  if (SHELL_MODIFY.has(verb)) {
    if (verb === 'sed' || verb === 'perl') {
      return tokens.slice(index + 1).some(token => /^-[a-zA-Z]*i/u.test(token)) ? 'modify' : null
    }
    if (verb === 'dd') return tokens.some(token => token.startsWith('of=')) ? 'modify' : null
    return 'modify'
  }
  return null
}

function shellPaths(verb, tokens, verbIndex, windows) {
  const paths = []
  if (verb === 'patch') {
    // The argument is the patch input, not the files it changes.
    return paths
  }
  if (verb === 'sed' || verb === 'perl') {
    // The script expression sits among the arguments; the file is the last one.
    addPath(paths, tokens[tokens.length - 1])
    return paths
  }
  if (verb === 'dd') {
    for (const token of tokens) if (token.startsWith('of=')) addPath(paths, token.slice(3))
    return paths
  }
  // Hyphenated PowerShell cmdlets take named parameters; parse them instead of
  // treating parameter values such as `Directory` as paths.
  if (verb.includes('-') || PS_ALIASES.has(verb)) return cmdletPaths(verb, tokens, verbIndex)

  for (const token of tokens.slice(verbIndex + 1)) {
    if (token === '--' || token.startsWith('-')) continue
    if (windows && isWindowsSwitch(token)) continue
    if (/^\d+$/u.test(token)) continue
    addPath(paths, token)
  }
  return paths
}

function cmdletPaths(verb, tokens, verbIndex) {
  const paths = []
  const contentVerb = PS_CONTENT_VERBS.has(verb)
  let positional = false
  let index = verbIndex + 1
  while (index < tokens.length) {
    const token = tokens[index]
    if (token === '--') {
      index += 1
      continue
    }
    if (token.startsWith('-')) {
      const inline = /^(-[A-Za-z]+)[:=](.+)$/u.exec(token)
      if (inline !== null) {
        if (PS_PATH_FLAGS.has(inline[1].toLowerCase())) addPath(paths, inline[2])
        index += 1
        continue
      }
      const flag = token.toLowerCase()
      if (PS_PATH_FLAGS.has(flag)) {
        const value = tokens[index + 1]
        if (value !== undefined && !value.startsWith('-')) {
          addPath(paths, value)
          index += 2
          continue
        }
      } else if (PS_VALUE_FLAGS.has(flag)) {
        index += 2
        continue
      }
      index += 1
      continue
    }
    if (isWindowsSwitch(token)) {
      index += 1
      continue
    }
    // After the first positional path, remaining positionals are content for
    // cmdlets such as Set-Content/Add-Content/Out-File.
    if (contentVerb && positional) {
      index += 1
      continue
    }
    addPath(paths, token)
    positional = true
    index += 1
  }
  return paths
}

function outputFilePath(tokens, verbIndex) {
  for (let index = verbIndex + 1; index < tokens.length; index += 1) {
    const match = /^(-outfile|-o|--output)(?:[:=](.+))?$/iu.exec(tokens[index])
    if (match === null) continue
    if (match[2] !== undefined && match[2] !== '') return match[2]
    const value = tokens[index + 1]
    if (value !== undefined && !value.startsWith('-')) return value
  }
  return null
}

function isWindowsSwitch(token) {
  return /^[/-][A-Za-z?][A-Za-z0-9?]*$/u.test(token)
}

function classifyPatch(input) {
  if (typeof input !== 'string' || input === '') return []
  const adds = []
  const updates = []
  const deletes = []
  const moves = []
  let pendingUpdate = null
  for (const line of input.split(/\r?\n/u)) {
    const match = /^\*\*\* (Add File|Update File|Delete File|Move to):\s*(.+?)\s*$/u.exec(line)
    if (match === null) continue
    const label = match[1]
    const path = match[2]
    if (label === 'Add File') {
      adds.push(path)
    } else if (label === 'Delete File') {
      deletes.push(path)
    } else if (label === 'Update File') {
      updates.push(path)
      pendingUpdate = path
    } else {
      moves.push(pendingUpdate === null ? { to: path } : { from: pendingUpdate, to: path })
      if (pendingUpdate !== null) {
        const index = updates.lastIndexOf(pendingUpdate)
        if (index !== -1) updates.splice(index, 1)
      }
      pendingUpdate = null
    }
  }

  const fragments = []
  if (adds.length > 0) {
    fragments.push({ kind: 'create', paths: finishPaths(adds), detail: truncate(`add ${adds.join('; ')}`, MAX_DETAIL_LENGTH) })
  }
  if (updates.length > 0) {
    fragments.push({ kind: 'modify', paths: finishPaths(updates), detail: truncate(`update ${updates.join('; ')}`, MAX_DETAIL_LENGTH) })
  }
  if (moves.length > 0) {
    const paths = []
    for (const move of moves) {
      if (move.from !== undefined) addPath(paths, move.from)
      addPath(paths, move.to)
    }
    fragments.push({ kind: 'move', paths: finishPaths(paths), detail: truncate(`move ${moves.map(move => move.from === undefined ? move.to : `${move.from} -> ${move.to}`).join('; ')}`, MAX_DETAIL_LENGTH) })
  }
  if (deletes.length > 0) {
    fragments.push({ kind: 'delete', paths: finishPaths(deletes), detail: truncate(`delete ${deletes.join('; ')}`, MAX_DETAIL_LENGTH) })
  }
  return fragments
}

function createdByWrite(result) {
  if (!isRecord(result) || result.isError === true) return false
  const text = resultText(result)
  return /Created file/u.test(text)
}

function resultText(result) {
  const content = isRecord(result) ? result.content : undefined
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

function redirectionTargets(command) {
  const targets = []
  const pattern = /(?:^|[\s;&|])(?:\d?\*?>>?|&>)\s*([^\s&|;<>]+)/gu
  let match
  while ((match = pattern.exec(command)) !== null) {
    const target = stripQuotes(match[1])
    const lower = target.toLowerCase()
    if (lower === '/' || lower === '/dev/null' || lower === 'nul' || lower === '$null') continue
    targets.push(target)
  }
  return targets
}

function splitSegments(source) {
  const segments = []
  let current = ''
  let quote = null
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote !== null) {
      current += character
      if (character === '\\' && quote === '"' && index + 1 < source.length) {
        current += source[index + 1]
        index += 1
      } else if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      current += character
      continue
    }
    if (character === '&' && source[index + 1] === '&') {
      segments.push(current)
      current = ''
      index += 1
      continue
    }
    if (character === '|' && source[index + 1] === '|') {
      segments.push(current)
      current = ''
      index += 1
      continue
    }
    if (character === ';' || character === '\n' || character === '|') {
      segments.push(current)
      current = ''
      continue
    }
    current += character
  }
  segments.push(current)
  return segments
}

function stripHeredocs(command) {
  const kept = []
  let terminator = null
  for (const line of command.split('\n')) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null
      continue
    }
    const match = /<<-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9_]+))/u.exec(line)
    if (match === null) {
      kept.push(line)
      continue
    }
    terminator = match[1] ?? match[2] ?? match[3] ?? null
    kept.push(line.slice(0, match.index))
  }
  return kept.join('\n')
}

function stripQuoted(text) {
  return text.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/gu, ' ')
}

function tokenize(segment) {
  const tokens = []
  const pattern = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/gu
  let match
  while ((match = pattern.exec(segment)) !== null) {
    const raw = match[1] ?? match[2] ?? match[3] ?? ''
    tokens.push(match[1] === undefined ? raw : raw.replace(/\\(["\\])/gu, '$1'))
  }
  return tokens
}

function isAssignment(token) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/u.test(token)
}

function basename(token) {
  const parts = token.split(/[\\/]/u)
  return parts[parts.length - 1] || token
}

function pickPaths(args, keys) {
  const paths = []
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string') addPath(paths, value)
  }
  return finishPaths(paths)
}

function addPath(paths, value) {
  if (typeof value !== 'string') return
  if (value === '' || value === '.' || value === '..') return
  const clean = stripQuotes(value).trim()
  if (clean === '' || clean.startsWith('-')) return
  paths.push(clean.slice(0, MAX_PATH_LENGTH))
}

function finishPaths(paths) {
  const unique = []
  for (const path of paths) if (path !== '' && !unique.includes(path)) unique.push(path)
  return unique.slice(0, MAX_PATHS)
}

function fragments(byKind, detail) {
  const result = []
  for (const [kind, paths] of byKind) {
    result.push({ kind, paths: finishPaths(paths), detail })
  }
  return result
}

function single(kind, paths, detail) {
  return paths.length === 0 ? [] : [{ kind, paths, detail: truncate(detail, MAX_DETAIL_LENGTH) }]
}

function stripQuotes(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

function truncate(value, limit) {
  if (typeof value !== 'string') return ''
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

function isRecord(value) {
  return typeof value === 'object' && value !== null
}
