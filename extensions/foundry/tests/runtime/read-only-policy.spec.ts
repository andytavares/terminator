import { describe, it, expect } from 'vitest'
import { decideReadOnly } from '../../src/runtime/read-only-policy.js'

// A read-only role used to be a request in a prompt, so a reviewer could
// rewrite the worktree it was reviewing. It now decides from this policy, with
// no person asked — an automated gate that waits on a human is a flaky one.

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
// The cross-process agreement test that sat here is gone with the second hook
// script it checked. There was a separate `read-only-hook.mjs` written for the
// self-review runner, and it had to be proven to decide the same way as this
// policy because it was a copy of it in another process. The Line does not
// copy it: `executor.ts` hands `decideReadOnly` itself to the supervised
// runner as `autoDecide`, so there is one implementation and nothing to agree
// with.

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
    // Flags, not chaining: neither of these needs a shell metacharacter, so the
    // compound check never saw them.
    ['git writes the diff to a file', 'git diff --output=/tmp/pwned.txt'],
    ['and with the short flag', 'git diff -o /tmp/pwned.txt'],
    ['ripgrep runs a program per file', 'rg --pre /tmp/evil.sh foo'],
    ['and picks it by glob', 'rg --pre-glob *.md foo'],
    ['anything that takes --exec', 'grep --exec rm foo'],
    ['in-place editing wherever it appears', 'diff --in-place a b'],
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
