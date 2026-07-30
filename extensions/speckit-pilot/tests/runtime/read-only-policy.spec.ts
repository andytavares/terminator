import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { decideReadOnly } from '../../src/runtime/read-only-policy.js'
import { installReadOnlyHookScript } from '../../src/runtime/read-only-hook.js'

// Self-review used to bypass permissions outright, so a review could rewrite
// the worktree it was reviewing. It now decides from this policy, with no person
// asked — an automated gate that waits on a human is a flaky one.

describe('what a review may do', () => {
  const allowed = (tool: string, input?: unknown) => decideReadOnly(tool, input).allow

  it('allows reading', () => {
    expect(allowed('Read', { file_path: '/a.ts' })).toBe(true)
    expect(allowed('Grep', { pattern: 'x' })).toBe(true)
    expect(allowed('Glob', { pattern: '*.ts' })).toBe(true)
  })

  it('refuses writing', () => {
    expect(allowed('Write', { file_path: '/a.ts', content: 'x' })).toBe(false)
    expect(allowed('Edit', { file_path: '/a.ts' })).toBe(false)
    expect(allowed('NotebookEdit', {})).toBe(false)
  })

  it('refuses a tool it has never been taught about', () => {
    // A tool the policy cannot vouch for is one a review has no business using.
    expect(allowed('SomeNewTool', {})).toBe(false)
  })

  it('allows the git commands a review is actually made of', () => {
    expect(allowed('Bash', { command: 'git diff main...HEAD' })).toBe(true)
    expect(allowed('Bash', { command: 'git log --oneline -5' })).toBe(true)
    expect(allowed('Bash', { command: 'git status' })).toBe(true)
  })

  it('refuses git commands that change the repository', () => {
    expect(allowed('Bash', { command: 'git checkout main' })).toBe(false)
    expect(allowed('Bash', { command: 'git commit -m x' })).toBe(false)
    expect(allowed('Bash', { command: 'git push' })).toBe(false)
    expect(allowed('Bash', { command: 'git reset --hard' })).toBe(false)
  })

  it('allows plain inspection commands', () => {
    expect(allowed('Bash', { command: 'cat package.json' })).toBe(true)
    expect(allowed('Bash', { command: 'rg TODO src' })).toBe(true)
  })

  it('refuses anything not on the list', () => {
    expect(allowed('Bash', { command: 'rm -rf .' })).toBe(false)
    expect(allowed('Bash', { command: 'npm install left-pad' })).toBe(false)
    expect(allowed('Bash', { command: 'curl https://example.com' })).toBe(false)
  })

  it('refuses a chained command, however innocent it starts', () => {
    // This is the load-bearing check. `git diff` on its own passes, so without
    // it the allowlist is theatre.
    expect(allowed('Bash', { command: 'git diff; rm -rf .' })).toBe(false)
    expect(allowed('Bash', { command: 'git diff && rm -rf .' })).toBe(false)
    expect(allowed('Bash', { command: 'git diff || rm -rf .' })).toBe(false)
  })

  it('refuses redirection, which is how a read becomes a write', () => {
    // The exact hole that made --allowedTools useless: an agent told it could
    // only read still created a file, because Bash can redirect.
    expect(allowed('Bash', { command: 'echo banana > probe.txt' })).toBe(false)
    expect(allowed('Bash', { command: 'git diff > /tmp/out' })).toBe(false)
    expect(allowed('Bash', { command: 'cat a.ts >> b.ts' })).toBe(false)
  })

  it('refuses command substitution and pipes', () => {
    expect(allowed('Bash', { command: 'git diff $(rm -rf .)' })).toBe(false)
    expect(allowed('Bash', { command: 'git diff `rm -rf .`' })).toBe(false)
    expect(allowed('Bash', { command: 'cat a | tee b' })).toBe(false)
  })

  it('refuses a Bash call with nothing to check', () => {
    expect(allowed('Bash', {})).toBe(false)
    expect(allowed('Bash', { command: '   ' })).toBe(false)
    expect(allowed('Bash', undefined)).toBe(false)
  })

  it('says why, in words the agent reads and a person can act on', () => {
    expect(decideReadOnly('Write', {}).reason).toMatch(/may only read/)
    expect(decideReadOnly('Bash', { command: 'git diff > x' }).reason).toMatch(/redirection/)
  })
})

// The hook runs in a process Claude Code owns, with no bundler and nothing to
// import, so it carries its own copy of the rules. These run the real script the
// way Claude Code does and check it agrees with the module — the two cannot
// drift silently.
describe('the hook script agrees with the policy', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'read-only-hook-'))
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))

  function run(toolName: string, toolInput: unknown): Promise<string> {
    const script = installReadOnlyHookScript(dir)
    return new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [script],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
        (error, stdout) => (error ? reject(error) : resolve(stdout))
      )
      child.stdin?.end(
        JSON.stringify({
          hook_event_name: 'PreToolUse',
          tool_name: toolName,
          tool_input: toolInput,
        })
      )
    })
  }

  const cases: Array<[string, unknown]> = [
    ['Read', { file_path: '/a.ts' }],
    ['Write', { file_path: '/a.ts' }],
    ['Bash', { command: 'git diff main' }],
    ['Bash', { command: 'git checkout main' }],
    ['Bash', { command: 'echo banana > probe.txt' }],
    ['Bash', { command: 'git diff; rm -rf .' }],
    ['Bash', { command: 'rm -rf .' }],
    ['SomeNewTool', {}],
  ]

  for (const [toolName, toolInput] of cases) {
    it(`decides ${toolName} ${JSON.stringify(toolInput)} the same way`, async () => {
      const stdout = await run(toolName, toolInput)
      const decision = JSON.parse(stdout).hookSpecificOutput
      expect(decision.hookEventName).toBe('PreToolUse')
      expect(decision.permissionDecision).toBe(
        decideReadOnly(toolName, toolInput).allow ? 'allow' : 'deny'
      )
    })
  }

  it('refuses when handed something that is not hook input', async () => {
    const script = installReadOnlyHookScript(dir)
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [script],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
        (error, out) => (error ? reject(error) : resolve(out))
      )
      child.stdin?.end('not json')
    })
    // Unreadable input is not a reason to let a review write.
    expect(JSON.parse(stdout).hookSpecificOutput.permissionDecision).toBe('deny')
  })
})

describe('the ways this was bypassable', () => {
  // Every one of these was allowed, verified by running the policy directly.
  // A review that can run them is not a review — it is an agent with write
  // access and a reassuring name.

  it.each([
    ['a newline runs the next command', 'git diff\nrm -rf .'],
    ['so does a carriage return', 'git diff\rrm -rf .'],
    ['sed rewrites the file in place', 'sed -i.bak s/a/b/ file.ts'],
    ['find deletes what it finds', 'find . -name x -delete'],
    ['find executes anything', 'find . -exec rm {} ;'],
    ['awk redirects on its own', 'awk {print} file > out'],
    ['git config writes configuration', 'git config user.email evil@example.com'],
    ['git branch -D destroys branches', 'git branch -D main'],
    ['git remote repoints a push', 'git remote add evil https://example.invalid'],
  ])('refuses: %s', (_why, command) => {
    expect(decideReadOnly('Bash', { command }).allow).toBe(false)
  })

  it.each([
    ['reading a file', 'cat README.md'],
    ['searching', 'grep -rn thing src'],
    ['the diff a review is mostly made of', 'git diff main'],
    ['the log', 'git log --oneline -20'],
  ])('still allows: %s', (_why, command) => {
    expect(decideReadOnly('Bash', { command }).allow).toBe(true)
  })
})
