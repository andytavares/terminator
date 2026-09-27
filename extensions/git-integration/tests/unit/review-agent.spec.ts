import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import {
  buildAgentPrompt,
  buildAgentJsonSchema,
  buildClaudeArgs,
  buildDiffText,
  runAgentReview,
  type SpawnedProcess,
} from '../../src/review/review-agent.js'
import { FINDING_SEVERITIES } from '../../src/schemas/review-agent.schema.js'

const pr = {
  number: 42,
  title: 'Add review agent',
  body: 'Adds the read-only review agent',
  headSHA: 'abc1234',
}

describe('buildAgentPrompt', () => {
  it('renders every severity from the shared constant and marks the run read-only', () => {
    const prompt = buildAgentPrompt({
      scope: {
        kind: 'file',
        path: 'src/foo.ts',
        startLine: null,
        endLine: null,
        side: null,
        chapter: null,
      },
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

  it('asks for a walkthrough with one entry per chapter when scope is pr', () => {
    const prompt = buildAgentPrompt({
      scope: { kind: 'pr', path: null, startLine: null, endLine: null, side: null, chapter: null },
      request: 'review',
      pr,
      diffText: 'diff',
    })
    expect(prompt).toMatch(/walkthrough/i)
    expect(prompt).toMatch(/one entry per chapter/i)
    expect(prompt).toMatch(/what the change is, then its consequences/i)
  })

  it('lets findings be empty for an explain request', () => {
    const prompt = buildAgentPrompt({
      scope: {
        kind: 'lines',
        path: 'a.ts',
        startLine: 1,
        endLine: 2,
        side: 'RIGHT',
        chapter: null,
      },
      request: 'explain',
      pr,
      diffText: 'diff',
    })
    expect(prompt).toMatch(/findings may be empty/i)
  })

  it('includes the question for an ask request', () => {
    const prompt = buildAgentPrompt({
      scope: { kind: 'hunk', path: 'a.ts', startLine: 1, endLine: 2, side: 'RIGHT', chapter: null },
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
    const schema = buildAgentJsonSchema() as any
    expect(schema.properties.findings.items.properties.severity.enum).toEqual([
      ...FINDING_SEVERITIES,
    ])
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

describe('buildDiffText', () => {
  it('diffs the whole PR range for pr scope', async () => {
    const exec = vi.fn(async () => ({ stdout: 'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n' }))
    await buildDiffText(
      '/wt',
      'main',
      'abc1234',
      { kind: 'pr', path: null, startLine: null, endLine: null, side: null, chapter: null },
      exec
    )
    const diffCall = exec.mock.calls.find((c) => c[1][0] === 'diff')
    expect(diffCall?.[1]).toEqual(['diff', 'origin/main...abc1234'])
  })

  it('scopes to a single file for file scope', async () => {
    const exec = vi.fn(async () => ({ stdout: 'diff' }))
    await buildDiffText(
      '/wt',
      'main',
      'abc1234',
      { kind: 'file', path: 'src/a.ts', startLine: null, endLine: null, side: null, chapter: null },
      exec
    )
    const diffCall = exec.mock.calls.find((c) => c[1][0] === 'diff')
    expect(diffCall?.[1]).toEqual(['diff', 'origin/main...abc1234', '--', 'src/a.ts'])
  })

  it('uses wide context and filters hunks outside the line range for lines scope', async () => {
    const diff = [
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
    const exec = vi.fn(async () => ({ stdout: diff }))
    const { diffText } = await buildDiffText(
      '/wt',
      'main',
      'abc1234',
      { kind: 'lines', path: 'a.ts', startLine: 1, endLine: 2, side: 'RIGHT', chapter: null },
      exec
    )
    const diffCall = exec.mock.calls.find((c) => c[1][0] === 'diff')
    expect(diffCall?.[1]).toEqual(['diff', '--unified=20', 'origin/main...abc1234', '--', 'a.ts'])
    expect(diffText).toContain('new1')
    expect(diffText).not.toContain('new50')
  })

  it('caps the diff at 200KB and reports truncation', async () => {
    const big = 'x'.repeat(250 * 1024)
    const exec = vi.fn(async () => ({ stdout: big }))
    const { diffText, truncated } = await buildDiffText(
      '/wt',
      'main',
      'abc1234',
      { kind: 'pr', path: null, startLine: null, endLine: null, side: null, chapter: null },
      exec
    )
    expect(truncated).toBe(true)
    expect(Buffer.byteLength(diffText, 'utf8')).toBeLessThanOrEqual(200 * 1024)
  })
})

function makeFakeProcess(): SpawnedProcess & {
  emitExit: (code: number) => void
  emitError: (e: Error) => void
  writtenStdin: string
} {
  const stdoutEmitter = new EventEmitter()
  const stderrEmitter = new EventEmitter()
  const procEmitter = new EventEmitter()
  let writtenStdin = ''
  const fake: any = {
    stdin: {
      write: (d: string) => {
        writtenStdin += d
      },
      end: () => {},
    },
    stdout: { on: (ev: string, cb: (d: Buffer | string) => void) => stdoutEmitter.on(ev, cb) },
    stderr: { on: (ev: string, cb: (d: Buffer | string) => void) => stderrEmitter.on(ev, cb) },
    on: (ev: string, cb: (...args: any[]) => void) => procEmitter.on(ev, cb),
    kill: vi.fn(),
    _stdoutEmitter: stdoutEmitter,
    emitExit: (code: number) => procEmitter.emit('exit', code),
    emitError: (e: Error) => procEmitter.emit('error', e),
    get writtenStdin() {
      return writtenStdin
    },
  }
  fake.stdoutEmitter = stdoutEmitter
  return fake
}

describe('runAgentReview', () => {
  const baseInput = {
    repoRoot: '/repo',
    worktreePath: '/wt',
    prNumber: 42,
    headSHA: 'abc1234',
    baseRefName: 'main',
    title: 'Add review agent',
    body: 'body',
    scope: {
      kind: 'file',
      path: 'a.ts',
      startLine: null,
      endLine: null,
      side: null,
      chapter: null,
    } as const,
    request: 'review' as const,
    sessionId: 'sess-1',
    model: 'opus',
  }

  it('spawns claude with read-only tools only, on the worktree cwd, and parses structured_output', async () => {
    const exec = vi.fn(async () => ({ stdout: 'diff' }))
    const fake = makeFakeProcess()
    const spawn = vi.fn(() => fake)

    const { done } = runAgentReview(baseInput, { exec, spawn })

    // let the diff/prompt build settle before the process "runs"
    await new Promise((r) => setTimeout(r, 10))
    fake.stdoutEmitter.emit(
      'data',
      JSON.stringify({ structured_output: { summary: 'looks fine', findings: [] } })
    )
    fake.emitExit(0)

    const run = await done
    expect(run.status).toBe('done')
    expect(run.summary).toBe('looks fine')

    expect(spawn).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = spawn.mock.calls[0]
    expect(cmd).toBe('claude')
    expect(args).toContain('--tools')
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob')
    expect(args).not.toContain('Bash')
    expect(opts.cwd).toBe('/wt')
  })

  it('assigns an id to each finding and defaults side to RIGHT', async () => {
    const exec = vi.fn(async () => ({ stdout: 'diff' }))
    const fake = makeFakeProcess()
    const spawn = vi.fn(() => fake)

    const { done } = runAgentReview(baseInput, { exec, spawn })
    await new Promise((r) => setTimeout(r, 10))
    fake.stdoutEmitter.emit(
      'data',
      JSON.stringify({
        structured_output: {
          summary: 's',
          findings: [
            { severity: 'nit', path: 'a.ts', startLine: 1, endLine: 1, title: 't', body: 'b' },
          ],
        },
      })
    )
    fake.emitExit(0)

    const run = await done
    expect(run.findings).toHaveLength(1)
    expect(typeof run.findings[0].id).toBe('string')
    expect(run.findings[0].id.length).toBeGreaterThan(0)
    expect(run.findings[0].side).toBe('RIGHT')
  })

  it('falls back to parsing .result as JSON when structured_output is absent', async () => {
    const exec = vi.fn(async () => ({ stdout: 'diff' }))
    const fake = makeFakeProcess()
    const spawn = vi.fn(() => fake)

    const { done } = runAgentReview(baseInput, { exec, spawn })
    await new Promise((r) => setTimeout(r, 10))
    fake.stdoutEmitter.emit(
      'data',
      JSON.stringify({ result: JSON.stringify({ summary: 'via result', findings: [] }) })
    )
    fake.emitExit(0)

    const run = await done
    expect(run.status).toBe('done')
    expect(run.summary).toBe('via result')
  })

  it('fails with a readable error and no partial findings when output does not validate', async () => {
    const exec = vi.fn(async () => ({ stdout: 'diff' }))
    const fake = makeFakeProcess()
    const spawn = vi.fn(() => fake)

    const { done } = runAgentReview(baseInput, { exec, spawn })
    await new Promise((r) => setTimeout(r, 10))
    fake.stdoutEmitter.emit('data', JSON.stringify({ structured_output: { summary: 'x' } }))
    fake.emitExit(0)

    const run = await done
    expect(run.status).toBe('failed')
    expect(run.findings).toEqual([])
    expect(run.error).toBeTruthy()
  })

  it('fails on non-zero exit', async () => {
    const exec = vi.fn(async () => ({ stdout: 'diff' }))
    const fake = makeFakeProcess()
    const spawn = vi.fn(() => fake)

    const { done } = runAgentReview(baseInput, { exec, spawn })
    await new Promise((r) => setTimeout(r, 10))
    fake.stderr.on
    ;(fake as any)._stdoutEmitter // no-op reference
    ;(fake as any).emitExit(1)

    const run = await done
    expect(run.status).toBe('failed')
  })

  it('times out after the given timeoutMs and kills the process', async () => {
    const exec = vi.fn(async () => ({ stdout: 'diff' }))
    const fake = makeFakeProcess()
    const spawn = vi.fn(() => fake)

    const { done } = runAgentReview({ ...baseInput, timeoutMs: 5 }, { exec, spawn })
    const run = await done
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/Timed out/)
    expect(fake.kill).toHaveBeenCalled()
  })

  it('cancel() marks the run cancelled and kills the process', async () => {
    const exec = vi.fn(async () => ({ stdout: 'diff' }))
    const fake = makeFakeProcess()
    const spawn = vi.fn(() => fake)

    const { done, cancel } = runAgentReview(baseInput, { exec, spawn })
    await new Promise((r) => setTimeout(r, 10))
    cancel()
    fake.emitExit(137)

    const run = await done
    expect(run.status).toBe('cancelled')
    expect(fake.kill).toHaveBeenCalled()
  })

  it('scrubs CLAUDE_CODE_* and CLAUDECODE from the child env', async () => {
    const exec = vi.fn(async () => ({ stdout: 'diff' }))
    const fake = makeFakeProcess()
    const spawn = vi.fn(() => fake)
    const prevBridge = process.env.CLAUDE_CODE_BRIDGE_SESSION_ID
    const prevCode = process.env.CLAUDECODE
    process.env.CLAUDE_CODE_BRIDGE_SESSION_ID = 'parent-session'
    process.env.CLAUDECODE = '1'

    try {
      const { done } = runAgentReview(baseInput, { exec, spawn })
      await new Promise((r) => setTimeout(r, 10))
      fake.stdoutEmitter.emit(
        'data',
        JSON.stringify({ structured_output: { summary: 's', findings: [] } })
      )
      fake.emitExit(0)
      await done

      const [, , opts] = spawn.mock.calls[0]
      expect(opts.env.CLAUDE_CODE_BRIDGE_SESSION_ID).toBeUndefined()
      expect(opts.env.CLAUDECODE).toBeUndefined()
    } finally {
      if (prevBridge === undefined) delete process.env.CLAUDE_CODE_BRIDGE_SESSION_ID
      else process.env.CLAUDE_CODE_BRIDGE_SESSION_ID = prevBridge
      if (prevCode === undefined) delete process.env.CLAUDECODE
      else process.env.CLAUDECODE = prevCode
    }
  })
})
