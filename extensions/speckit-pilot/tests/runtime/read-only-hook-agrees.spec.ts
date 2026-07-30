import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installReadOnlyHookScript } from '../../src/runtime/read-only-hook.js'
import { decideReadOnly } from '../../src/runtime/read-only-policy.js'

// The policy exists twice: as a module, and as a string the hook executes in a
// process Claude Code owns, with no bundler and nothing to import. The module's
// comment claimed a test kept the two in step. There was no such test — which
// is exactly how a rule fixed in one could stay broken in the other.
//
// This runs the real script, as a real process, over the same table the module
// is checked against.

let scriptPath: string
let dir: string

/** What the hook decides, read the way Claude Code reads it. */
function hookAllows(toolName: string, input: unknown): boolean {
  const stdout = execFileSync(process.execPath, [scriptPath], {
    input: JSON.stringify({ tool_name: toolName, tool_input: input }),
    encoding: 'utf8',
  })
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { permissionDecision: string; hookEventName: string }
  }
  // The field the runtime silently ignores the decision without.
  expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse')
  return parsed.hookSpecificOutput.permissionDecision === 'allow'
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'read-only-hook-'))
  scriptPath = installReadOnlyHookScript(dir)
})

afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))

describe('the script the review actually runs', () => {
  const commands: Array<[string, string]> = [
    ['a plain read', 'git diff'],
    ['a chained destroy', 'git diff; rm -rf .'],
    // Each of these was allowed. A shell runs every line of the first in turn,
    // while a check looking only for `;` saw "git diff" and let it through.
    ['a newline-chained destroy', 'git diff\nrm -rf .'],
    ['a carriage-return-chained destroy', 'git diff\rrm -rf .'],
    ['an in-place edit', 'sed -i.bak s/a/b/ file.ts'],
    ['a find that deletes', 'find . -name x -delete'],
    ['a git that writes config', 'git config user.email evil@example.com'],
    ['a git that deletes a branch', 'git branch -D main'],
    ['a git that repoints a push', 'git remote add evil https://example.invalid'],
    ['a redirect', 'git diff > /tmp/out'],
    ['a substitution', 'git diff $(rm -rf .)'],
    ['a read that is fine', 'cat README.md'],
    ['a grep', 'grep -rn thing src'],
  ]

  it.each(commands)('agrees with the module on %s', (_label, command) => {
    expect(hookAllows('Bash', { command })).toBe(decideReadOnly('Bash', { command }).allow)
  })

  it.each(commands)('refuses or allows %s the same way twice', (_label, command) => {
    // Nothing here depends on order or state; a second run must not differ.
    expect(hookAllows('Bash', { command })).toBe(hookAllows('Bash', { command }))
  })

  it('agrees that a write tool is not a read', () => {
    expect(hookAllows('Write', { file_path: '/x', content: 'y' })).toBe(false)
    expect(decideReadOnly('Write', {}).allow).toBe(false)
  })

  it('agrees that reading tools are reads', () => {
    for (const tool of ['Read', 'Grep', 'Glob']) {
      expect(hookAllows(tool, {})).toBe(true)
      expect(decideReadOnly(tool, {}).allow).toBe(true)
    }
  })

  it('refuses when it cannot read its own input', () => {
    // Unreadable input is not a reason to let a review write.
    const stdout = execFileSync(process.execPath, [scriptPath], {
      input: 'not json',
      encoding: 'utf8',
    })
    expect(JSON.parse(stdout).hookSpecificOutput.permissionDecision).toBe('deny')
  })
})
