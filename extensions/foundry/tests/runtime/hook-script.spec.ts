import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { installHookScript, HOOK_SCRIPT_NAME } from '../../src/runtime/hook-script.js'
import { createControlServer, type ControlServer } from '../../src/runtime/control-server.js'

// The script is run, not read. It is the one part of this feature that
// executes outside the application, in a process Claude Code owns, and the
// only thing that proves it works is running it exactly as Claude Code does:
// hook JSON on stdin, decision JSON on stdout.

let directory: string
let server: ControlServer | null = null

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hook-script-'))
})

afterEach(async () => {
  await server?.close()
  server = null
  rmSync(directory, { recursive: true, force: true, maxRetries: 5 })
})

const HOOK_INPUT = JSON.stringify({
  session_id: 'runtime-1',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'rm -rf /' },
})

function run(script: string, args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [script, ...args],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
    child.stdin?.end(stdin)
  })
}

describe('installHookScript', () => {
  it('writes the script where it says it did', () => {
    const path = installHookScript(directory)
    expect(path).toBe(join(directory, HOOK_SCRIPT_NAME))
    expect(existsSync(path)).toBe(true)
  })

  it('creates the directory rather than requiring one', () => {
    const nested = join(directory, 'a', 'b')
    expect(existsSync(installHookScript(nested))).toBe(true)
  })

  it('overwrites a stale copy from an older version', () => {
    const path = join(directory, HOOK_SCRIPT_NAME)
    installHookScript(directory)
    const fresh = readFileSync(path, 'utf8')
    rmSync(path)
    installHookScript(directory)
    expect(readFileSync(path, 'utf8')).toBe(fresh)
  })
})

describe('the hook script, run the way Claude Code runs it', () => {
  it('reports allow as the documented hookSpecificOutput shape', async () => {
    server = await createControlServer()
    server.register('s1', { decide: async () => ({ permissionDecision: 'allow' }) })
    const stdout = await run(
      installHookScript(directory),
      [server.url, server.token, 's1'],
      HOOK_INPUT
    )
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    })
  })

  it('passes the tool and its input through to the console', async () => {
    server = await createControlServer()
    let seen: unknown = null
    server.register('s1', {
      decide: async (request) => {
        seen = request
        return { permissionDecision: 'allow' }
      },
    })
    await run(installHookScript(directory), [server.url, server.token, 's1'], HOOK_INPUT)
    expect(seen).toEqual({
      sessionId: 's1',
      toolName: 'Bash',
      input: { command: 'rm -rf /' },
    })
  })

  it('carries the operator words back to the agent as the decision reason', async () => {
    server = await createControlServer()
    server.register('s1', {
      decide: async () => ({
        permissionDecision: 'deny',
        reason: 'use the staging host',
      }),
    })
    const stdout = await run(
      installHookScript(directory),
      [server.url, server.token, 's1'],
      HOOK_INPUT
    )
    // permissionDecisionReason, inside hookSpecificOutput: verified against the
    // binary. A systemMessage beside it is silently dropped.
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'use the staging host',
      },
    })
  })

  it('carries an edited input back inside hookSpecificOutput, where the runtime reads it', async () => {
    server = await createControlServer()
    server.register('s1', {
      decide: async () => ({
        permissionDecision: 'allow',
        updatedInput: { command: 'ls' },
      }),
    })
    const stdout = await run(
      installHookScript(directory),
      [server.url, server.token, 's1'],
      HOOK_INPUT
    )
    expect(JSON.parse(stdout).hookSpecificOutput).toEqual({
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { command: 'ls' },
    })
  })

  it('asks in the terminal when the console cannot be reached', async () => {
    // Nothing is listening on this port: the console is closed, or crashed.
    const stdout = await run(
      installHookScript(directory),
      ['http://127.0.0.1:1/pretooluse', 'token', 's1'],
      HOOK_INPUT
    )
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
    })
  })

  it('asks in the terminal when the console refuses the token', async () => {
    server = await createControlServer()
    server.register('s1', { decide: async () => ({ permissionDecision: 'allow' }) })
    const stdout = await run(installHookScript(directory), [server.url, 'wrong', 's1'], HOOK_INPUT)
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
    })
  })

  it('asks in the terminal when the console answers something unrecognisable', async () => {
    server = await createControlServer()
    server.register('s1', { decide: async () => ({ permissionDecision: 'maybe' }) as never })
    const stdout = await run(
      installHookScript(directory),
      [server.url, server.token, 's1'],
      HOOK_INPUT
    )
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
    })
  })

  it('asks in the terminal when handed something that is not hook input', async () => {
    server = await createControlServer()
    server.register('s1', { decide: async () => ({ permissionDecision: 'allow' }) })
    const stdout = await run(
      installHookScript(directory),
      [server.url, server.token, 's1'],
      'not json'
    )
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
    })
  })

  it('exits zero even when it denies, so the runtime reads the decision rather than an error', async () => {
    server = await createControlServer()
    server.register('s1', { decide: async () => ({ permissionDecision: 'deny' }) })
    await expect(
      run(installHookScript(directory), [server.url, server.token, 's1'], HOOK_INPUT)
    ).resolves.toBeTruthy()
  })
})

describe('the hook script reporting a lifecycle event', () => {
  const STOP_INPUT = JSON.stringify({
    session_id: 'runtime-1',
    hook_event_name: 'Stop',
    reason: 'end_turn',
  })

  it('tells the console the turn ended', async () => {
    server = await createControlServer()
    const seen: string[] = []
    server.register('s1', {
      decide: async () => ({ permissionDecision: 'allow' }),
      onEvent: (kind) => seen.push(kind),
    })
    await run(
      installHookScript(directory),
      [server.eventUrl, server.token, 's1', 'stop'],
      STOP_INPUT
    )
    expect(seen).toEqual(['stop'])
  })

  it('tells the console the session ended', async () => {
    server = await createControlServer()
    const seen: string[] = []
    server.register('s1', {
      decide: async () => ({ permissionDecision: 'allow' }),
      onEvent: (kind) => seen.push(kind),
    })
    await run(
      installHookScript(directory),
      [server.eventUrl, server.token, 's1', 'session_end'],
      STOP_INPUT
    )
    expect(seen).toEqual(['session_end'])
  })

  it('says nothing to the agent, because a lifecycle report is not a decision', async () => {
    server = await createControlServer()
    server.register('s1', { decide: async () => ({ permissionDecision: 'allow' }) })
    const stdout = await run(
      installHookScript(directory),
      [server.eventUrl, server.token, 's1', 'stop'],
      STOP_INPUT
    )
    expect(stdout).toBe('')
  })

  it('gets out of the way when the console is not listening', async () => {
    await expect(
      run(
        installHookScript(directory),
        ['http://127.0.0.1:1/event', 'token', 's1', 'stop'],
        STOP_INPUT
      )
    ).resolves.toBe('')
  })
})
