'use strict'

const { BrowserWindow } = require('electron')
const Store = require('electron-store')
const { z } = require('zod')
const { execFile: execFileCb } = require('child_process')
const { promisify } = require('util')
const { basename, join } = require('path')
const fs = require('fs')

const execFileAsync = promisify(execFileCb)

// ─── Shared helpers ───────────────────────────────────────────────────────────

function sendToRenderer(channel, data) {
  const wins = BrowserWindow.getAllWindows()
  if (wins[0]) wins[0].webContents.send(channel, data)
}

async function runGh(cwd, args) {
  const { stdout, stderr } = await execFileAsync('gh', args, { cwd, timeout: 30_000 })
  if (stderr && !stdout) throw new Error(stderr)
  return stdout.trim()
}

async function runGit(cwd, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: 10_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  return stdout.trim()
}

function parseRateLimit(err) {
  const msg = String(err)
  if (msg.includes('rate limit') || msg.includes('API rate limit')) {
    return { error: 'RATE_LIMITED', resetAt: Date.now() + 60_000 }
  }
  return null
}

// ─── Git status / diff parsers ────────────────────────────────────────────────

function resolveGitFileStatus(x, y) {
  const code = x !== ' ' ? x : y
  switch (code) {
    case 'M': return 'modified'
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'renamed'
    default:  return 'modified'
  }
}

function parseGitStatus(stdout, maxFiles) {
  if (!stdout.trim()) return { branch: '', files: [], hasConflicts: false, truncated: false }
  const entries = stdout.split('\0').filter(e => e.length > 0)
  const files = []
  let hasConflicts = false
  let i = 0

  while (i < entries.length && files.length < maxFiles) {
    const entry = entries[i]
    if (entry.length < 3) { i++; continue }
    const xy = entry.slice(0, 2)
    const path = entry.slice(3)
    const x = xy[0], y = xy[1]

    if (xy === '??' || xy === '!!') {
      files.push({ path, status: xy === '??' ? 'untracked' : 'ignored', staged: false, isBinary: false })
      i++; continue
    }
    if (['UU','AA','DD','AU','UA','DU','UD'].includes(xy)) {
      files.push({ path, status: 'conflicted', staged: false, isBinary: false })
      hasConflicts = true; i++; continue
    }
    if (x === 'R' || x === 'C') {
      const originalPath = entries[i + 1] ?? ''
      files.push({ path, originalPath, status: 'renamed', staged: true, isBinary: false })
      i += 2; continue
    }
    files.push({ path, status: resolveGitFileStatus(x, y), staged: x !== ' ' && x !== '?', isBinary: false })
    i++
  }
  const remaining = entries.slice(i).filter(e => e.length >= 3).length
  return { branch: '', files, hasConflicts, truncated: files.length >= maxFiles && remaining > 0 }
}

function parseGitDiff(stdout, maxBytes) {
  maxBytes = maxBytes ?? 500 * 1024
  const truncated = Buffer.byteLength(stdout, 'utf8') > maxBytes
  const content = truncated ? stdout.slice(0, maxBytes) : stdout

  if (content.includes('Binary files') && content.includes('differ')) {
    return { path: '', hunks: [], isBinary: true, truncated }
  }

  const hunks = []
  const lines = content.split('\n')
  let currentHunk = null
  let oldLine = 0, newLine = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      oldLine = match ? parseInt(match[1], 10) : 1
      newLine = match ? parseInt(match[2], 10) : 1
      currentHunk = { header: line, lines: [] }
      hunks.push(currentHunk)
      continue
    }
    if (!currentHunk) continue
    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', content: line.slice(1), oldLineNumber: null, newLineNumber: newLine++ })
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'remove', content: line.slice(1), oldLineNumber: oldLine++, newLineNumber: null })
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({ type: 'context', content: line.slice(1), oldLineNumber: oldLine++, newLineNumber: newLine++ })
    }
  }
  return { path: '', hunks, isBinary: false, truncated }
}

function parsePrDiff(raw, filePath) {
  if (!raw.trim()) return { path: filePath, hunks: [], isBinary: false }
  if (raw.includes('Binary files')) return { path: filePath, hunks: [], isBinary: true }

  const hunks = []
  let currentHunk = null

  for (const line of raw.split('\n')) {
    if (line.startsWith('@@ ')) {
      if (currentHunk) hunks.push(currentHunk)
      currentHunk = { header: line, lines: [] }
      continue
    }
    if (!currentHunk) continue
    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentHunk.lines.push({ type: 'add', content: line.slice(1), oldLineNumber: null, newLineNumber: null })
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      currentHunk.lines.push({ type: 'remove', content: line.slice(1), oldLineNumber: null, newLineNumber: null })
    } else if (!line.startsWith('---') && !line.startsWith('+++')) {
      currentHunk.lines.push({ type: 'context', content: line.slice(1), oldLineNumber: null, newLineNumber: null })
    }
  }
  if (currentHunk) hunks.push(currentHunk)

  for (const hunk of hunks) {
    const match = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    let oldN = match ? parseInt(match[1], 10) : 1
    let newN = match ? parseInt(match[2], 10) : 1
    for (const dl of hunk.lines) {
      if (dl.type === 'add') dl.newLineNumber = newN++
      else if (dl.type === 'remove') dl.oldLineNumber = oldN++
      else { dl.oldLineNumber = oldN++; dl.newLineNumber = newN++ }
    }
  }
  return { path: filePath, hunks, isBinary: false }
}

// ─── Chapter building ─────────────────────────────────────────────────────────

function isLockOrGeneratedFile(name) {
  if (/\.lock$/.test(name)) return true
  if (/package-lock\.json$/.test(name)) return true
  if (/pnpm-lock\.yaml$/.test(name)) return true
  if (/packages\.lock\.json$/.test(name)) return true
  if (/gradle\.lockfile$/.test(name)) return true
  if (/Package\.resolved$/.test(name)) return true
  if (/go\.sum$/.test(name)) return true
  if (/go\.work\.sum$/.test(name)) return true
  if (/requirements\.txt$/.test(name)) return true
  if (/constraints\.txt$/.test(name)) return true
  if (/shrinkwrap\.json$/.test(name)) return true
  if (/\.generated\.[^.]+$/.test(name)) return true
  if (/\.snap$/.test(name)) return true
  if (/\.pb\.go$/.test(name)) return true
  if (/\.pb\.swift$/.test(name)) return true
  if (/_pb2\.py$/.test(name)) return true
  if (/\.pb\.cc$|\.pb\.h$/.test(name)) return true
  if (/GraphQL\.swift$/.test(name)) return true
  if (/API\.graphql\.swift$/.test(name)) return true
  return false
}

function classifyTier(path) {
  const name = path.split('/').pop() ?? path
  if (/\.(d\.ts|types?\.ts|interface\.ts)$/.test(name) || name === 'types.ts' || name === 'interfaces.ts' || name === 'index.ts') return 0
  if (/\.(spec|test)\.[^.]+$/.test(name) || path.includes('__tests__/')) return 2
  if (isLockOrGeneratedFile(name)) return 3
  return 1
}

function whyHere(tier) {
  switch (tier) {
    case 0: return 'Interface/type file — defines contracts used by the files below'
    case 1: return 'Source file — implementation; read after type definitions'
    case 2: return 'Test file — validates the implementation above'
    case 3: return 'Mechanical change — lock file, generated output, or formatting only'
    default: return ''
  }
}

function chapterName(paths) {
  if (paths.length === 0) return 'Changes'
  const segments = paths.map(p => p.split('/'))
  const depth = Math.min(...segments.map(s => s.length)) - 1
  for (let d = depth; d >= 1; d--) {
    const prefix = segments[0].slice(0, d).join('/')
    if (segments.every(s => s.slice(0, d).join('/') === prefix)) return prefix
  }
  return segments[0][0] ?? 'Changes'
}

function defaultRiskScore() {
  return {
    level: 'low',
    composite: null,
    metrics: { changeSize: null, churn90d: null, blastRadius: null, testFilePresent: null, complexityDelta: null, patchCoverage: null },
    dominantDriver: 'Not yet computed',
    topImporters: [],
    importerCount: 0,
  }
}

function mapChangeType(raw) {
  switch ((raw ?? '').toLowerCase()) {
    case 'added':   return 'added'
    case 'removed':
    case 'deleted': return 'deleted'
    case 'renamed': return 'renamed'
    default:        return 'modified'
  }
}

function applyOverrides(files, order) {
  if (!order || order.length === 0) return files
  const fileMap = new Map(files.map(f => [f.path, f]))
  const ordered = []
  for (const path of order) {
    const f = fileMap.get(path)
    if (f) { ordered.push(f); fileMap.delete(path) }
  }
  for (const f of fileMap.values()) ordered.push(f)
  return ordered
}

function buildChapters(rawFiles, overrides) {
  const files = rawFiles.map(f => ({
    path:       String(f.path ?? f.filename ?? ''),
    additions:  Number(f.additions ?? 0),
    deletions:  Number(f.deletions ?? 0),
    changeType: String(f.changeType ?? f.status ?? 'modified'),
  })).filter(f => f.path.length > 0)

  if (files.length === 0) return []

  const groups = new Map()
  for (const file of files) {
    const parts = file.path.split('/')
    const groupKey = parts.length > 1 ? parts[0] : '.'
    const existing = groups.get(groupKey) ?? []
    existing.push(file)
    groups.set(groupKey, existing)
  }

  const chapters = []
  const groupEntries = [...groups.entries()]

  function buildGroupChapters(groupKey, groupFiles) {
    const byTier = new Map()
    for (const f of groupFiles) {
      const tier = classifyTier(f.path)
      const existing = byTier.get(tier) ?? []
      existing.push(f)
      byTier.set(tier, existing)
    }

    const tieredFiles = []
    for (const tier of [0, 1, 2, 3]) {
      const tFiles = byTier.get(tier) ?? []
      const sorted = tier === 1
        ? [...tFiles].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
        : tFiles
      for (const f of sorted) {
        tieredFiles.push({
          path:             f.path,
          changeType:       mapChangeType(f.changeType ?? 'modified'),
          additions:        f.additions,
          deletions:        f.deletions,
          isBinary:         false,
          tier,
          whyHere:          whyHere(tier),
          riskScore:        defaultRiskScore(),
          estimatedMinutes: Math.max(1, Math.ceil((f.additions + f.deletions) / 60)),
        })
      }
    }

    const chapterId = groupKey === '.' ? 'root' : groupKey.replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const ordered = applyOverrides(tieredFiles, overrides && overrides[chapterId])

    chapters.push({
      id:               chapterId,
      name:             groupKey === '.' ? chapterName(groupFiles.map(f => f.path)) : groupKey,
      files:            ordered,
      estimatedMinutes: ordered.reduce((s, f) => s + f.estimatedMinutes, 0),
      status:           'not-started',
    })
  }

  const regularGroups = []
  const mechanicalGroups = []
  for (const entry of groupEntries) {
    const allMech = entry[1].every(f => classifyTier(f.path) === 3)
    if (allMech) mechanicalGroups.push(entry)
    else regularGroups.push(entry)
  }

  for (const [key, grpFiles] of regularGroups) buildGroupChapters(key, grpFiles)
  for (const [key, grpFiles] of mechanicalGroups) buildGroupChapters(key, grpFiles)

  return chapters
}

// ─── Queue PR signal helpers ──────────────────────────────────────────────────

const LINT_NAMES     = ['lint', 'eslint', 'rubocop', 'flake8', 'pylint', 'stylelint', 'tslint']
const COVERAGE_NAMES = ['coverage', 'codecov', 'coveralls', 'sonar', 'codeclimate', 'lcov']
const LINT_CHECK_NAMES     = LINT_NAMES
const COVERAGE_CHECK_NAMES = COVERAGE_NAMES

function checkSignal(rollup, keywords) {
  if (!rollup || !Array.isArray(rollup)) return 'unknown'
  const checks = rollup.filter(s => {
    const name = String(s.name ?? s.context ?? '').toLowerCase()
    return keywords.some(k => name.includes(k))
  })
  if (checks.length === 0) return 'unknown'
  const states = checks.map(s => String(s.state ?? s.conclusion ?? '').toUpperCase())
  if (states.some(s => s === 'FAILURE' || s === 'ERROR'))  return 'fail'
  if (states.some(s => s === 'PENDING' || s === 'IN_PROGRESS' || s === 'QUEUED')) return 'warn'
  if (states.every(s => s === 'SUCCESS')) return 'pass'
  return 'unknown'
}

function ciSignal(rollup) {
  if (!rollup || !Array.isArray(rollup) || rollup.length === 0) return 'unknown'
  const states = rollup.map(s => String(s.state ?? s.conclusion ?? '').toUpperCase())
  if (states.some(s => s === 'FAILURE' || s === 'ERROR'))  return 'fail'
  if (states.some(s => s === 'PENDING' || s === 'IN_PROGRESS' || s === 'QUEUED')) return 'warn'
  if (states.every(s => s === 'SUCCESS')) return 'pass'
  return 'unknown'
}

function testsSignal(filePaths) {
  if (filePaths.length === 0) return 'unknown'
  const sourceFiles = filePaths.filter(p =>
    /\.(ts|tsx|js|jsx|py|rb|go|java|cs)$/.test(p) &&
    !/\.(spec|test)\.[^.]+$/.test(p) &&
    !p.includes('__tests__')
  )
  if (sourceFiles.length === 0) return 'unknown'
  const testFiles = new Set(filePaths.filter(p => /\.(spec|test)\.[^.]+$/.test(p) || p.includes('__tests__')))
  if (testFiles.size === 0) return 'fail'
  const covered = sourceFiles.filter(src => {
    const stem = src.replace(/\.[^.]+$/, '').replace(/\/index$/, '')
    return [...testFiles].some(t => t.includes(stem.split('/').pop()))
  })
  if (covered.length === 0) return 'warn'
  return covered.length >= sourceFiles.length / 2 ? 'pass' : 'warn'
}

function churnSignal(totalLines, fileCount) {
  if (fileCount === 0) return 'unknown'
  const perFile = totalLines / fileCount
  return perFile > 200 ? 'fail' : perFile > 80 ? 'warn' : 'pass'
}

function blastSignal(fileCount) {
  return fileCount > 15 ? 'fail' : fileCount > 6 ? 'warn' : 'pass'
}

function parseReviewQueuePR(raw) {
  const rawFiles = raw.files ?? []
  const fileCount  = rawFiles.length
  const additions  = rawFiles.reduce((s, f) => s + Number(f.additions ?? 0), 0)
  const deletions  = rawFiles.reduce((s, f) => s + Number(f.deletions ?? 0), 0)
  const filePaths  = rawFiles.map(f => String(f.path ?? f.filename ?? ''))
  const rollup     = raw.statusCheckRollup

  const signalDots = {
    tests:    testsSignal(filePaths),
    coverage: checkSignal(rollup, COVERAGE_NAMES),
    ci:       ciSignal(rollup),
    lint:     checkSignal(rollup, LINT_NAMES),
    churn:    churnSignal(additions + deletions, fileCount),
    blast:    blastSignal(fileCount),
  }

  const ciSt = ciSignal(rollup)
  const ciStatus = ciSt === 'pass' ? 'passing' : ciSt === 'fail' ? 'failing' : ciSt === 'warn' ? 'pending' : 'none'

  return {
    number:             Number(raw.number),
    title:              String(raw.title ?? ''),
    author:             String(raw.author?.login ?? ''),
    authorAvatarUrl:    String(raw.author?.avatarUrl ?? ''),
    openedAt:           String(raw.createdAt ?? ''),
    headRefName:        String(raw.headRefName ?? ''),
    baseRefName:        String(raw.baseRefName ?? ''),
    isDraft:            Boolean(raw.isDraft),
    ciStatus,
    fileCount,
    additions,
    deletions,
    estimatedMinutes:   Math.max(1, Math.ceil((additions + deletions) / 60)),
    riskLevel:          'low',
    signalDots,
    sessionStatus: 'not-started',
  }
}

// ─── CI/Lint/Coverage status helpers ─────────────────────────────────────────

function mapCiStatus(rollup) {
  if (!rollup || !Array.isArray(rollup) || rollup.length === 0) return 'none'
  const statuses = rollup.map(s => String(s.state ?? s.conclusion ?? ''))
  if (statuses.some(s => s === 'FAILURE' || s === 'failure')) return 'failing'
  if (statuses.some(s => s === 'PENDING' || s === 'in_progress' || s === 'pending')) return 'pending'
  if (statuses.every(s => s === 'SUCCESS' || s === 'success')) return 'passing'
  return 'none'
}

function mapCheckStatus(rollup, names) {
  if (!rollup || !Array.isArray(rollup) || rollup.length === 0) return 'unknown'
  const checks = rollup.filter(s => {
    const name = String(s.name ?? s.context ?? '').toLowerCase()
    return names.some(n => name.includes(n))
  })
  if (checks.length === 0) return 'unknown'
  const statuses = checks.map(s => String(s.state ?? s.conclusion ?? '').toUpperCase())
  if (statuses.some(s => s === 'FAILURE' || s === 'ERROR')) return 'fail'
  if (statuses.some(s => s === 'PENDING' || s === 'IN_PROGRESS')) return 'warn'
  if (statuses.every(s => s === 'SUCCESS')) return 'pass'
  return 'unknown'
}

async function readFileCoverage(repoRoot, filePath) {
  try {
    const summaryPath = join(repoRoot, 'coverage', 'coverage-summary.json')
    const raw = fs.readFileSync(summaryPath, 'utf-8')
    const summary = JSON.parse(raw)
    const candidates = [filePath, join(repoRoot, filePath), `./${filePath}`]
    for (const key of candidates) {
      if (summary[key] && summary[key].lines && summary[key].lines.pct != null) {
        return Math.round(summary[key].lines.pct)
      }
    }
    const match = Object.entries(summary).find(([k]) => k.endsWith(filePath))
    if (match) return Math.round((match[1] && match[1].lines && match[1].lines.pct) || 0)
  } catch { /* not found */ }

  try {
    const lcovPath = join(repoRoot, 'coverage', 'lcov.info')
    const raw = fs.readFileSync(lcovPath, 'utf-8')
    const sections = raw.split('end_of_record')
    for (const section of sections) {
      if (!section.includes(filePath)) continue
      const linesFound = Number((section.match(/LF:(\d+)/) || [])[1] || '0')
      const linesHit   = Number((section.match(/LH:(\d+)/) || [])[1] || '0')
      if (linesFound > 0) return Math.round((linesHit / linesFound) * 100)
    }
  } catch { /* not found */ }

  return null
}

// ─── Comment mapper ───────────────────────────────────────────────────────────

function mapComment(raw) {
  const user = raw.user ?? raw.author ?? {}
  const id = Number(raw.id)
  const inReplyTo = raw.in_reply_to_id != null ? Number(raw.in_reply_to_id) : null
  return {
    id,
    author:          String(user.login ?? ''),
    authorAvatarUrl: String(user.avatar_url ?? ''),
    body:            String(raw.body ?? ''),
    createdAt:       String(raw.created_at ?? ''),
    updatedAt:       String(raw.updated_at ?? ''),
    path:            String(raw.path ?? ''),
    line:            Number(raw.line ?? 0),
    startLine:       raw.start_line != null ? Number(raw.start_line) : null,
    side:            (String(raw.side ?? 'RIGHT').toUpperCase() === 'LEFT' ? 'LEFT' : 'RIGHT'),
    diffHunk:        String(raw.diff_hunk ?? ''),
    outdated:        Boolean(raw.outdated),
    threadId:        inReplyTo != null ? String(inReplyTo) : String(id),
    isReply:         inReplyTo != null,
    parentId:        inReplyTo,
  }
}

// ─── Session schema (Zod) ────────────────────────────────────────────────────

const ReviewSessionSchema = z.object({
  repoRoot:           z.string(),
  prNumber:           z.number(),
  headSHA:            z.string(),
  currentChapterId:   z.string().nullable(),
  currentFilePath:    z.string().nullable(),
  viewedFiles:        z.array(z.string()),
  fileOrderOverrides: z.record(z.string(), z.array(z.string())),
  scrollPosition:     z.number().nullable(),
  pausedAt:           z.string().nullable(),
  lastAccessedAt:     z.string(),
})

// ─── Session store ────────────────────────────────────────────────────────────

const sessionStore = new Store({ name: 'pr-review-sessions' })

// ─── Extension lifecycle ──────────────────────────────────────────────────────

const disposables = []
let refreshTimer = null

function activate(api) {
  const enabled = api.settings.get('terminator.git-integration.git.enabled') ?? true
  if (!enabled) return

  function register(channel, handler) {
    disposables.push(api.ipc.registerHandler(channel, handler))
  }

  // ─── Git IPC handlers ────────────────────────────────────────────────────

  register('git:status', async (payload) => {
    const schema = z.object({ path: z.string().min(1), maxFiles: z.number().int().positive().optional() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const maxFiles = parsed.data.maxFiles ?? 500
      const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain=v1', '-z'], {
        cwd: parsed.data.path, timeout: 10_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
      const branch = await runGit(parsed.data.path, ['branch', '--show-current']).catch(() => 'HEAD')
      const partial = parseGitStatus(statusOut, maxFiles)
      return { ...partial, branch: branch || 'HEAD' }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('git:diff-file', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), path: z.string().min(1), staged: z.boolean() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const args = parsed.data.staged
        ? ['diff', '--cached', '--unified=3', '--', parsed.data.path]
        : ['diff', '--unified=3', '--', parsed.data.path]
      const { stdout } = await execFileAsync('git', args, {
        cwd: parsed.data.repoRoot, timeout: 10_000, maxBuffer: 500 * 1024 + 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
      const diff = { ...parseGitDiff(stdout, 500 * 1024), path: parsed.data.path }
      return { diff }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('git:stage', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), paths: z.array(z.string()).min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      await runGit(parsed.data.repoRoot, ['add', '--', ...parsed.data.paths])
      return { success: true }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('git:unstage', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), paths: z.array(z.string()).min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      await runGit(parsed.data.repoRoot, ['restore', '--staged', '--', ...parsed.data.paths])
      return { success: true }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('git:commit', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), message: z.string(), signOff: z.boolean().optional() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    if (!parsed.data.message.trim()) return { error: 'EMPTY_MESSAGE' }
    try {
      const args = ['commit', '-m', parsed.data.message]
      if (parsed.data.signOff) args.push('--signoff')
      const output = await runGit(parsed.data.repoRoot, args)
      const match = output.match(/\[[\w/]+ ([a-f0-9]+)\]/)
      return { commitHash: (match && match[1]) || '' }
    } catch (e) {
      const msg = String(e)
      if (msg.includes('nothing to commit')) return { error: 'NOTHING_TO_COMMIT' }
      return { error: msg }
    }
  })

  register('git:pr-status', (_payload) => ({ pr: null }))
  register('git:pr-create', (_payload) => ({ error: 'NOT_IMPLEMENTED' }))

  // ─── GitHub IPC handlers ──────────────────────────────────────────────────

  register('github:list-open-prs', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const raw = await runGh(parsed.data.repoRoot, [
        'pr', 'list', '--state', 'open', '--limit', '500',
        '--json', 'number,title,author,createdAt,headRefName,baseRefName,isDraft,statusCheckRollup,files,additions,deletions',
      ])
      const items = JSON.parse(raw)
      const prs = items.map(item => parseReviewQueuePR(item))
      return { prs }
    } catch (e) {
      return parseRateLimit(e) || { error: String(e) }
    }
  })

  register('github:pr-review-detail', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), prNumber: z.number().int().positive() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber } = parsed.data
    try {
      const [metaRaw, filesRaw] = await Promise.all([
        runGh(repoRoot, ['pr', 'view', String(prNumber), '--json',
          'number,title,body,author,createdAt,headRefName,baseRefName,headRefOid,statusCheckRollup']),
        runGh(repoRoot, ['pr', 'view', String(prNumber), '--json', 'files']),
      ])
      const meta = JSON.parse(metaRaw)
      const filesData = JSON.parse(filesRaw).files
      const chapters = buildChapters(filesData)
      const rollup = meta.statusCheckRollup
      const pr = {
        number:          Number(meta.number),
        title:           String(meta.title ?? ''),
        body:            String(meta.body ?? ''),
        author:          String((meta.author && meta.author.login) || ''),
        authorAvatarUrl: String((meta.author && meta.author.avatarUrl) || ''),
        openedAt:        String(meta.createdAt ?? ''),
        headRefName:     String(meta.headRefName ?? ''),
        baseRefName:     String(meta.baseRefName ?? ''),
        headSHA:         String(meta.headRefOid ?? ''),
        ciStatus:        mapCiStatus(rollup),
        lintStatus:      mapCheckStatus(rollup, LINT_CHECK_NAMES),
        coverageStatus:  mapCheckStatus(rollup, COVERAGE_CHECK_NAMES),
        chapters,
      }
      return { pr }
    } catch (e) {
      return parseRateLimit(e) || { error: String(e) }
    }
  })

  register('github:pr-file-diff', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      prNumber: z.number().int().positive(),
      path:     z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber, path } = parsed.data
    try {
      const prRef = `refs/remotes/pull/${prNumber}/head`
      await runGit(repoRoot, ['fetch', 'origin', `pull/${prNumber}/head:${prRef}`])

      const baseRefName = (await runGh(repoRoot, [
        'pr', 'view', String(prNumber), '--json', 'baseRefName', '--jq', '.baseRefName',
      ])).trim()

      const mergeBase = await runGit(repoRoot, [
        'merge-base', `origin/${baseRefName}`, prRef,
      ])

      const diffRaw = await runGit(repoRoot, [
        'diff', `${mergeBase.trim()}...${prRef}`, '--', path,
      ])
      const diff = parsePrDiff(diffRaw, path)
      return { diff }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('github:file-metrics', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), path: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, path } = parsed.data
    try {
      const stem = basename(path, `.${basename(path).split('.').pop()}`)
      const [churnRaw, blastRaw, testRaw] = await Promise.all([
        runGit(repoRoot, ['log', '--oneline', '--since=90 days ago', '--', path]),
        runGit(repoRoot, ['grep', '-l', basename(path).replace(/\.[^.]+$/, ''), '--']).catch(() => ''),
        runGit(repoRoot, ['ls-files', '--', `**/${stem}*.spec.*`, `**/${stem}*.test.*`]).catch(() => ''),
      ])
      const churn90d = churnRaw ? churnRaw.split('\n').filter(Boolean).length : 0
      const importerLines = blastRaw ? blastRaw.split('\n').filter(Boolean).filter(l => l !== path) : []
      const blastRadius = importerLines.length
      const topImporters = importerLines.slice(0, 5)
      const importerCount = importerLines.length
      const testFilePresent = testRaw ? testRaw.trim().length > 0 : false
      const patchCoverage = await readFileCoverage(repoRoot, path)
      return { churn90d, blastRadius, topImporters, importerCount, testFilePresent, patchCoverage }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('github:pr-inline-comments', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1), prNumber: z.number().int().positive() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber } = parsed.data
    try {
      const raw = await runGh(repoRoot, [
        'api', `repos/{owner}/{repo}/pulls/${prNumber}/comments`,
        '--paginate',
        '--jq', '[.[] | {id,user,body,created_at,updated_at,path,line,start_line,side,diff_hunk,in_reply_to_id,pull_request_review_id}]',
      ])
      const items = JSON.parse(raw)
      const comments = items.map(mapComment)
      return { comments }
    } catch (e) {
      return parseRateLimit(e) || { error: String(e) }
    }
  })

  register('github:pr-comment-add', async (payload) => {
    const schema = z.object({
      repoRoot:  z.string().min(1),
      prNumber:  z.number().int().positive(),
      commitId:  z.string().min(1),
      path:      z.string().min(1),
      line:      z.number().int().positive(),
      startLine: z.number().int().positive().optional(),
      side:      z.enum(['LEFT', 'RIGHT']),
      body:      z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber, commitId, path, line, startLine, side, body } = parsed.data
    try {
      const args = [
        'api', `repos/{owner}/{repo}/pulls/${prNumber}/comments`,
        '--method', 'POST',
        '--field', `commit_id=${commitId}`,
        '--field', `path=${path}`,
        '--field', `line=${line}`,
        '--field', `side=${side}`,
        '--field', `body=${body}`,
      ]
      if (startLine != null) {
        args.push('--field', `start_line=${startLine}`, '--field', `start_side=${side}`)
      }
      const raw = await runGh(repoRoot, args)
      const comment = mapComment(JSON.parse(raw))
      return { comment }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('github:pr-comment-reply', async (payload) => {
    const schema = z.object({
      repoRoot:    z.string().min(1),
      prNumber:    z.number().int().positive(),
      inReplyToId: z.number().int().positive(),
      body:        z.string().min(1),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber, inReplyToId, body } = parsed.data
    try {
      const raw = await runGh(repoRoot, [
        'api', `repos/{owner}/{repo}/pulls/${prNumber}/comments`,
        '--method', 'POST',
        '--field', `in_reply_to_id=${inReplyToId}`,
        '--field', `body=${body}`,
      ])
      const comment = mapComment(JSON.parse(raw))
      return { comment }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('github:pr-review-submit', async (payload) => {
    const schema = z.object({
      repoRoot: z.string().min(1),
      prNumber: z.number().int().positive(),
      commitId: z.string().min(1),
      event:    z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
      body:     z.string(),
    })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const { repoRoot, prNumber, commitId, event, body } = parsed.data
    try {
      const raw = await runGh(repoRoot, [
        'api', `repos/{owner}/{repo}/pulls/${prNumber}/reviews`,
        '--method', 'POST',
        '--field', `commit_id=${commitId}`,
        '--field', `event=${event}`,
        '--field', `body=${body}`,
      ])
      const data = JSON.parse(raw)
      return { reviewId: Number(data.id) }
    } catch (e) {
      return { error: String(e) }
    }
  })

  register('github:session-get', (payload) => {
    const schema = z.object({ key: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { session: null }
    const raw = sessionStore.get(parsed.data.key)
    if (!raw) return { session: null }
    const result = ReviewSessionSchema.safeParse(raw)
    return result.success ? { session: result.data } : { session: null }
  })

  register('github:session-set', (payload) => {
    const schema = z.object({ key: z.string().min(1), session: z.unknown() })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const result = ReviewSessionSchema.safeParse(parsed.data.session)
    if (!result.success) return { error: 'VALIDATION_ERROR' }
    try {
      sessionStore.set(parsed.data.key, result.data)
      return { ok: true }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // ─── Settings ─────────────────────────────────────────────────────────────

  disposables.push(
    api.settings.register({
      label: 'Git Integration',
      properties: {
        'terminator.git-integration.git.enabled': {
          type: 'boolean',
          label: 'Enable Git Integration',
          default: true,
          workspaceScoped: true,
        },
        'terminator.git-integration.git.sidebar.defaultOpen': {
          type: 'boolean',
          label: 'Open sidebar by default',
          default: false,
          workspaceScoped: true,
        },
        'terminator.git-integration.git.sidebar.refreshIntervalMs': {
          type: 'number',
          label: 'Sidebar refresh interval (ms)',
          default: 3000,
          min: 500,
          max: 60000,
          workspaceScoped: true,
        },
        'terminator.git-integration.git.ghCliPath': {
          type: 'string',
          label: 'gh CLI path',
          description: 'Path to the gh binary. Leave empty to use system PATH.',
          default: '',
        },
        'terminator.git-integration.git.commit.signOff': {
          type: 'boolean',
          label: 'Add sign-off to commits',
          default: false,
          workspaceScoped: true,
        },
        'terminator.git-integration.git.maxDisplayedFiles': {
          type: 'number',
          label: 'Max displayed changed files',
          default: 500,
          min: 10,
          max: 5000,
        },
      },
    })
  )

  // ─── Sidebar item ──────────────────────────────────────────────────────────

  disposables.push(
    api.sidebar.registerItem({
      id: 'git-sidebar-toggle',
      label: 'Git Changes',
      tooltip: 'Toggle Git Changes sidebar',
      onClick: () => sendToRenderer('extension:toggle-panel', { panelId: 'git-changes' }),
    })
  )

  // ─── Native menu ───────────────────────────────────────────────────────────

  try {
    disposables.push(
      api.nativeMenu.addViewMenuItem({
        id: 'git-sidebar-toggle',
        label: 'Toggle Git Sidebar',
        accelerator: 'CmdOrCtrl+Shift+G',
        onClick: () => sendToRenderer('extension:toggle-panel', { panelId: 'git-changes' }),
      })
    )
  } catch {
    // Menu may not be available in test environments
  }

  // ─── Top bar menu items ────────────────────────────────────────────────────

  disposables.push(
    api.topBar.registerMenuItem({
      id: 'git-view',
      label: 'Git',
      tooltip: 'Open Git view',
      onClick: () => sendToRenderer('extension:select-project-tab', { tabId: 'git' }),
    })
  )

  disposables.push(
    api.topBar.registerMenuItem({
      id: 'pr-review-view',
      label: 'Code Reviews',
      tooltip: 'Open PR Code Review view',
      onClick: () => sendToRenderer('extension:select-project-tab', { tabId: 'pr-review' }),
    })
  )

  // ─── FS watch ──────────────────────────────────────────────────────────────

  disposables.push(
    api.fs.watch((event) => {
      sendToRenderer('git:fs-changed', event)
    })
  )
}

function deactivate() {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  disposables.forEach((d) => {
    try { d.dispose() } catch { /* ignore */ }
  })
  disposables.length = 0
}

module.exports = { activate, deactivate }
