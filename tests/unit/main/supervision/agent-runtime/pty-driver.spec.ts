import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createPtyDriver } from '../../../../../src/main/supervision/agent-runtime/pty-driver.js'
import {
  createControlServer,
  type ControlServer,
} from '../../../../../src/main/supervision/agent-runtime/control-server.js'
import type { SessionEvent } from '../../../../../src/main/supervision/events/session-event.js'
import type { LaunchSpec } from '../../../../../src/main/supervision/agent-runtime/claude-launch.js'
import type { SessionDriver } from '../../../../../src/main/supervision/agent-runtime/driver-contract.js'

// The driver does not talk to the agent. It types into a terminal and listens
// on the control server, so what these assert is what gets typed and what the
// console is told — not what a mocked SDK was called with.

const ESC = '\x1b'

let directory: string
let control: ControlServer
let events: SessionEvent[]
let typed: Array<{ terminal: string; data: string }>
let closed: string[]
let openedWith: LaunchSpec | null
let terminalId: string | null

function makeDriver(): SessionDriver {
  return createPtyDriver({
    publish: (event) => events.push(event),
    now: () => 1_000,
    control,
    settingsDirectory: join(directory, 'settings'),
    hookScriptPath: join(directory, 'hook.mjs'),
    openTerminal: async (spec) => {
      openedWith = spec
      return terminalId === null ? null : { terminalSessionId: terminalId, projectId: 'project-1' }
    },
    write: (terminal, data) => typed.push({ terminal, data }),
    closeTerminal: (terminal) => closed.push(terminal),
  })
}

const start = {
  sessionId: '11111111-2222-3333-4444-555555555555',
  prompt: 'Implement T001',
  cwd: '/tmp/wt/one',
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'pty-driver-'))
  control = await createControlServer()
  events = []
  typed = []
  closed = []
  openedWith = null
  terminalId = 'terminal-1'
})

afterEach(async () => {
  await control.close()
  rmSync(directory, { recursive: true, force: true, maxRetries: 5 })
})

const kinds = (): string[] => events.map((event) => event.kind)

describe('starting a session', () => {
  it('opens a terminal in the provisioned working copy', async () => {
    await makeDriver().start(start)
    expect(openedWith?.cwd).toBe('/tmp/wt/one')
  })

  it('types the command rather than spawning the agent itself', async () => {
    await makeDriver().start(start)
    expect(typed).toEqual([{ terminal: 'terminal-1', data: `${openedWith?.command}\r` }])
  })

  it('runs claude under the session id the console chose', async () => {
    await makeDriver().start(start)
    expect(openedWith?.command).toContain(`--session-id ${start.sessionId}`)
  })

  it('reports where the transcript will be, before the process has written one', async () => {
    await makeDriver().start(start)
    const started = events.find((event) => event.kind === 'session_started')
    expect(started).toMatchObject({ cwd: '/tmp/wt/one' })
    expect((started as { transcriptPath: string }).transcriptPath).toContain(start.sessionId)
  })

  it('says which terminal the session is running in', async () => {
    const driver = makeDriver()
    await driver.start(start)
    expect(driver.terminalFor(start.sessionId)).toBe('terminal-1')
  })

  it('ends the session out loud when no terminal could be opened', async () => {
    terminalId = null
    await makeDriver().start(start)
    // Not left to the stall detector to notice in eight minutes.
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'session_ended', outcome: 'error' })
    )
  })

  it('types nothing when there is no terminal to type into', async () => {
    terminalId = null
    await makeDriver().start(start)
    expect(typed).toEqual([])
  })
})

describe('a tool call the agent cannot make on its own', () => {
  // Deliberately not async: awaiting a function that returns a pending promise
  // would unwrap it, and the whole point is that it stays unresolved.
  //
  // The rejection handler matters. A request left pending on purpose is severed
  // when the server closes at teardown, and an unhandled rejection out of a
  // socket nobody is listening to would be reported as a suite error.
  function ask(): Promise<unknown> {
    const pending = fetch(control.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: start.sessionId,
        toolName: 'Bash',
        input: { command: 'rm -rf /' },
      }),
    }).then((response) => response.json())
    pending.catch(() => {})
    return pending
  }

  /** Lets the request reach the handler and raise its prompt. */
  const settle = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 40))

  function requestId(): string {
    return (events.find((event) => event.kind === 'permission_requested') as { requestId: string })
      .requestId
  }

  it('reaches the console as a request a surface can show', async () => {
    await makeDriver().start(start)
    void ask()
    await settle()
    expect(kinds()).toContain('permission_requested')
  })

  it('shows what is actually being asked, not the tool name', async () => {
    await makeDriver().start(start)
    void ask()
    await settle()
    expect(events.find((event) => event.kind === 'permission_requested')).toMatchObject({
      summary: 'rm -rf /',
    })
  })

  it('stays blocked until the operator answers', async () => {
    const driver = makeDriver()
    await driver.start(start)
    const pending = ask()
    await settle()

    let settled = false
    void pending.then(() => (settled = true)).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(settled).toBe(false)
  })

  it('lets the agent proceed when the operator allows it', async () => {
    const driver = makeDriver()
    await driver.start(start)
    const pending = ask()
    await settle()

    driver.resolvePermission(start.sessionId, requestId(), { allow: true })
    expect(await pending).toMatchObject({ permissionDecision: 'allow' })
  })

  it('carries a real answer back as the decision reason, since that is the only channel', async () => {
    const driver = makeDriver()
    await driver.start(start)
    const pending = ask()
    await settle()

    driver.resolvePermission(start.sessionId, requestId(), {
      allow: false,
      answer: 'use the staging host',
    })
    expect(await pending).toEqual({
      permissionDecision: 'deny',
      reason: 'use the staging host',
    })
  })

  it('is decided by the autonomy ladder without troubling the operator', async () => {
    const driver = createPtyDriver({
      publish: (event) => events.push(event),
      now: () => 1_000,
      control,
      settingsDirectory: join(directory, 'settings'),
      hookScriptPath: join(directory, 'hook.mjs'),
      openTerminal: async () => ({ terminalSessionId: 'terminal-1', projectId: null }),
      write: () => {},
      closeTerminal: () => {},
    })
    await driver.start({ ...start, autoDecide: () => ({ allow: true }) })
    expect(await ask()).toMatchObject({ permissionDecision: 'allow' })
    expect(kinds()).not.toContain('permission_requested')
  })
})

describe('what the agent reports back', () => {
  async function report(kind: string): Promise<void> {
    await fetch(control.eventUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: start.sessionId, kind }),
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  it('finishing a turn is not the session ending', async () => {
    await makeDriver().start(start)
    await report('stop')
    expect(kinds()).toContain('turn_finished')
    expect(kinds()).not.toContain('session_ended')
  })

  it('reports no cost rather than a confident zero it did not measure', async () => {
    await makeDriver().start(start)
    await report('stop')
    // The transcript carries neither cost nor context window; the surfaces show
    // nothing rather than $0.00.
    expect(events.find((event) => event.kind === 'turn_finished')).toMatchObject({
      costUsd: 0,
      contextPct: null,
    })
  })

  it('ends the session when the conversation ends', async () => {
    await makeDriver().start(start)
    await report('session_end')
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'session_ended', outcome: 'success' })
    )
  })

  it('lets anything waiting on the run finish', async () => {
    const driver = makeDriver()
    await driver.start(start)
    await report('session_end')
    await expect(driver.completion(start.sessionId)).resolves.toBeUndefined()
  })

  it('forgets the terminal once the session has ended', async () => {
    const driver = makeDriver()
    await driver.start(start)
    await report('session_end')
    expect(driver.terminalFor(start.sessionId)).toBeNull()
  })
})

describe('taking over a running session', () => {
  it('sends a reply by typing it, exactly as the operator would', async () => {
    const driver = makeDriver()
    await driver.start(start)
    typed.length = 0
    await driver.send(start.sessionId, 'try the other approach')
    expect(typed).toEqual([{ terminal: 'terminal-1', data: 'try the other approach\r' }])
  })

  it('says so rather than swallowing a reply to a session that has ended', async () => {
    const driver = makeDriver()
    await expect(driver.send('nobody', 'hello')).rejects.toThrow('no longer running')
  })

  it('interrupts the turn without ending the session, so a redirect still lands', async () => {
    const driver = makeDriver()
    await driver.start(start)
    typed.length = 0
    await driver.interrupt(start.sessionId)
    await driver.send(start.sessionId, 'do it differently')
    expect(typed).toEqual([
      { terminal: 'terminal-1', data: ESC },
      { terminal: 'terminal-1', data: 'do it differently\r' },
    ])
  })

  it('does nothing when asked to interrupt a session that is not running', async () => {
    await expect(makeDriver().interrupt('nobody')).resolves.toBeUndefined()
  })
})

describe('stopping', () => {
  it('stops the turn first, so the reason is not queued behind it', async () => {
    const driver = makeDriver()
    await driver.start(start)
    typed.length = 0
    await driver.stop(start.sessionId, 'wrong branch')
    expect(typed.map((entry) => entry.data)).toEqual([ESC, 'wrong branch\r', '/exit\r'])
  })

  it('ends the conversation when there is nothing to say', async () => {
    const driver = makeDriver()
    await driver.start(start)
    typed.length = 0
    await driver.stop(start.sessionId)
    expect(typed.map((entry) => entry.data)).toEqual([ESC, '/exit\r'])
  })

  it('ignores a reason that is only whitespace', async () => {
    const driver = makeDriver()
    await driver.start(start)
    typed.length = 0
    await driver.stop(start.sessionId, '   ')
    expect(typed.map((entry) => entry.data)).toEqual([ESC, '/exit\r'])
  })

  it('reports that there was no live run to stop', async () => {
    // The caller has to end the session itself, or Stop does nothing at all.
    await expect(makeDriver().stop('nobody')).resolves.toBe(false)
  })
})

describe('discarding', () => {
  it('closes the terminal, because its working copy is about to be removed', async () => {
    const driver = makeDriver()
    await driver.start(start)
    driver.dispose(start.sessionId)
    expect(closed).toEqual(['terminal-1'])
  })

  it('forgets the session', async () => {
    const driver = makeDriver()
    await driver.start(start)
    driver.dispose(start.sessionId)
    expect(driver.terminalFor(start.sessionId)).toBeNull()
  })

  it('does nothing for a session it does not have', async () => {
    expect(() => makeDriver().dispose('nobody')).not.toThrow()
  })

  it('stops answering the agent, rather than leaving a tool call open forever', async () => {
    const driver = makeDriver()
    await driver.start(start)
    const pending = fetch(control.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: start.sessionId, toolName: 'Bash', input: {} }),
    }).then((response) => response.json())
    pending.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 30))

    driver.dispose(start.sessionId)
    expect(await pending).toMatchObject({ permissionDecision: 'deny' })
  })
})
