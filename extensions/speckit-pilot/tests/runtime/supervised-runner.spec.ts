import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSupervisedRunner } from '../../src/runtime/supervised-runner.js'
import { createControlServer, type ControlServer } from '../../src/runtime/control-server.js'
import type { PendingPermission } from '../../src/runtime/permission-bridge.js'

// This replaces spawning `claude --print --permission-mode bypassPermissions`
// as a hidden child process — a run nobody could see, approving every tool call
// on the operator's behalf. What is asserted here is what the operator ends up
// with: a project, a terminal, a typed command, and a tool call that waits.

const ESC = '\x1b'

let dir: string
let control: ControlServer
let created: Array<Record<string, unknown>>
let opened: Array<Record<string, unknown>>
let written: Array<{ terminal: string; data: string }>
let terminalId: string | null
let projectId: string | null
let exitListener: ((exitCode: number) => void) | null
let exitDetached: boolean

function api() {
  return {
    workspace: {
      createProject: (input: Record<string, unknown>) => {
        created.push(input)
        return projectId === null ? null : { id: projectId, workspaceId: 'ws-1', name: 'p' }
      },
    },
    pty: {
      openTerminalTab: (input: Record<string, unknown>) => {
        opened.push(input)
        return terminalId
      },
      write: (terminal: string, data: string) => written.push({ terminal, data }),
      onExit: (_sessionId: string, listener: (exitCode: number) => void) => {
        exitListener = listener
        return () => {
          exitDetached = true
        }
      },
    },
  } as never
}

function runner() {
  return createSupervisedRunner({
    api: api(),
    control,
    stateDir: join(dir, 'state'),
    now: () => 1_000,
  })
}

const start = {
  featureDir: '/repo/specs/021-thing',
  worktreePath: '/wt/feat-thing',
  workspaceId: 'ws-1',
  branch: 'feat/thing',
  prompt: '/speckit-implement',
  phase: 'implement' as never,
  onPending: () => {},
  onResolved: () => {},
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'supervised-runner-'))
  control = await createControlServer()
  created = []
  opened = []
  written = []
  terminalId = 'terminal-1'
  projectId = 'project-1'
  exitListener = null
  exitDetached = false
})

afterEach(async () => {
  await control.close()
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
})

describe('starting a supervised run', () => {
  it('registers the worktree as a project, so the run has somewhere to live', async () => {
    await runner().start(start)
    expect(created[0]).toMatchObject({
      workspaceId: 'ws-1',
      name: 'feat/thing',
      worktreePath: '/wt/feat-thing',
      gitBranch: 'feat/thing',
    })
  })

  it('opens a terminal in that project rather than a hidden child process', async () => {
    await runner().start(start)
    expect(opened[0]).toMatchObject({
      projectId: 'project-1',
      cwd: '/wt/feat-thing',
      tabTitle: 'feat/thing',
      type: 'agent',
    })
  })

  it('types the launch command, under a session id it chose itself', async () => {
    const run = await runner().start(start)
    const command = written.map((w) => w.data).join('')
    expect(command).toContain(`--session-id ${run?.sessionId}`)
    expect(command).toContain('/speckit-implement')
  })

  it('never bypasses permissions — that is the whole point of the change', async () => {
    await runner().start(start)
    expect(written.map((w) => w.data).join('')).not.toContain('bypassPermissions')
  })

  it('points the skills at the card, so they work whatever the branch is called', async () => {
    await runner().start(start)
    const typed = written.map((w) => w.data).join('')
    // Quoted: it goes into the operator's shell, and a slug is not guaranteed
    // to be a bare word.
    expect(typed).toContain("SPECIFY_FEATURE='021-thing'")
    expect(typed).toContain("SPECIFY_FEATURE_DIRECTORY='specs/021-thing'")
  })

  it('knows where the transcript will be before the process exists', async () => {
    const run = await runner().start(start)
    expect(run?.transcriptPath).toContain(run?.sessionId ?? 'nope')
  })

  it('says which terminal it is running in', async () => {
    const r = runner()
    const run = await r.start(start)
    // The project as well as the tab: the core's navigation selects the
    // workspace and project before the session.
    expect(r.terminalFor(run?.sessionId ?? '')).toMatchObject({
      terminalSessionId: 'terminal-1',
    })
  })

  it('resumes an existing conversation rather than starting a second one', async () => {
    const run = await runner().start({ ...start, resumeSessionId: 'earlier-session' })
    expect(run?.sessionId).toBe('earlier-session')
  })

  it('starts nothing when the worktree cannot be made a project', async () => {
    projectId = null
    expect(await runner().start(start)).toBeNull()
    expect(opened).toEqual([])
  })

  it('starts nothing when no terminal can be opened — an unseen agent is the old failure', async () => {
    terminalId = null
    expect(await runner().start(start)).toBeNull()
    expect(written).toEqual([])
  })
})

describe('a tool call the agent may not make on its own', () => {
  function ask(sessionId: string): Promise<unknown> {
    const pending = fetch(control.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, toolName: 'Bash', input: { command: 'rm -rf /' } }),
    }).then((r) => r.json())
    pending.catch(() => {})
    return pending
  }
  const settle = (): Promise<unknown> => new Promise((r) => setTimeout(r, 40))

  it('reaches the operator instead of being approved for them', async () => {
    const seen: PendingPermission[] = []
    const r = runner()
    const run = await r.start({ ...start, onPending: (p) => seen.push(p) })
    void ask(run?.sessionId ?? '')
    await settle()
    expect(seen[0]).toMatchObject({ toolName: 'Bash', summary: 'rm -rf /' })
  })

  it('waits, rather than proceeding while nobody has answered', async () => {
    const r = runner()
    const run = await r.start(start)
    const pending = ask(run?.sessionId ?? '')
    let settled = false
    void pending.then(() => (settled = true)).catch(() => {})
    await settle()
    expect(settled).toBe(false)
  })

  it('proceeds once the operator allows it', async () => {
    const seen: PendingPermission[] = []
    const r = runner()
    const run = await r.start({ ...start, onPending: (p) => seen.push(p) })
    const pending = ask(run?.sessionId ?? '')
    await settle()
    r.resolve(run?.sessionId ?? '', seen[0].requestId, { allow: true })
    expect(await pending).toMatchObject({ permissionDecision: 'allow' })
  })

  it('carries a real answer back, since the reason is the only channel for words', async () => {
    const seen: PendingPermission[] = []
    const r = runner()
    const run = await r.start({ ...start, onPending: (p) => seen.push(p) })
    const pending = ask(run?.sessionId ?? '')
    await settle()
    r.resolve(run?.sessionId ?? '', seen[0].requestId, {
      allow: false,
      answer: 'use the staging host',
    })
    expect(await pending).toEqual({
      permissionDecision: 'deny',
      reason: 'use the staging host',
    })
  })

  it('is settled by the autonomy ladder without troubling the operator', async () => {
    const seen: PendingPermission[] = []
    const r = runner()
    const run = await r.start({
      ...start,
      autoDecide: () => ({ allow: true }),
      onPending: (p) => seen.push(p),
    })
    expect(await ask(run?.sessionId ?? '')).toMatchObject({ permissionDecision: 'allow' })
    expect(seen).toEqual([])
  })
})

describe('taking a run over, or ending it', () => {
  async function report(sessionId: string, kind: string): Promise<void> {
    await fetch(control.eventUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, kind }),
    })
    await new Promise((r) => setTimeout(r, 25))
  }

  it('sends a message by typing it, exactly as the operator would', async () => {
    const r = runner()
    const run = await r.start(start)
    written.length = 0
    expect(r.send(run?.sessionId ?? '', 'try the other approach')).toBe(true)
    expect(written).toEqual([{ terminal: 'terminal-1', data: 'try the other approach\r' }])
  })

  it('interrupts the turn without ending the run, so a redirect still lands', async () => {
    const r = runner()
    const run = await r.start(start)
    written.length = 0
    r.interrupt(run?.sessionId ?? '')
    r.send(run?.sessionId ?? '', 'do it differently')
    expect(written.map((w) => w.data)).toEqual([ESC, 'do it differently\r'])
  })

  it('stops the turn first, so the reason is not queued behind it', async () => {
    const r = runner()
    const run = await r.start(start)
    written.length = 0
    expect(r.stop(run?.sessionId ?? '', 'wrong branch')).toBe(true)
    expect(written.map((w) => w.data)).toEqual([ESC, 'wrong branch\r', '/exit\r'])
  })

  it('ends the conversation when there is nothing to say', async () => {
    const r = runner()
    const run = await r.start(start)
    written.length = 0
    r.stop(run?.sessionId ?? '')
    expect(written.map((w) => w.data)).toEqual([ESC, '/exit\r'])
  })

  it('reports that there was no live run to stop', async () => {
    expect(runner().stop('nobody')).toBe(false)
    expect(runner().send('nobody', 'hi')).toBe(false)
  })

  it('reports the end of a turn without calling the run over', async () => {
    const turns: number[] = []
    const ends: number[] = []
    const r = runner()
    const run = await r.start({
      ...start,
      onTurnEnd: (t) => turns.push(t),
      onEnd: () => ends.push(1),
    })
    await report(run?.sessionId ?? '', 'stop')
    expect(turns).toHaveLength(1)
    expect(ends).toEqual([])
  })

  it('reports the end of the conversation and forgets the run', async () => {
    const ends: number[] = []
    const r = runner()
    const run = await r.start({ ...start, onEnd: () => ends.push(1) })
    await report(run?.sessionId ?? '', 'session_end')
    expect(ends).toEqual([1])
    expect(r.terminalFor(run?.sessionId ?? '')).toBeNull()
  })

  it('stops answering the agent once disposed, rather than holding a call open', async () => {
    const r = runner()
    const run = await r.start(start)
    const pending = fetch(control.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: run?.sessionId, toolName: 'Bash', input: {} }),
    }).then((res) => res.json())
    pending.catch(() => {})
    await new Promise((res) => setTimeout(res, 30))
    r.dispose()
    expect(await pending).toMatchObject({ permissionDecision: 'deny' })
  })
})

describe('the environment the agent runs in', () => {
  it('forces session persistence, or there is no transcript to read', async () => {
    // Everything this runtime knows it reads from the transcript. The runtime
    // sets CLAUDE_CODE_CHILD_SESSION=1 in everything it spawns, and a nested
    // interactive session carrying that marker writes none — so when the
    // console itself was started from a Claude Code session, the stall
    // detector, the turn count and the card's console all read empty forever.
    await runner().start(start)
    expect(written.map((w) => w.data).join('\n')).toContain(
      'CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1'
    )
  })
})

describe('when the terminal itself goes', () => {
  // Supervised runs ended on the runtime's `session_end` hook. Closing the tab
  // fires no hook, so the phase stayed running with no completion ever
  // delivered.

  it('ends the run, carrying the terminal’s exit code', async () => {
    const ends: number[] = []
    const r = runner()
    await r.start({ ...start, onEnd: (code) => ends.push(code) })
    exitListener?.(137)
    expect(ends).toEqual([137])
  })

  it('takes the run off the register, so nothing keeps watching it', async () => {
    const r = runner()
    const run = await r.start(start)
    exitListener?.(0)
    expect(r.watchable().map((w) => w.sessionId)).not.toContain(run?.sessionId)
  })

  it('stops listening once the run is over', async () => {
    const r = runner()
    const run = await r.start(start)
    r.stop(run?.sessionId ?? '')
    exitListener?.(0)
    expect(exitDetached).toBe(true)
  })
})

async function reportEvent(sessionId: string, kind: string): Promise<void> {
  await fetch(control.eventUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, kind }),
  })
  await new Promise((r) => setTimeout(r, 25))
}

async function askPermission(sessionId: string): Promise<void> {
  const pending = fetch(control.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, toolName: 'Bash', input: { command: 'ls' } }),
  })
  pending.catch(() => {})
  await new Promise((r) => setTimeout(r, 40))
}

describe('running the next phase in the conversation that is already open', () => {
  it('finds the card its open session, so a phase need not start a new one', async () => {
    const supervised = runner()
    const run = await supervised.start(start)
    expect(supervised.liveSessionFor(start.featureDir)).toBe(run?.sessionId)
  })

  it('has no session for a card that has never run', () => {
    expect(runner().liveSessionFor('/repo/specs/999-nothing')).toBeNull()
  })

  it('opens no second terminal, which is where the tab-per-phase sprawl came from', async () => {
    const supervised = runner()
    const run = await supervised.start(start)
    opened.length = 0
    supervised.continueRun(run!.sessionId, {
      prompt: '/speckit-plan',
      phase: 'plan' as never,
      onPending: () => {},
      onResolved: () => {},
    })
    expect(opened).toEqual([])
    expect(created).toHaveLength(1)
  })

  it('types the next phase into the terminal the agent is already sitting in', async () => {
    const supervised = runner()
    const run = await supervised.start(start)
    written.length = 0
    supervised.continueRun(run!.sessionId, {
      prompt: '/speckit-plan',
      phase: 'plan' as never,
      onPending: () => {},
      onResolved: () => {},
    })
    expect(written).toEqual([{ terminal: 'terminal-1', data: '/speckit-plan\r' }])
  })

  it('keeps the session and its transcript, which is the point of reusing it', async () => {
    const supervised = runner()
    const run = await supervised.start(start)
    const continued = supervised.continueRun(run!.sessionId, {
      prompt: '/speckit-plan',
      phase: 'plan' as never,
      onPending: () => {},
      onResolved: () => {},
    })
    expect(continued).toEqual(run)
  })

  it('flattens a multi-line prompt, since a newline in a terminal means send', async () => {
    const supervised = runner()
    const run = await supervised.start(start)
    written.length = 0
    supervised.continueRun(run!.sessionId, {
      prompt: 'do this\nand that',
      phase: 'plan' as never,
      onPending: () => {},
      onResolved: () => {},
    })
    expect(written[0].data).toBe('do this and that\r')
  })

  it('reports nothing for a session that is gone, rather than typing into thin air', () => {
    // The tab was closed, or the console restarted. The caller's signal to open
    // a fresh conversation instead of silently dropping the phase.
    expect(
      runner().continueRun('never-existed', {
        prompt: '/speckit-plan',
        phase: 'plan' as never,
        onPending: () => {},
        onResolved: () => {},
      })
    ).toBeNull()
  })

  it('reports the new phase’s turn end, not the one that just finished', async () => {
    const supervised = runner()
    const seen: string[] = []
    const run = await supervised.start({ ...start, onTurnEnd: () => seen.push('specify') })
    supervised.continueRun(run!.sessionId, {
      prompt: '/speckit-plan',
      phase: 'plan' as never,
      onPending: () => {},
      onResolved: () => {},
      onTurnEnd: () => seen.push('plan'),
    })
    await reportEvent(run!.sessionId, 'stop')
    expect(seen).toEqual(['plan'])
  })

  it('reports the new phase’s permission asks, not the one that just finished', async () => {
    const supervised = runner()
    const seen: string[] = []
    const run = await supervised.start({
      ...start,
      onPending: () => seen.push('specify'),
    })
    supervised.continueRun(run!.sessionId, {
      prompt: '/speckit-plan',
      phase: 'plan' as never,
      onPending: () => seen.push('plan'),
      onResolved: () => {},
    })
    await askPermission(run!.sessionId)
    expect(seen).toEqual(['plan'])
  })

  it('clears the waiting flag, so the new phase is not born already blocked', async () => {
    const supervised = runner()
    const run = await supervised.start(start)
    await reportEvent(run!.sessionId, 'stop')
    expect(supervised.watchable()[0].isWaiting).toBe(true)
    supervised.continueRun(run!.sessionId, {
      prompt: '/speckit-plan',
      phase: 'plan' as never,
      onPending: () => {},
      onResolved: () => {},
    })
    expect(supervised.watchable()[0].isWaiting).toBe(false)
  })
})

describe('an agent sitting at its prompt', () => {
  it('counts as blocked on a person, not as having stopped making progress', async () => {
    // A phase that finished cleanly and was waiting to be approved went quiet,
    // fired a stall eight minutes later, and stayed in the Stalls tab offering
    // to interrupt work that was already done.
    const supervised = runner()
    const run = await supervised.start(start)
    expect(supervised.watchable()[0].isWaiting).toBe(false)
    await reportEvent(run!.sessionId, 'stop')
    expect(supervised.watchable()[0].isWaiting).toBe(true)
  })

  it('is working again once it has been given something to do', async () => {
    const supervised = runner()
    const run = await supervised.start(start)
    await reportEvent(run!.sessionId, 'stop')
    supervised.send(run!.sessionId, 'carry on')
    expect(supervised.watchable()[0].isWaiting).toBe(false)
  })
})

describe('acting on a session that is not there', () => {
  // Every one of these is reachable from the panel: it polls every five
  // seconds, so a row can be clicked after the run behind it has ended.
  it('refuses to answer a tool call for it, rather than reporting success', () => {
    expect(runner().resolve('gone', 'request-1', { permissionDecision: 'allow' })).toBe(false)
  })

  it('shrugs off handing one back to a terminal that is not there', () => {
    expect(() => runner().handBackToTerminal('gone', 'request-1')).not.toThrow()
  })

  it('shrugs off interrupting it', () => {
    const supervised = runner()
    supervised.interrupt('gone')
    expect(written).toEqual([])
  })

  it('says so when asked to stop it, so a surface can report the truth', () => {
    expect(runner().stop('gone')).toBe(false)
  })

  it('says so when asked to send it a message', () => {
    expect(runner().send('gone', 'carry on')).toBe(false)
  })

  it('has no terminal to send anyone to', () => {
    expect(runner().terminalFor('gone')).toBeNull()
  })

  it('ends twice without complaint, since the terminal and the runtime both report it', async () => {
    // A clean `/exit` fires the runtime's SessionEnd hook and the terminal's
    // own exit; whichever arrives second finds the run already gone.
    const supervised = runner()
    const run = await supervised.start(start)
    exitListener?.(0)
    expect(() => exitListener?.(0)).not.toThrow()
    expect(supervised.terminalFor(run!.sessionId)).toBeNull()
  })
})
