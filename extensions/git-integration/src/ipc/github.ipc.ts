import { z } from 'zod'
import Store from 'electron-store'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { basename } from 'path'
import type { ReviewQueuePR, PrReviewDetail, InlineComment } from '../schemas/pr-review.schema.js'
import { ReviewSessionSchema } from '../schemas/pr-review.schema.js'
import { buildChapters, parseReviewQueuePR } from '../github/pr-review-service.js'
import type { FileDiff } from '../schemas/git.schema.js'
import { FileDiffSchema } from '../schemas/git.schema.js'

const execFileAsync = promisify(execFile)

type RegisterFn = (channel: string, handler: (payload: unknown) => Promise<unknown> | unknown) => void

const sessionStore = new Store<Record<string, unknown>>({ name: 'pr-review-sessions' })

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function runGh(cwd: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync('gh', args, { cwd, timeout: 30_000 })
  if (stderr && !stdout) throw new Error(stderr)
  return stdout.trim()
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 30_000 })
  return stdout.trim()
}

function parseRateLimit(err: unknown): { error: 'RATE_LIMITED'; resetAt: number } | null {
  const msg = String(err)
  if (msg.includes('rate limit') || msg.includes('API rate limit')) {
    return { error: 'RATE_LIMITED', resetAt: Date.now() + 60_000 }
  }
  return null
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerGithubHandlers(register: RegisterFn): void {

  register('github:list-open-prs', async (payload) => {
    const schema = z.object({ repoRoot: z.string().min(1) })
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    try {
      const raw = await runGh(parsed.data.repoRoot, [
        'pr', 'list', '--state', 'open', '--limit', '500',
        '--json', 'number,title,author,createdAt,headRefName,baseRefName,isDraft,statusCheckRollup,files,additions,deletions',
      ])
      const items = JSON.parse(raw) as unknown[]
      const prs: ReviewQueuePR[] = items.map(item => parseReviewQueuePR(item))
      return { prs }
    } catch (e) {
      return parseRateLimit(e) ?? { error: String(e) }
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
      const meta = JSON.parse(metaRaw) as Record<string, unknown>
      const filesData = (JSON.parse(filesRaw) as { files: unknown[] }).files
      const chapters = buildChapters(filesData)
      const pr: PrReviewDetail = {
        number:          Number(meta.number),
        title:           String(meta.title ?? ''),
        body:            String(meta.body ?? ''),
        author:          String((meta.author as Record<string,unknown>)?.login ?? ''),
        authorAvatarUrl: String((meta.author as Record<string,unknown>)?.avatarUrl ?? ''),
        openedAt:        String(meta.createdAt ?? ''),
        headRefName:     String(meta.headRefName ?? ''),
        baseRefName:     String(meta.baseRefName ?? ''),
        headSHA:         String(meta.headRefOid ?? ''),
        ciStatus:        mapCiStatus(meta.statusCheckRollup),
        chapters,
      }
      return { pr }
    } catch (e) {
      return parseRateLimit(e) ?? { error: String(e) }
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
      const diff = parseDiff(diffRaw, path)
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
      const [churnRaw, blastRaw, testRaw] = await Promise.all([
        runGit(repoRoot, ['log', '--oneline', '--since=90 days ago', '--', path]),
        runGit(repoRoot, ['grep', '-l', basename(path).replace(/\.[^.]+$/, ''), '--']).catch(() => ''),
        runGit(repoRoot, ['ls-files', '--', `**/${basename(path, `.${basename(path).split('.').pop()}`)}*.spec.*`,
          `**/${basename(path, `.${basename(path).split('.').pop()}`)}*.test.*`]).catch(() => ''),
      ])
      const churn90d = churnRaw ? churnRaw.split('\n').filter(Boolean).length : 0
      const importerLines = blastRaw ? blastRaw.split('\n').filter(Boolean).filter(l => l !== path) : []
      const blastRadius = importerLines.length
      const topImporters = importerLines.slice(0, 5)
      const importerCount = importerLines.length
      const testFilePresent = testRaw ? testRaw.trim().length > 0 : false
      return { churn90d, blastRadius, topImporters, importerCount, testFilePresent }
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
      const items = JSON.parse(raw) as unknown[]
      const comments: InlineComment[] = items.map(mapComment)
      return { comments }
    } catch (e) {
      return parseRateLimit(e) ?? { error: String(e) }
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
      repoRoot:     z.string().min(1),
      prNumber:     z.number().int().positive(),
      inReplyToId:  z.number().int().positive(),
      body:         z.string().min(1),
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
      const data = JSON.parse(raw) as Record<string, unknown>
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
      return { ok: true as const }
    } catch (e) {
      return { error: String(e) }
    }
  })
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function mapCiStatus(rollup: unknown): 'passing' | 'failing' | 'pending' | 'none' {
  if (!rollup || !Array.isArray(rollup) || rollup.length === 0) return 'none'
  const statuses = (rollup as Array<Record<string, unknown>>).map(s => String(s.state ?? s.conclusion ?? ''))
  if (statuses.some(s => s === 'FAILURE' || s === 'failure')) return 'failing'
  if (statuses.some(s => s === 'PENDING' || s === 'in_progress' || s === 'pending')) return 'pending'
  if (statuses.every(s => s === 'SUCCESS' || s === 'success')) return 'passing'
  return 'none'
}

function mapComment(raw: unknown): InlineComment {
  const obj = raw as Record<string, unknown>
  const user = (obj.user ?? obj.author ?? {}) as Record<string, unknown>
  const id = Number(obj.id)
  const inReplyTo = obj.in_reply_to_id != null ? Number(obj.in_reply_to_id) : null
  return {
    id,
    author:          String(user.login ?? ''),
    authorAvatarUrl: String(user.avatar_url ?? ''),
    body:            String(obj.body ?? ''),
    createdAt:       String(obj.created_at ?? ''),
    updatedAt:       String(obj.updated_at ?? ''),
    path:            String(obj.path ?? ''),
    line:            Number(obj.line ?? 0),
    startLine:       obj.start_line != null ? Number(obj.start_line) : null,
    side:            (String(obj.side ?? 'RIGHT').toUpperCase() === 'LEFT' ? 'LEFT' : 'RIGHT') as 'LEFT' | 'RIGHT',
    diffHunk:        String(obj.diff_hunk ?? ''),
    outdated:        Boolean(obj.outdated),
    threadId:        inReplyTo != null ? String(inReplyTo) : String(id),
    isReply:         inReplyTo != null,
    parentId:        inReplyTo,
  }
}

function parseDiff(raw: string, filePath: string): FileDiff {
  if (!raw.trim()) {
    return { path: filePath, hunks: [], isBinary: false }
  }
  if (raw.includes('Binary files')) {
    return { path: filePath, hunks: [], isBinary: true }
  }

  const hunks: FileDiff['hunks'] = []
  let currentHunk: FileDiff['hunks'][0] | null = null

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
      if (dl.type === 'add') {
        dl.newLineNumber = newN++
      } else if (dl.type === 'remove') {
        dl.oldLineNumber = oldN++
      } else {
        dl.oldLineNumber = oldN++
        dl.newLineNumber = newN++
      }
    }
  }

  const result = FileDiffSchema.safeParse({ path: filePath, hunks, isBinary: false })
  return result.success ? result.data : { path: filePath, hunks, isBinary: false }
}
