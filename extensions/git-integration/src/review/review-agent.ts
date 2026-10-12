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
import { runGit } from '../shell/run-git.js'

// Only for finding and running `claude`, which is not a command shell.exec runs.
const execFileAsync = promisify(execFileCb)

const DIFF_CAP_BYTES = 200 * 1024
const DEFAULT_TIMEOUT_MS = 5 * 60_000

export type ExecFn = (
  cmd: 'git',
  args: string[],
  opts: { cwd: string }
) => Promise<{ stdout: string; stderr?: string }>

const defaultExec: ExecFn = async (_cmd, args, opts) => ({
  stdout: await runGit(opts.cwd, args, { raw: true, maxBuffer: 20 * 1024 * 1024 }),
})

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

const READ_ONLY_RULE =
  'This is a READ-ONLY review. You must not modify any files, run any write or network ' +
  'command, and you must not post anywhere — your output is a JSON object the caller ' +
  'renders privately. You only have Read, Grep and Glob.'

const CITATION_RULE =
  `Cite every finding by its file path and the line number(s) on the new side of the diff ` +
  `(the side after this change), unless the finding is specifically about a deleted line.`

const EXPLAIN_NOTE =
  'The requester wants an explanation, not a review: findings may be empty and the ' +
  'explanation belongs in the summary.'

const WALKTHROUGH_NOTE =
  'Also produce a walkthrough: one entry per chapter (a logical grouping of the changed ' +
  'files), each explaining what the change is, then its consequences.'

const TRUNCATED_NOTE =
  'The diff below was truncated to fit a size limit — note this in your summary if it ' +
  'limits what you could review.'

function lineRangeOf(scope: AgentScope): string {
  return `${scope.startLine ?? '?'}-${scope.endLine ?? '?'}`
}

function describeScope(scope: AgentScope): string {
  const file = scope.path ?? 'the file'
  switch (scope.kind) {
    case 'lines':
      return `lines ${lineRangeOf(scope)} of ${file}`
    case 'hunk':
      return `the hunk touching ${file} around lines ${lineRangeOf(scope)}`
    case 'file':
      return `the whole file ${scope.path ?? ''}`
    case 'chapter':
      return `the chapter "${scope.chapter ?? ''}"`
    case 'pr':
      return 'the whole pull request'
  }
}

function promptIntro(input: BuildAgentPromptInput): string[] {
  const lines = [`You are reviewing pull request #${input.pr.number}: ${input.pr.title}`]
  if (input.pr.body) lines.push('', 'PR description:', input.pr.body)
  return lines
}

function requestNotes(input: BuildAgentPromptInput): string[] {
  const notes: string[] = []
  if (input.request === 'explain') notes.push(EXPLAIN_NOTE)
  if (input.request === 'ask' && input.question) {
    notes.push(`The requester asked: ${input.question}`)
  }
  if (input.scope.kind === 'pr') notes.push(WALKTHROUGH_NOTE)
  if (input.truncated) notes.push(TRUNCATED_NOTE)
  return notes
}

export function buildAgentPrompt(input: BuildAgentPromptInput): string {
  const scopeLine = `Scope: ${describeScope(input.scope)}, at PR head ${input.pr.headSHA}, in a private worktree.`
  const severities = `Use these severities exactly, and only these: ${FINDING_SEVERITIES.join(', ')}.`
  return [
    ...promptIntro(input),
    '',
    READ_ONLY_RULE,
    '',
    scopeLine,
    CITATION_RULE,
    severities,
    ...requestNotes(input),
    '',
    'Diff:',
    input.diffText,
  ].join('\n')
}

// ─── JSON schema ───────────────────────────────────────────────────────────

function findingJsonSchema(): Record<string, unknown> {
  return {
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
  }
}

function walkthroughEntryJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['chapter', 'text'],
    properties: {
      chapter: { type: 'string' },
      text: { type: 'string' },
    },
  }
}

export function buildAgentJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'findings'],
    properties: {
      summary: { type: 'string' },
      findings: { type: 'array', items: findingJsonSchema() },
      walkthrough: { type: 'array', items: walkthroughEntryJsonSchema() },
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

/** Where to diff: the PR's worktree, its base branch and head, narrowed to `scope`. */
export interface DiffTarget {
  worktreePath: string
  baseRefName: string
  headSHA: string
  scope: AgentScope
}

const HUNK_RANGE_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/** The new-side line range a hunk header covers; null for a line that is not a hunk header. */
function newSideRange(line: string): { start: number; end: number } | null {
  const m = line.match(HUNK_RANGE_RE)
  if (!m) return null
  const start = parseInt(m[1], 10)
  const count = m[2] !== undefined ? parseInt(m[2], 10) : 1
  return { start, end: start + Math.max(count, 1) - 1 }
}

/** Keeps the file headers and only the hunks whose new-side range overlaps [startLine, endLine]. */
function filterHunksByRange(diffText: string, startLine: number, endLine: number): string {
  const kept: string[] = []
  let keepingHunk = true
  for (const line of diffText.split('\n')) {
    const range = newSideRange(line)
    if (range) keepingHunk = range.end >= startLine && range.start <= endLine
    if (keepingHunk) kept.push(line)
  }
  return kept.join('\n')
}

function usesContext(scope: AgentScope): boolean {
  return scope.kind === 'lines' || scope.kind === 'hunk'
}

function diffArgsFor(target: DiffTarget): string[] {
  const { scope } = target
  const args = ['diff']
  if (usesContext(scope)) args.push('--unified=20')
  args.push(`origin/${target.baseRefName}...${target.headSHA}`)
  const narrowsToPath = scope.kind === 'file' || scope.kind === 'chapter' || usesContext(scope)
  if (narrowsToPath && scope.path) args.push('--', scope.path)
  return args
}

function cappedDiff(diffText: string): { diffText: string; truncated: boolean } {
  if (Buffer.byteLength(diffText, 'utf8') <= DIFF_CAP_BYTES) return { diffText, truncated: false }
  return { diffText: diffText.slice(0, DIFF_CAP_BYTES), truncated: true }
}

export async function buildDiffText(
  target: DiffTarget,
  exec: ExecFn = defaultExec
): Promise<{ diffText: string; truncated: boolean }> {
  const cwd = target.worktreePath
  await exec('git', ['fetch', 'origin', target.baseRefName], { cwd }).catch(() => {})
  const { stdout } = await exec('git', diffArgsFor(target), { cwd })
  const { scope } = target
  if (usesContext(scope) && scope.startLine != null && scope.endLine != null) {
    return cappedDiff(filterHunksByRange(stdout, scope.startLine, scope.endLine))
  }
  return cappedDiff(stdout)
}

// ─── Run ───────────────────────────────────────────────────────────────────

export interface RunAgentReviewInput extends DiffTarget {
  repoRoot: string
  prNumber: number
  title: string
  body: string
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

/** What every record of one run shares, whatever its outcome. */
interface RunContext {
  input: RunAgentReviewInput
  runId: string
  startedAt: string
  activity: string[]
}

/** Lets `cancel()` reach a run already under way. */
interface RunControl {
  cancelled: boolean
  proc?: SpawnedProcess
}

/** A started `claude` invocation: what to run and what to send it. */
interface ClaudeLaunch {
  spawn: SpawnFn
  claudePath: string
  args: string[]
  prompt: string
  env: Record<string, string>
}

function baseFields(run: RunContext) {
  const { input } = run
  return {
    id: run.runId,
    repoRoot: input.repoRoot,
    prNumber: input.prNumber,
    headSHA: input.headSHA,
    sessionId: input.sessionId,
    scope: input.scope,
    request: input.request,
    question: input.question ?? null,
    startedAt: run.startedAt,
    activity: run.activity,
  }
}

function failedRun(run: RunContext, error: string): AgentRun {
  return {
    ...baseFields(run),
    status: 'failed',
    finishedAt: new Date().toISOString(),
    summary: null,
    findings: [],
    walkthrough: [],
    error,
  }
}

function cancelledRun(run: RunContext): AgentRun {
  return {
    ...baseFields(run),
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
    summary: null,
    findings: [],
    walkthrough: [],
    error: null,
  }
}

function findingFrom(f: AgentOutput['findings'][number]): AgentFinding {
  return {
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
  }
}

function doneRun(run: RunContext, output: AgentOutput): AgentRun {
  return {
    ...baseFields(run),
    status: 'done',
    finishedAt: new Date().toISOString(),
    summary: output.summary,
    findings: output.findings.map(findingFrom),
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

/** The run a `claude` exit produces: its error output on failure, else its parsed findings. */
function exitedRun(
  run: RunContext,
  code: number | null,
  output: { stdout: string; stderr: string }
) {
  if (code !== 0) return failedRun(run, output.stderr.trim() || `claude exited with code ${code}`)
  try {
    return doneRun(run, AgentOutputSchema.parse(parseStructuredOutput(output.stdout)))
  } catch (e) {
    return failedRun(run, `Could not parse agent output: ${String(e)}`)
  }
}

function sendPrompt(child: SpawnedProcess, prompt: string): void {
  try {
    child.stdin.write(prompt)
    child.stdin.end()
  } catch {
    // handled by the 'error' listener runClaude adds
  }
}

function collectOutput(child: SpawnedProcess): { stdout: string; stderr: string } {
  const output = { stdout: '', stderr: '' }
  child.stdout.on('data', (d) => {
    output.stdout += d.toString()
  })
  child.stderr.on('data', (d) => {
    output.stderr += d.toString()
  })
  return output
}

function runClaude(run: RunContext, launch: ClaudeLaunch, control: RunControl): Promise<AgentRun> {
  return new Promise<AgentRun>((resolve) => {
    const env = launch.env
    const child = launch.spawn(launch.claudePath, launch.args, { cwd: run.input.worktreePath, env })
    control.proc = child
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve(failedRun(run, 'Timed out after 5 min'))
    }, run.input.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    sendPrompt(child, launch.prompt)
    const output = collectOutput(child)
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve(failedRun(run, `Failed to start claude: ${String(e)}`))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(control.cancelled ? cancelledRun(run) : exitedRun(run, code, output))
    })
  })
}

function reviewPromptFor(
  input: RunAgentReviewInput,
  diff: { diffText: string; truncated: boolean }
) {
  return buildAgentPrompt({
    scope: input.scope,
    request: input.request,
    question: input.question,
    pr: { number: input.prNumber, title: input.title, body: input.body, headSHA: input.headSHA },
    ...diff,
  })
}

async function executeAgentRun(
  run: RunContext,
  deps: RunAgentReviewDeps,
  control: RunControl
): Promise<AgentRun> {
  const { input } = run
  let diff: { diffText: string; truncated: boolean }
  try {
    diff = await buildDiffText(input, deps.exec ?? defaultExec)
  } catch (e) {
    return failedRun(run, `Could not compute diff: ${String(e)}`)
  }
  if (control.cancelled) return cancelledRun(run)
  const prompt = reviewPromptFor(input, diff)
  const schemaJson = JSON.stringify(buildAgentJsonSchema())
  const { sessionId, model, effort } = input
  const args = buildClaudeArgs({ sessionId, model, effort, schemaJson })
  const env = scrubbedEnv()
  const claudePath = await (deps.resolveClaude ?? defaultResolveClaude)()
  if (control.cancelled) return cancelledRun(run)
  const spawn = deps.spawn ?? defaultSpawn
  return runClaude(run, { spawn, claudePath, args, prompt, env }, control)
}

export function runAgentReview(
  input: RunAgentReviewInput,
  deps: RunAgentReviewDeps = {}
): RunAgentReviewResult {
  const runId = randomUUID()
  const run: RunContext = { input, runId, startedAt: new Date().toISOString(), activity: [] }
  const control: RunControl = { cancelled: false }
  return {
    runId,
    done: executeAgentRun(run, deps, control),
    cancel: () => {
      control.cancelled = true
      control.proc?.kill('SIGKILL')
    },
  }
}
