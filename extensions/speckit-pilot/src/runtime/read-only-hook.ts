import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// The hook self-review runs before every tool call.
//
// Unlike the supervised path's hook, this one asks nobody: it decides from a
// fixed read-only policy and exits. Self-review is an automated gate — format,
// lint, tests, then a review — so waiting on a person would turn a check into a
// flaky failure, and the five-minute hand-back would fire on every run.
//
// It carries its own copy of the policy because it executes in a process Claude
// Code owns, with no bundler and nothing to import. `read-only-policy.ts` is the
// same rules as a module, kept in step by a test that runs this script against
// it — so the two cannot drift silently.

export const READ_ONLY_HOOK_SCRIPT = `// Written by SpecKit Pilot. Do not edit: overwritten on every start.
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'NotebookRead', 'TodoWrite', 'Task'])
const READ_ONLY_BINARIES = new Set([
  'cat', 'head', 'tail', 'wc', 'ls', 'find', 'grep', 'rg', 'sed', 'awk', 'file', 'stat', 'diff',
])
const READ_ONLY_GIT = new Set([
  'diff', 'log', 'show', 'status', 'rev-parse', 'ls-files', 'blame', 'describe', 'branch',
  'remote', 'config',
])
// Anything that chains, redirects or substitutes. Without this an allowlist is
// theatre: 'git diff' passes and so does 'git diff; rm -rf .'.
const COMPOUND = /[;&|><\`]|\\$\\(/

function decide(toolName, input) {
  if (READ_ONLY_TOOLS.has(toolName)) return { allow: true, reason: toolName + ' cannot change anything' }
  if (toolName !== 'Bash') {
    return { allow: false, reason: toolName + ' can change things; a review may only read' }
  }
  const command = input && typeof input.command === 'string' ? input.command : ''
  if (command.trim() === '') return { allow: false, reason: 'a Bash call with no command cannot be checked' }
  if (COMPOUND.test(command)) {
    return { allow: false, reason: 'a review may only run a single command with no redirection or chaining' }
  }
  const words = command.trim().split(/\\s+/)
  const binary = words[0]
  if (binary === 'git') {
    const sub = words[1] || ''
    return READ_ONLY_GIT.has(sub)
      ? { allow: true, reason: 'git ' + sub + ' only reads' }
      : { allow: false, reason: 'git ' + (sub || '(none)') + ' is not a read-only git command' }
  }
  return READ_ONLY_BINARIES.has(binary)
    ? { allow: true, reason: binary + ' only reads' }
    : { allow: false, reason: binary + " is not on the review's read-only list" }
}

let body = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { body += chunk })
process.stdin.on('end', () => {
  let hookInput
  try {
    hookInput = JSON.parse(body)
  } catch {
    // Unreadable input is not a reason to let a review write.
    hookInput = { tool_name: 'unknown', tool_input: {} }
  }
  const verdict = decide(hookInput.tool_name, hookInput.tool_input || {})
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: verdict.allow ? 'allow' : 'deny',
        permissionDecisionReason: verdict.reason,
      },
    })
  )
  process.exit(0)
})
`

export const READ_ONLY_HOOK_NAME = 'read-only-hook.mjs'

export function installReadOnlyHookScript(directory: string): string {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, READ_ONLY_HOOK_NAME)
  writeFileSync(path, READ_ONLY_HOOK_SCRIPT, 'utf8')
  return path
}

/**
 * The settings self-review runs under. No control server and no session: every
 * decision is made in the hook itself, so the review never blocks and never
 * bypasses.
 */
export function buildReadOnlySettings(hookScriptPath: string, nodePath: string): unknown {
  const command = [
    'ELECTRON_RUN_AS_NODE=1',
    `'${nodePath.replace(/'/g, `'\\''`)}'`,
    `'${hookScriptPath.replace(/'/g, `'\\''`)}'`,
  ].join(' ')
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: '*',
          // Seconds: it decides locally, so anything slower is a hung script
          // rather than a slow decision.
          hooks: [{ type: 'command', command, timeout: 30 }],
        },
      ],
    },
  }
}
