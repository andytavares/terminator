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
    expect(typed).toContain('SPECIFY_FEATURE=021-thing')
    expect(typed).toContain('SPECIFY_FEATURE_DIRECTORY=specs/021-thing')
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
