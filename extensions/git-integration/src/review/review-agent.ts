import { execFile as execFileCb, spawn as spawnCb } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import {
  AgentOutputSchema,
  FINDING_SEVERITIES,
  type AgentFinding,
  type AgentOutput,
  type AgentRun,
  type AgentScope,
} from '../schemas/review-agent.schema.js'

const execFileAsync = promisify(execFileCb)

const DIFF_TIMEOUT = 30_000
const DIFF_CAP_BYTES = 200 * 1024
const DEFAULT_TIMEOUT_MS = 5 * 60_000

export type ExecFn = (
  cmd: string,
  args: string[],
  opts: { cwd?: string }
) => Promise<{ stdout: string; stderr?: string }>

async function defaultExec(cmd: string, args: string[], opts: { cwd?: string }) {
  return execFileAsync(cmd, args, {
    cwd: opts.cwd,
    timeout: DIFF_TIMEOUT,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

/** Minimal shape a spawned `claude` child needs — real ChildProcess satisfies this. */
export interface SpawnedProcess {
  stdin: { write(data: string): void; end(): void }
  stdout: { on(event: 'data', cb: (d: Buffer | string) => void): void }
  stderr: { on(event: 'data', cb: (d: Buffer | string) => void): void }
  on(event: 'exit', cb: (code: number | null) => void): void
  on(event: 'error', cb: (err: Error) => void): void
  kill(signal?: string): void
}

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string> }
) => SpawnedProcess

function defaultSpawn(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string> }
): SpawnedProcess {
  return spawnCb(cmd, args, { cwd: opts.cwd, env: opts.env }) as unknown as SpawnedProcess
}

/** The last absolute path in a shell's `command -v` output; rc files may print before it. */
export function claudeFromShellOutput(stdout: string): string | null {
  const paths = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('/'))
  return paths.at(-1) ?? null
}

let resolvedClaude: string | undefined

/**
 * An app launched from the Dock inherits PATH=/usr/bin:/bin, so a bare `claude`
 * is not found. Ask the person's interactive login shell, the one their
 * terminal runs, where it is. Only a hit is cached, so installing claude later
 * needs no restart.
 */
async function defaultResolveClaude(): Promise<string> {
  if (resolvedClaude) return resolvedClaude
  try {
    const { stdout } = await execFileAsync(
      process.env.SHELL || '/bin/zsh',
      ['-ilc', 'command -v claude'],
      { timeout: 10_000 }
    )
    const found = claudeFromShellOutput(stdout)
    if (found) resolvedClaude = found
    return found ?? 'claude'
  } catch {
    return 'claude'
  }
}

// ─── Prompt ────────────────────────────────────────────────────────────────

export interface BuildAgentPromptInput {
  scope: AgentScope
  request: 'review' | 'explain' | 'ask'
  question?: string | null
  pr: { number: number; title: string; body: string; headSHA: string }
  diffText: string
  truncated?: boolean
}

function describeScope(scope: AgentScope): string {
  switch (scope.kind) {
    case 'lines':
      return `lines ${scope.startLine ?? '?'}-${scope.endLine ?? '?'} of ${scope.path ?? 'the file'}`
    case 'hunk':
      return `the hunk touching ${scope.path ?? 'the file'} around lines ${scope.startLine ?? '?'}-${scope.endLine ?? '?'}`
    case 'file':
      return `the whole file ${scope.path ?? ''}`
    case 'chapter':
      return `the chapter "${scope.chapter ?? ''}"`
    case 'pr':
      return 'the whole pull request'
  }
}

export function buildAgentPrompt(input: BuildAgentPromptInput): string {
  const severities = FINDING_SEVERITIES.join(', ')
  const lines: string[] = []
  lines.push(`You are reviewing pull request #${input.pr.number}: ${input.pr.title}`)
  if (input.pr.body) {
    lines.push('')
    lines.push('PR description:')
    lines.push(input.pr.body)
  }
  lines.push('')
  lines.push(
    'This is a READ-ONLY review. You must not modify any files, run any write or network ' +
      'command, and you must not post anywhere — your output is a JSON object the caller ' +
      'renders privately. You only have Read, Grep and Glob.'
  )
  lines.push('')
  lines.push(
    `Scope: ${describeScope(input.scope)}, at PR head ${input.pr.headSHA}, in a private worktree.`
  )
  lines.push(
    `Cite every finding by its file path and the line number(s) on the new side of the diff ` +
      `(the side after this change), unless the finding is specifically about a deleted line.`
  )
  lines.push(`Use these severities exactly, and only these: ${severities}.`)

  if (input.request === 'explain') {
    lines.push(
      'The requester wants an explanation, not a review: findings may be empty and the ' +
        'explanation belongs in the summary.'
    )
  }
  if (input.request === 'ask' && input.question) {
    lines.push(`The requester asked: ${input.question}`)
  }
  if (input.scope.kind === 'pr') {
    lines.push(
      'Also produce a walkthrough: one entry per chapter (a logical grouping of the changed ' +
        'files), each explaining what the change is, then its consequences.'
    )
  }
  if (input.truncated) {
    lines.push(
      'The diff below was truncated to fit a size limit — note this in your summary if it ' +
        'limits what you could review.'
    )
  }
  lines.push('')
  lines.push('Diff:')
  lines.push(input.diffText)
  return lines.join('\n')
}

// ─── JSON schema ───────────────────────────────────────────────────────────

export function buildAgentJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'findings'],
    properties: {
      summary: { type: 'string' },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['severity', 'path', 'startLine', 'endLine', 'title', 'body'],
          properties: {
            severity: { type: 'string', enum: [...FINDING_SEVERITIES] },
            path: { type: 'string' },
            startLine: { type: 'number' },
            endLine: { type: 'number' },
            side: { type: 'string', enum: ['LEFT', 'RIGHT'] },
            title: { type: 'string' },
            body: { type: 'string' },
            suggestedCode: { type: ['string', 'null'] },
          },
        },
      },
      walkthrough: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['chapter', 'text'],
          properties: {
            chapter: { type: 'string' },
            text: { type: 'string' },
          },
        },
      },
    },
  }
}

// ─── claude CLI args ───────────────────────────────────────────────────────

export interface BuildClaudeArgsInput {
  sessionId: string
  model: string
  effort?: string
  schemaJson: string
}

export function buildClaudeArgs(input: BuildClaudeArgsInput): string[] {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    input.schemaJson,
    '--tools',
    'Read,Grep,Glob',
    '--session-id',
    input.sessionId,
    '--model',
    input.model,
  ]
  if (input.effort) args.push('--effort', input.effort)
  return args
}

// ─── Diff text ─────────────────────────────────────────────────────────────

/** Keeps only hunks whose new-side range overlaps [startLine, endLine]. */
function filterHunksByRange(diffText: string, startLine: number, endLine: number): string {
  const lines = diffText.split('\n')
  const out: string[] = []
  let inHeader = true
  let currentHunk: string[] = []
  let keepCurrent = false

  const flush = () => {
    if (currentHunk.length && keepCurrent) out.push(...currentHunk)
    currentHunk = []
  }

  for (const line of lines) {
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (m) {
      flush()
      const newStart = parseInt(m[1], 10)
      const newCount = m[2] !== undefined ? parseInt(m[2], 10) : 1
      const newEnd = newStart + Math.max(newCount, 1) - 1
      keepCurrent = newEnd >= startLine && newStart <= endLine
      currentHunk = [line]
      inHeader = false
      continue
    }
    if (inHeader) out.push(line)
    else currentHunk.push(line)
  }
  flush()
  return out.join('\n')
}

export async function buildDiffText(
  worktreePath: string,
  baseRefName: string,
  headSHA: string,
  scope: AgentScope,
  exec: ExecFn = defaultExec
): Promise<{ diffText: string; truncated: boolean }> {
  await exec('git', ['fetch', 'origin', baseRefName], { cwd: worktreePath }).catch(() => {})
  const range = `origin/${baseRefName}...${headSHA}`
  const useContext = scope.kind === 'lines' || scope.kind === 'hunk'

  const args = ['diff']
  if (useContext) args.push('--unified=20')
  args.push(range)
  if ((scope.kind === 'file' || scope.kind === 'chapter' || useContext) && scope.path) {
    args.push('--', scope.path)
  }

  const { stdout } = await exec('git', args, { cwd: worktreePath })
  let diffText = stdout
  if (useContext && scope.startLine != null && scope.endLine != null) {
    diffText = filterHunksByRange(diffText, scope.startLine, scope.endLine)
  }

  let truncated = false
  if (Buffer.byteLength(diffText, 'utf8') > DIFF_CAP_BYTES) {
    diffText = diffText.slice(0, DIFF_CAP_BYTES)
    truncated = true
  }
  return { diffText, truncated }
}

// ─── Run ───────────────────────────────────────────────────────────────────

export interface RunAgentReviewInput {
  repoRoot: string
  worktreePath: string
  prNumber: number
  headSHA: string
  baseRefName: string
  title: string
  body: string
  scope: AgentScope
  request: 'review' | 'explain' | 'ask'
  question?: string | null
  sessionId: string
  model: string
  effort?: string
  timeoutMs?: number
}

export interface RunAgentReviewDeps {
  spawn?: SpawnFn
  exec?: ExecFn
  resolveClaude?: () => Promise<string>
}

export interface RunAgentReviewResult {
  runId: string
  done: Promise<AgentRun>
  cancel: () => void
}

function baseFields(
  input: RunAgentReviewInput,
  runId: string,
  startedAt: string,
  activity: string[]
) {
  return {
    id: runId,
    repoRoot: input.repoRoot,
    prNumber: input.prNumber,
    headSHA: input.headSHA,
    sessionId: input.sessionId,
    scope: input.scope,
    request: input.request,
    question: input.question ?? null,
    startedAt,
    activity,
  }
}

function failedRun(
  input: RunAgentReviewInput,
  runId: string,
  startedAt: string,
  activity: string[],
  error: string
): AgentRun {
  return {
    ...baseFields(input, runId, startedAt, activity),
    status: 'failed',
    finishedAt: new Date().toISOString(),
    summary: null,
    findings: [],
    walkthrough: [],
    error,
  }
}

function cancelledRun(
  input: RunAgentReviewInput,
  runId: string,
  startedAt: string,
  activity: string[]
): AgentRun {
  return {
    ...baseFields(input, runId, startedAt, activity),
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
    summary: null,
    findings: [],
    walkthrough: [],
    error: null,
  }
}

function doneRun(
  input: RunAgentReviewInput,
  runId: string,
  startedAt: string,
  activity: string[],
  output: AgentOutput
): AgentRun {
  const findings: AgentFinding[] = output.findings.map((f) => ({
    id: randomUUID(),
    severity: f.severity,
    path: f.path,
    startLine: f.startLine,
    endLine: f.endLine,
    side: f.side ?? 'RIGHT',
    title: f.title,
    body: f.body,
    suggestedCode: f.suggestedCode ?? null,
    dismissed: false,
  }))
  return {
    ...baseFields(input, runId, startedAt, activity),
    status: 'done',
    finishedAt: new Date().toISOString(),
    summary: output.summary,
    findings,
    walkthrough: output.walkthrough ?? [],
    error: null,
  }
}

/** Scrubs a parent Claude session's env vars so the child doesn't join its bridge and hang. */
function scrubbedEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) continue
    env[k] = v
  }
  return env
}

function parseStructuredOutput(stdout: string): unknown {
  const parsed = JSON.parse(stdout) as { structured_output?: unknown; result?: unknown }
  if (parsed.structured_output !== undefined) return parsed.structured_output
  if (typeof parsed.result === 'string') return JSON.parse(parsed.result)
  return parsed.result
}

export function runAgentReview(
  input: RunAgentReviewInput,
  deps: RunAgentReviewDeps = {}
): RunAgentReviewResult {
  const runId = randomUUID()
  const exec = deps.exec ?? defaultExec
  const spawnFn = deps.spawn ?? defaultSpawn
  const startedAt = new Date().toISOString()
  const activity: string[] = []
  let cancelled = false
  let proc: SpawnedProcess | undefined

  const done = (async (): Promise<AgentRun> => {
    let diffText = ''
    let truncated = false
    try {
      const diff = await buildDiffText(
        input.worktreePath,
        input.baseRefName,
        input.headSHA,
        input.scope,
        exec
      )
      diffText = diff.diffText
      truncated = diff.truncated
    } catch (e) {
      return failedRun(input, runId, startedAt, activity, `Could not compute diff: ${String(e)}`)
    }

    if (cancelled) return cancelledRun(input, runId, startedAt, activity)

    const prompt = buildAgentPrompt({
      scope: input.scope,
      request: input.request,
      question: input.question,
      pr: { number: input.prNumber, title: input.title, body: input.body, headSHA: input.headSHA },
      diffText,
      truncated,
    })
    const schemaJson = JSON.stringify(buildAgentJsonSchema())
    const args = buildClaudeArgs({
      sessionId: input.sessionId,
      model: input.model,
      effort: input.effort,
      schemaJson,
    })
    const env = scrubbedEnv()
    const claudePath = await (deps.resolveClaude ?? defaultResolveClaude)()
    if (cancelled) return cancelledRun(input, runId, startedAt, activity)

    return await new Promise<AgentRun>((resolve) => {
      let stdout = ''
      let stderr = ''
      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const child = spawnFn(claudePath, args, { cwd: input.worktreePath, env })
      proc = child

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve(failedRun(input, runId, startedAt, activity, 'Timed out after 5 min'))
      }, timeoutMs)

      try {
        child.stdin.write(prompt)
        child.stdin.end()
      } catch {
        // handled by the 'error' listener below
      }

      child.stdout.on('data', (d) => {
        stdout += d.toString()
      })
      child.stderr.on('data', (d) => {
        stderr += d.toString()
      })
      child.on('error', (e) => {
        clearTimeout(timer)
        resolve(
          failedRun(input, runId, startedAt, activity, `Failed to start claude: ${String(e)}`)
        )
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        if (cancelled) {
          resolve(cancelledRun(input, runId, startedAt, activity))
          return
        }
        if (code !== 0) {
          resolve(
            failedRun(
              input,
              runId,
              startedAt,
              activity,
              stderr.trim() || `claude exited with code ${code}`
            )
          )
          return
        }
        try {
          const structured = parseStructuredOutput(stdout)
          const output = AgentOutputSchema.parse(structured)
          resolve(doneRun(input, runId, startedAt, activity, output))
        } catch (e) {
          resolve(
            failedRun(
              input,
              runId,
              startedAt,
              activity,
              `Could not parse agent output: ${String(e)}`
            )
          )
        }
      })
    })
  })()

  return {
    runId,
    done,
    cancel: () => {
      cancelled = true
      proc?.kill('SIGKILL')
    },
  }
}
