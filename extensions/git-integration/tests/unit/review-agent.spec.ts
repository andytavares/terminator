import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import {
  buildAgentPrompt,
  buildAgentJsonSchema,
  buildClaudeArgs,
  buildDiffText,
  runAgentReview,
  runSummary,
  claudeFromShellOutput,
  type RunSummaryInput,
  type RunAgentReviewInput,
  type SpawnedProcess,
  type ExecFn,
  type RunAgentReviewDeps,
} from '../../src/review/review-agent.js'
import type { AgentScope } from '../../src/schemas/review-agent.schema.js'
import { FINDING_SEVERITIES } from '../../src/schemas/review-agent.schema.js'

type SpawnFn = NonNullable<RunAgentReviewDeps['spawn']>
/** What an EventEmitter calls back with; SpawnedProcess.on takes one per event. */
type Listener = Parameters<EventEmitter['on']>[1]

const pr = {
  number: 42,
  title: 'Add review agent',
  body: 'Adds the read-only review agent',
  headSHA: 'abc1234',
}

/** A scope of `kind` with every optional field empty, overridden by `fields`. */
function scopeOf(kind: AgentScope['kind'], fields: Partial<AgentScope> = {}): AgentScope {
  return { kind, path: null, startLine: null, endLine: null, side: null, chapter: null, ...fields }
}

describe('buildAgentPrompt — rules every prompt states', () => {
  it('renders every severity from the shared constant and marks the run read-only', () => {
    const prompt = buildAgentPrompt({
      scope: scopeOf('file', { path: 'src/foo.ts' }),
      request: 'review',
      pr,
      diffText: 'diff --git a/src/foo.ts b/src/foo.ts',
    })
    for (const severity of FINDING_SEVERITIES) {
      expect(prompt).toContain(severity)
    }
    expect(prompt).toMatch(/READ-ONLY/i)
    expect(prompt).toMatch(/must not post/i)
    expect(prompt).toMatch(/new side/i)
  })
})

describe('buildAgentPrompt — rules every prompt states (continued)', () => {
  it.each([
    [scopeOf('lines', { path: 'a.ts', startLine: 1, endLine: 2 }), 'lines 1-2 of a.ts'],
    [scopeOf('lines'), 'lines ?-? of the file'],
    [
      scopeOf('hunk', { path: 'a.ts', startLine: 3, endLine: 9 }),
      'the hunk touching a.ts around lines 3-9',
    ],
    [scopeOf('file', { path: 'src/foo.ts' }), 'the whole file src/foo.ts'],
    [scopeOf('chapter', { chapter: 'Data model' }), 'the chapter "Data model"'],
    [scopeOf('pr'), 'the whole pull request'],
  ])('describes the %o scope as "%s"', (scope, described) => {
    const prompt = buildAgentPrompt({ scope, request: 'review', pr, diffText: 'diff' })
    expect(prompt).toContain(`Scope: ${described}, at PR head abc1234, in a private worktree.`)
  })
})

describe('buildAgentPrompt — notes for the scope and diff', () => {
  it('asks for a walkthrough with one entry per chapter when scope is pr', () => {
    const prompt = buildAgentPrompt({
      scope: scopeOf('pr'),
      request: 'review',
      pr,
      diffText: 'diff',
    })
    expect(prompt).toMatch(/walkthrough/i)
    expect(prompt).toMatch(/one entry per chapter/i)
    expect(prompt).toMatch(/what the change is, then its consequences/i)
  })

  it('says the diff was truncated only when it was', () => {
    const input = { scope: scopeOf('pr'), request: 'review' as const, pr, diffText: 'diff' }
    expect(buildAgentPrompt({ ...input, truncated: true })).toMatch(/diff below was truncated/i)
    expect(buildAgentPrompt(input)).not.toMatch(/truncated/i)
  })
})

describe('buildAgentPrompt — notes for an explain or ask request', () => {
  it('lets findings be empty for an explain request', () => {
    const prompt = buildAgentPrompt({
      scope: scopeOf('lines', { path: 'a.ts', startLine: 1, endLine: 2, side: 'RIGHT' }),
      request: 'explain',
      pr,
      diffText: 'diff',
    })
    expect(prompt).toMatch(/findings may be empty/i)
  })

  it('includes the question for an ask request', () => {
    const prompt = buildAgentPrompt({
      scope: scopeOf('hunk', { path: 'a.ts', startLine: 1, endLine: 2, side: 'RIGHT' }),
      request: 'ask',
      question: 'why does this skip validation?',
      pr,
      diffText: 'diff',
    })
    expect(prompt).toContain('why does this skip validation?')
  })
})

describe('buildAgentJsonSchema', () => {
  it('derives the severity enum from the shared constant', () => {
    expect(buildAgentJsonSchema()).toMatchObject({
      properties: {
        findings: { items: { properties: { severity: { enum: [...FINDING_SEVERITIES] } } } },
      },
    })
  })
})

describe('buildClaudeArgs', () => {
  it('builds read-only args with no Bash tool and no effort flag when effort is empty', () => {
    const args = buildClaudeArgs({ sessionId: 'sess-1', model: 'opus', schemaJson: '{}' })
    expect(args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      '{}',
      '--tools',
      'Read,Grep,Glob',
      '--session-id',
      'sess-1',
      '--model',
      'opus',
    ])
    expect(args).not.toContain('Bash')
    expect(args.join(' ')).not.toMatch(/bash/i)
  })

  it('appends --effort when given', () => {
    const args = buildClaudeArgs({
      sessionId: 'sess-1',
      model: 'opus',
      effort: 'high',
      schemaJson: '{}',
    })
    expect(args.slice(-2)).toEqual(['--effort', 'high'])
  })
})

/** Runs buildDiffText for `scope` against a git that prints `stdout`; returns the result and the diff args. */
async function diffFor(scope: AgentScope, stdout: string) {
  const exec = vi.fn<ExecFn>(async () => ({ stdout }))
  const result = await buildDiffText(
    { worktreePath: '/wt', baseRefName: 'main', headSHA: 'abc1234', scope },
    exec
  )
  const diffArgs = exec.mock.calls.find((c) => c[1][0] === 'diff')?.[1]
  return { ...result, diffArgs }
}

const TWO_HUNK_DIFF = [
  'diff --git a/a.ts b/a.ts',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1,2 +1,2 @@',
  '-old1',
  '+new1',
  '@@ -50,2 +50,2 @@',
  '-old50',
  '+new50',
].join('\n')

describe('buildDiffText', () => {
  it('diffs the whole PR range for pr scope', async () => {
    const { diffArgs } = await diffFor(
      scopeOf('pr'),
      'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'
    )
    expect(diffArgs).toEqual(['diff', 'origin/main...abc1234'])
  })

  it('scopes to a single file for file scope', async () => {
    const { diffArgs } = await diffFor(scopeOf('file', { path: 'src/a.ts' }), 'diff')
    expect(diffArgs).toEqual(['diff', 'origin/main...abc1234', '--', 'src/a.ts'])
  })

  it('uses wide context and filters hunks outside the line range for lines scope', async () => {
    const scope = scopeOf('lines', { path: 'a.ts', startLine: 1, endLine: 2, side: 'RIGHT' })
    const { diffArgs, diffText } = await diffFor(scope, TWO_HUNK_DIFF)
    expect(diffArgs).toEqual(['diff', '--unified=20', 'origin/main...abc1234', '--', 'a.ts'])
    expect(diffText).toContain('new1')
    expect(diffText).not.toContain('new50')
  })

  it('caps the diff at 200KB and reports truncation', async () => {
    const { diffText, truncated } = await diffFor(scopeOf('pr'), 'x'.repeat(250 * 1024))
    expect(truncated).toBe(true)
    expect(Buffer.byteLength(diffText, 'utf8')).toBeLessThanOrEqual(200 * 1024)
  })
})

type FakeProcess = SpawnedProcess & {
  emitExit: (code: number) => void
  emitError: (e: Error) => void
  writtenStdin: string
  stdoutEmitter: EventEmitter
  stderrEmitter: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function makeFakeProcess(): FakeProcess {
  const stdoutEmitter = new EventEmitter()
  const stderrEmitter = new EventEmitter()
  const procEmitter = new EventEmitter()
  let writtenStdin = ''
  return {
    stdin: {
      write: (d: string) => {
        writtenStdin += d
      },
      end: () => {},
    },
    stdout: { on: (ev: string, cb: (d: Buffer | string) => void) => stdoutEmitter.on(ev, cb) },
    stderr: { on: (ev: string, cb: (d: Buffer | string) => void) => stderrEmitter.on(ev, cb) },
    on: (ev: string, cb: Listener) => procEmitter.on(ev, cb),
    kill: vi.fn(),
    emitExit: (code: number) => procEmitter.emit('exit', code),
    emitError: (e: Error) => procEmitter.emit('error', e),
    get writtenStdin() {
      return writtenStdin
    },
    stdoutEmitter,
    stderrEmitter,
  } as FakeProcess
}

const resolveClaude = async () => '/Users/me/.local/bin/claude'

const baseInput: RunAgentReviewInput = {
  repoRoot: '/repo',
  worktreePath: '/wt',
  prNumber: 42,
  headSHA: 'abc1234',
  baseRefName: 'main',
  title: 'Add review agent',
  body: 'body',
  scope: scopeOf('file', { path: 'a.ts' }),
  request: 'review',
  sessionId: 'sess-1',
  model: 'opus',
}

/** Starts a run against a fake claude process and waits for the diff and prompt to settle. */
async function startFakeRun(input: RunAgentReviewInput = baseInput) {
  const exec = vi.fn(async () => ({ stdout: 'diff' }))
  const fake = makeFakeProcess()
  const spawn = vi.fn((..._args: Parameters<SpawnFn>) => fake)
  const { done, cancel } = runAgentReview(input, { exec, spawn, resolveClaude })
  // the diff/prompt build settles before the process "runs"
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
  return { fake, spawn, done, cancel }
}

/** Has the fake claude print `output` as its JSON result and exit 0. */
function printAndExit(fake: FakeProcess, output: unknown) {
  fake.stdoutEmitter.emit('data', JSON.stringify(output))
  fake.emitExit(0)
}

const NIT_WITHOUT_SIDE = {
  severity: 'nit',
  path: 'a.ts',
  startLine: 1,
  endLine: 1,
  title: 't',
  body: 'b',
}

describe('runAgentReview — a run that completes', () => {
  it('spawns claude with read-only tools only, on the worktree cwd, and parses structured_output', async () => {
    const { fake, spawn, done } = await startFakeRun()
    printAndExit(fake, { structured_output: { summary: 'looks fine', findings: [] } })

    const run = await done
    expect(run.status).toBe('done')
    expect(run.summary).toBe('looks fine')

    expect(spawn).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = spawn.mock.calls[0]
    expect(cmd).toBe('/Users/me/.local/bin/claude')
    expect(args).toContain('--tools')
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob')
    expect(args).not.toContain('Bash')
    expect(opts.cwd).toBe('/wt')
  })

  it('assigns an id to each finding and defaults side to RIGHT', async () => {
    const { fake, done } = await startFakeRun()
    printAndExit(fake, { structured_output: { summary: 's', findings: [NIT_WITHOUT_SIDE] } })

    const run = await done
    expect(run.findings).toHaveLength(1)
    expect(typeof run.findings[0].id).toBe('string')
    expect(run.findings[0].id.length).toBeGreaterThan(0)
    expect(run.findings[0].side).toBe('RIGHT')
  })
})

describe('runAgentReview — reading the result', () => {
  it('falls back to parsing .result as JSON when structured_output is absent', async () => {
    const { fake, done } = await startFakeRun()
    printAndExit(fake, { result: JSON.stringify({ summary: 'via result', findings: [] }) })

    const run = await done
    expect(run.status).toBe('done')
    expect(run.summary).toBe('via result')
  })

  it('takes .result as it is when it is already an object', async () => {
    const { fake, done } = await startFakeRun()
    printAndExit(fake, { result: { summary: 'object result', findings: [] } })

    const run = await done
    expect(run.status).toBe('done')
    expect(run.summary).toBe('object result')
  })

  it('fails with a readable error and no partial findings when output does not validate', async () => {
    const { fake, done } = await startFakeRun()
    printAndExit(fake, { structured_output: { summary: 'x' } })

    const run = await done
    expect(run.status).toBe('failed')
    expect(run.findings).toEqual([])
    expect(run.error).toBeTruthy()
  })
})

describe('runAgentReview — a run that fails', () => {
  it('fails on non-zero exit', async () => {
    const { fake, done } = await startFakeRun()
    fake.emitExit(1)

    const run = await done
    expect(run.status).toBe('failed')
  })

  it("reports claude's stderr as the error when it exits non-zero", async () => {
    const { fake, done } = await startFakeRun()
    fake.stderrEmitter.emit('data', '  model not available\n')
    fake.emitExit(2)

    expect((await done).error).toBe('model not available')
  })
})

describe('runAgentReview — a run that never gets an answer', () => {
  it('fails when claude cannot start', async () => {
    const { fake, done } = await startFakeRun()
    fake.emitError(new Error('ENOENT'))

    const run = await done
    expect(run.status).toBe('failed')
    expect(run.error).toBe('Failed to start claude: Error: ENOENT')
  })

  it('fails without spawning when the diff cannot be computed', async () => {
    const spawn = vi.fn()
    const exec = vi.fn(async (_cmd: 'git', args: string[]) => {
      if (args[0] === 'diff') throw new Error('bad revision')
      return { stdout: '' }
    })
    const run = await runAgentReview(baseInput, { exec, spawn, resolveClaude }).done
    expect(run.status).toBe('failed')
    expect(run.error).toBe('Could not compute diff: Error: bad revision')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('times out after the given timeoutMs and kills the process', async () => {
    const { fake, done } = await startFakeRun({ ...baseInput, timeoutMs: 5 })
    const run = await done
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/Timed out/)
    expect(fake.kill).toHaveBeenCalled()
  })
})

describe('runAgentReview — cancelling', () => {
  it('cancel() marks the run cancelled and kills the process', async () => {
    const { fake, done, cancel } = await startFakeRun()
    cancel()
    fake.emitExit(137)

    const run = await done
    expect(run.status).toBe('cancelled')
    expect(fake.kill).toHaveBeenCalled()
  })

  it('never spawns when cancelled while the diff is computed', async () => {
    let diffPrinted: (out: { stdout: string }) => void = () => {}
    const exec = vi.fn((_cmd: 'git', args: string[]) =>
      args[0] === 'diff'
        ? new Promise<{ stdout: string }>((r) => (diffPrinted = r))
        : Promise.resolve({ stdout: '' })
    )
    const spawn = vi.fn()
    const { done, cancel } = runAgentReview(baseInput, { exec, spawn, resolveClaude })
    await vi.waitFor(() =>
      expect(exec.mock.calls.some(([, args]) => args[0] === 'diff')).toBe(true)
    )
    cancel()
    diffPrinted({ stdout: 'diff' })

    expect((await done).status).toBe('cancelled')
    expect(spawn).not.toHaveBeenCalled()
  })
})

/** Sets environment variables for one callback, restoring the previous values after. */
async function withEnv(vars: Record<string, string>, body: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  Object.assign(process.env, vars)
  try {
    await body()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe('runAgentReview — child environment', () => {
  it('scrubs CLAUDE_CODE_* and CLAUDECODE from the child env', async () => {
    await withEnv(
      { CLAUDE_CODE_BRIDGE_SESSION_ID: 'parent-session', CLAUDECODE: '1' },
      async () => {
        const { fake, spawn, done } = await startFakeRun()
        printAndExit(fake, { structured_output: { summary: 's', findings: [] } })
        await done

        const [, , opts] = spawn.mock.calls[0]
        expect(opts.env.CLAUDE_CODE_BRIDGE_SESSION_ID).toBeUndefined()
        expect(opts.env.CLAUDECODE).toBeUndefined()
      }
    )
  })
})

describe('claudeFromShellOutput', () => {
  it('takes the absolute path the shell printed, past any rc-file noise', () => {
    expect(claudeFromShellOutput('Updating oh-my-zsh...\n/Users/me/.local/bin/claude\n')).toBe(
      '/Users/me/.local/bin/claude'
    )
  })

  it('is null when the shell found no claude', () => {
    expect(claudeFromShellOutput('')).toBeNull()
    expect(claudeFromShellOutput('claude not found\n')).toBeNull()
  })

  it('is null for an alias or function rather than a file', () => {
    expect(claudeFromShellOutput("alias claude='claude --foo'\n")).toBeNull()
  })
})

describe('runAgentReview — the timeout message', () => {
  it('names the configured minutes, not a fixed five', async () => {
    vi.useFakeTimers()
    try {
      const fake = makeFakeProcess()
      const exec = vi.fn(async () => ({ stdout: 'diff' }))
      const spawn = vi.fn((..._args: Parameters<SpawnFn>) => fake)
      const input = { ...baseInput, timeoutMs: 12 * 60_000 }
      const { done } = runAgentReview(input, { exec, spawn, resolveClaude })
      await vi.advanceTimersByTimeAsync(12 * 60_000)
      expect((await done).error).toBe('Timed out after 12 min')
    } finally {
      vi.useRealTimers()
    }
  })
})

const summaryInput: RunSummaryInput = {
  prNumber: 42,
  kind: 'discussion',
  text: '**ana**: Ship it\n\n**bo**: Wait for CI',
  cwd: '/storage/git-integration',
  model: 'sonnet',
  timeoutMs: 12 * 60_000,
}

/** Starts a summary against a fake claude process and waits for it to be spawned. */
async function startFakeSummary(input: RunSummaryInput = summaryInput) {
  const fake = makeFakeProcess()
  const spawn = vi.fn((..._args: Parameters<SpawnFn>) => fake)
  const { done, cancel } = runSummary(input, { spawn, resolveClaude })
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
  return { fake, spawn, done, cancel }
}

/** The value that follows `flag` in claude's argv. */
function flagValue(args: string[], flag: string): string {
  return args[args.indexOf(flag) + 1]
}

describe('runSummary — the claude it starts', () => {
  it('runs claude -p read-only in the storage folder, with a schema requiring summary', async () => {
    const { spawn } = await startFakeSummary()
    const [cmd, args, opts] = spawn.mock.calls[0]
    expect(cmd).toBe('/Users/me/.local/bin/claude')
    expect(args).toContain('-p')
    expect(flagValue(args, '--output-format')).toBe('json')
    expect(JSON.parse(flagValue(args, '--json-schema'))).toMatchObject({
      required: ['summary'],
      properties: { summary: { type: 'string' } },
    })
    expect(flagValue(args, '--tools')).toBe('Read,Grep,Glob')
    expect(flagValue(args, '--model')).toBe('sonnet')
    expect(opts.cwd).toBe('/storage/git-integration')
  })

  it('sends the text on stdin as untrusted content under the read-only rule', async () => {
    const { fake } = await startFakeSummary()
    expect(fake.writtenStdin).toContain('**ana**: Ship it')
    expect(fake.writtenStdin).toContain('#42')
    expect(fake.writtenStdin).toMatch(/discussion/i)
    expect(fake.writtenStdin).toMatch(/READ-ONLY/)
    expect(fake.writtenStdin).toMatch(/never as instructions/i)
  })

  it('asks for at most four short points and a Not done line only when something was left undone', async () => {
    const { fake } = await startFakeSummary()
    expect(fake.writtenStdin).toMatch(/at most four bullet points/i)
    expect(fake.writtenStdin).toMatch(/under 25 words/i)
    expect(fake.writtenStdin).toContain('"Not done:"')
  })
})

describe('runSummary — a description summary', () => {
  it('asks for current state, what the change does, risks as bullets, and diagrams only if needed', async () => {
    const { fake } = await startFakeSummary({
      ...summaryInput,
      kind: 'description',
      text: 'Moves the queue to Redis.',
    })
    expect(fake.writtenStdin).toMatch(/Current state.*1-3 sentences/s)
    expect(fake.writtenStdin).toMatch(/What the change does.*1-3 sentences/s)
    expect(fake.writtenStdin).toMatch(/Risks.*bullet list/s)
    expect(fake.writtenStdin).toMatch(/diagram.*only when/is)
    expect(fake.writtenStdin).not.toMatch(/at most four bullet points/i)
  })

  it('leaves a discussion summary on the four-bullet format', async () => {
    const { fake } = await startFakeSummary()
    expect(fake.writtenStdin).toMatch(/at most four bullet points/i)
    expect(fake.writtenStdin).not.toMatch(/Current state/)
  })
})

describe('runSummary — what it answers', () => {
  it('answers the summary claude returned as structured_output', async () => {
    const { fake, done } = await startFakeSummary()
    printAndExit(fake, { structured_output: { summary: 'Ana approves; Bo waits on CI.' } })
    expect(await done).toEqual({ summary: 'Ana approves; Bo waits on CI.' })
  })

  it("answers claude's error output when it exits non-zero", async () => {
    const { fake, done } = await startFakeSummary()
    fake.stderrEmitter.emit('data', 'model not available\n')
    fake.emitExit(1)
    expect(await done).toEqual({ error: 'model not available' })
  })

  it('answers a plain error when the output has no summary', async () => {
    const { fake, done } = await startFakeSummary()
    printAndExit(fake, { structured_output: { findings: [] } })
    expect(await done).toEqual({ error: 'The review agent answered without a summary.' })
  })
})

describe('runSummary — a summary that does not finish', () => {
  it('times out naming the configured minutes and kills claude', async () => {
    vi.useFakeTimers()
    try {
      const fake = makeFakeProcess()
      const spawn = vi.fn((..._args: Parameters<SpawnFn>) => fake)
      const { done } = runSummary(summaryInput, { spawn, resolveClaude })
      await vi.advanceTimersByTimeAsync(12 * 60_000)
      expect(await done).toEqual({ error: 'Timed out after 12 min' })
      expect(fake.kill).toHaveBeenCalledWith('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancel() kills claude and answers that the summary was cancelled', async () => {
    const { fake, done, cancel } = await startFakeSummary()
    cancel()
    fake.emitExit(137)
    expect(await done).toEqual({ error: 'Summary cancelled.' })
    expect(fake.kill).toHaveBeenCalledWith('SIGKILL')
  })
})
