import { describe, it, expect, beforeEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTempDir } from '../../support/temp-dir'

let userData: string

vi.mock('electron', () => ({ app: { getPath: () => userData } }))

beforeEach(() => {
  userData = makeTempDir('session-hook-ud-')
})

// ── The script itself ───────────────────────────────────────────────────────
// Run for real with node: the whole point of this file is what the runtime
// receives on stdout, and asserting on the source string would prove nothing.

async function runScript(
  contextFileContents: string | null,
  options: { sessionContextDir?: string; env?: Record<string, string> } = {}
): Promise<string> {
  const { installHookScript } = await import('../../../src/main/agents/claude-hook')
  const scriptPath = await installHookScript(userData)
  const contextFile = path.join(userData, 'ctx.json')
  if (contextFileContents !== null) fs.writeFileSync(contextFile, contextFileContents, 'utf8')
  const args = [
    scriptPath,
    path.join(userData, 'agent-sessions'),
    options.sessionContextDir ?? '',
    contextFile,
  ]
  return execFileSync(process.execPath, args, {
    encoding: 'utf8',
    env: options.env ? { ...process.env, ...options.env } : process.env,
  })
}

describe('the hook script, executed', () => {
  it('emits hookEventName — without it the runtime ignores the whole object', async () => {
    const out = await runScript(JSON.stringify({ markdown: '# TAV-42', key: 'TAV-42' }))
    expect(JSON.parse(out).hookSpecificOutput.hookEventName).toBe('SessionStart')
  })

  it('carries the context as additionalContext', async () => {
    const out = await runScript(
      JSON.stringify({ markdown: '# Linked issue: TAV-42', key: 'TAV-42' })
    )
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toBe('# Linked issue: TAV-42')
  })

  it('names the session after the issue', async () => {
    const out = await runScript(JSON.stringify({ markdown: 'x', key: 'TAV-42' }))
    expect(JSON.parse(out).hookSpecificOutput.sessionTitle).toBe('TAV-42')
  })

  it('prints nothing and exits 0 when the context file is missing', async () => {
    expect(await runScript(null)).toBe('')
  })

  it('prints nothing and exits 0 when the context file is malformed', async () => {
    expect(await runScript('{{{ not json')).toBe('')
  })

  it('prints nothing when the context has no markdown', async () => {
    expect(await runScript(JSON.stringify({ key: 'TAV-42' }))).toBe('')
    expect(await runScript(JSON.stringify({ markdown: '', key: 'TAV-42' }))).toBe('')
  })

  it('survives a context file that is valid JSON but not an object', async () => {
    expect(await runScript('"just a string"')).toBe('')
    expect(await runScript('null')).toBe('')
  })
})

describe('the hook script, when the session has its own link', () => {
  let sessionContextDir: string

  beforeEach(() => {
    sessionContextDir = makeTempDir('session-hook-sctx-')
  })

  it('stays silent — the session’s own hook already printed its context', async () => {
    fs.writeFileSync(
      path.join(sessionContextDir, 'term-1.json'),
      JSON.stringify({ markdown: '# own link', key: 'OWN-1' }),
      'utf8'
    )
    const out = await runScript(JSON.stringify({ markdown: '# project link', key: 'PROJ-1' }), {
      sessionContextDir,
      env: { TERMINATOR_SESSION_ID: 'term-1' },
    })
    expect(out).toBe('')
  })

  it('prints the project context when the session has no context file of its own', async () => {
    const out = await runScript(JSON.stringify({ markdown: '# project link', key: 'PROJ-1' }), {
      sessionContextDir,
      env: { TERMINATOR_SESSION_ID: 'term-1' },
    })
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toBe('# project link')
  })
})

describe('the hook script, in a project entry', () => {
  it('writes no session record: the user-level entry owns that', async () => {
    await runScript(JSON.stringify({ markdown: '# project link', key: 'PROJ-1' }), {
      env: { TERMINATOR_SESSION_ID: 'term-1' },
    })
    expect(fs.existsSync(path.join(userData, 'agent-sessions'))).toBe(false)
  })
})

describe('the hook script, with no terminal id', () => {
  let sessionContextDir: string

  beforeEach(() => {
    sessionContextDir = makeTempDir('session-hook-sctx-')
  })

  it('prints as before when there is no terminal id at all', async () => {
    const out = await runScript(JSON.stringify({ markdown: '# project link', key: 'PROJ-1' }), {
      sessionContextDir,
      env: { TERMINATOR_SESSION_ID: '' },
    })
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toBe('# project link')
  })
})
