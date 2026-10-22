import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PtyManager } from '../../../src/main/terminal/pty-manager'

const mockPty = {
  pid: 12345,
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
}

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => mockPty),
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getVersion: () => '0.1.0',
  },
}))

const fsMock = vi.hoisted(() => ({
  // Every cwd is a real directory unless a test says otherwise.
  statSync: vi.fn((): { isDirectory: () => boolean } => ({ isDirectory: () => true })),
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '[]'),
  writeFileSync: vi.fn(),
  statSync: fsMock.statSync,
}))

// A test that makes a cwd missing or a file must not leave it so for the next.
beforeEach(() => {
  fsMock.statSync.mockImplementation(() => ({ isDirectory: () => true }))
})

async function makeManager() {
  const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
  return new PtyManager()
}

function usePtyMocks(): void {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockPty.onData.mockImplementation((_cb: unknown) => {})
    mockPty.onExit.mockImplementation((_cb: unknown) => {})
  })
}

describe('PtyManager — a cwd that is not there', () => {
  usePtyMocks()

  // node-pty's child cannot chdir and exits 1 with no output, a tab that dies showing
  // nothing; only up front does the reason still exist.
  it('refuses to spawn, and names the folder', async () => {
    const { PtyManager, MissingCwdError } = await import('../../../src/main/terminal/pty-manager')
    const pty = await import('node-pty')
    fsMock.statSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    const mgr = new PtyManager()
    const cwd = '/repo/.worktrees/removed'
    const spawn = () =>
      mgr.spawnSession({ sessionId: 'gone', cwd, shell: '/bin/zsh', type: 'human', origin: 'app' })

    expect(spawn).toThrow(MissingCwdError)
    expect(spawn).toThrow(cwd)
    expect(pty.spawn).not.toHaveBeenCalled()
    expect(mgr.getSessionIds()).toHaveLength(0)
  })
})

describe('PtyManager — a cwd that is a file', () => {
  usePtyMocks()

  it('refuses a cwd that exists but is a file', async () => {
    const { PtyManager, MissingCwdError } = await import('../../../src/main/terminal/pty-manager')
    const pty = await import('node-pty')
    fsMock.statSync.mockImplementation(() => ({ isDirectory: () => false }))
    const mgr = new PtyManager()

    expect(() =>
      mgr.spawnSession({
        sessionId: 'file',
        cwd: '/repo/README.md',
        shell: '/bin/zsh',
        type: 'human',
        origin: 'app',
      })
    ).toThrow(MissingCwdError)
    expect(pty.spawn).not.toHaveBeenCalled()
  })
})

describe('PtyManager', () => {
  usePtyMocks()

  it('spawnSession creates a PTY and returns the session info', async () => {
    const mgr = await makeManager()
    const sessionId = 'test-session-1'
    const result = mgr.spawnSession({
      sessionId,
      cwd: '/home',
      shell: '/bin/bash',
      type: 'human',
      origin: 'app',
    })
    expect(result.sessionId).toBe(sessionId)
    expect(mgr.getSessionIds()).toContain(sessionId)
  })

  it('resize calls pty.resize', async () => {
    const mgr = await makeManager()
    const id = 'resize-session'
    mgr.spawnSession({ sessionId: id, cwd: '/', shell: '/bin/bash', type: 'human', origin: 'app' })
    mgr.resize(id, 120, 40)
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40)
  })
})

describe('PtyManager — flow control and writing', () => {
  usePtyMocks()

  it('pause and resume stop and restart reading from the PTY', async () => {
    const mgr = await makeManager()
    const id = 'flow-session'
    mgr.spawnSession({ sessionId: id, cwd: '/', shell: '/bin/bash', type: 'human', origin: 'app' })
    mgr.pause(id)
    expect(mockPty.pause).toHaveBeenCalledTimes(1)
    expect(mockPty.resume).not.toHaveBeenCalled()
    mgr.resume(id)
    expect(mockPty.resume).toHaveBeenCalledTimes(1)
  })

  it('pause and resume are no-ops for unknown sessionId', async () => {
    const mgr = await makeManager()
    expect(() => {
      mgr.pause('no-such')
      mgr.resume('no-such')
    }).not.toThrow()
    expect(mockPty.pause).not.toHaveBeenCalled()
  })

  it('write sends data to PTY', async () => {
    const mgr = await makeManager()
    const id = 'write-session'
    mgr.spawnSession({ sessionId: id, cwd: '/', shell: '/bin/bash', type: 'human', origin: 'app' })
    mgr.write(id, 'ls\n')
    expect(mockPty.write).toHaveBeenCalledWith('ls\n')
  })
})

describe('PtyManager — kill', () => {
  usePtyMocks()

  it('kill terminates process', async () => {
    const mgr = await makeManager()
    const id = 'kill-session'
    mgr.spawnSession({ sessionId: id, cwd: '/', shell: '/bin/bash', type: 'human', origin: 'app' })
    mgr.kill(id)
    expect(mockPty.kill).toHaveBeenCalled()
    expect(mgr.getSessionIds()).not.toContain(id)
  })

  it('killAll terminates all tracked PTY processes', async () => {
    const mgr = await makeManager()
    mgr.spawnSession({
      sessionId: 's1',
      cwd: '/',
      shell: '/bin/bash',
      type: 'human',
      origin: 'app',
    })
    mgr.spawnSession({
      sessionId: 's2',
      cwd: '/',
      shell: '/bin/bash',
      type: 'agent',
      origin: 'app',
    })
    await mgr.killAll()
    expect(mgr.getSessionIds()).toHaveLength(0)
  })
})

describe('PtyManager — kill when nothing is there', () => {
  usePtyMocks()

  it('kill is a no-op for unknown sessionId', async () => {
    const mgr = await makeManager()
    // Should not throw
    expect(() => mgr.kill('nonexistent-session')).not.toThrow()
    expect(mockPty.kill).not.toHaveBeenCalled()
  })

  it('kill swallows errors thrown by pty.kill()', async () => {
    mockPty.kill.mockImplementationOnce(() => {
      throw new Error('already dead')
    })
    const mgr = await makeManager()
    const id = 'kill-err'
    mgr.spawnSession({ sessionId: id, cwd: '/', shell: '/bin/bash', type: 'human', origin: 'app' })
    expect(() => mgr.kill(id)).not.toThrow()
    expect(mgr.getSessionIds()).not.toContain(id)
  })
})

describe('PtyManager — exit and missing registries', () => {
  usePtyMocks()

  it('onExit callback removes session and calls user onExit', async () => {
    let capturedOnExit: ((args: { exitCode: number }) => void) | undefined
    mockPty.onExit.mockImplementation((cb: (args: { exitCode: number }) => void) => {
      capturedOnExit = cb
    })

    const mgr = await makeManager()
    const onExit = vi.fn()
    const id = 'exit-session'
    mgr.spawnSession({ sessionId: id, cwd: '/', shell: '/bin/bash', type: 'human', origin: 'app' })
    mgr.onExit(id, onExit)

    expect(mgr.getSessionIds()).toContain(id)
    capturedOnExit?.({ exitCode: 0 })
    expect(onExit).toHaveBeenCalledWith(0)
    expect(mgr.getSessionIds()).not.toContain(id)
  })
})

describe('PtyManager — missing registries', () => {
  usePtyMocks()

  it('cleanupOrphans returns 0 when registry file does not exist', async () => {
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const mgr = await makeManager()
    const result = mgr.cleanupOrphans()
    expect(result).toEqual({ cleanedCount: 0 })
  })

  it('cleanupOrphans returns 0 when registry JSON is malformed', async () => {
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('NOT_JSON')

    const mgr = await makeManager()
    const result = mgr.cleanupOrphans()
    expect(result).toEqual({ cleanedCount: 0 })
  })
})

describe('PtyManager — orphans', () => {
  usePtyMocks()

  it('cleanupOrphans sends SIGTERM to running orphan processes', async () => {
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    // Provide a registry with one orphan PID
    const orphanPid = 99999
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([{ sessionId: 'orphan', pid: orphanPid, cwd: '/', shell: '/bin/sh' }])
    )

    // Spy on process.kill — first call (signal 0) returns true (process running),
    // second call (SIGTERM) should succeed
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0) return true // isProcessRunning check
      return true // SIGTERM
    })

    const mgr = await makeManager()
    const result = mgr.cleanupOrphans()

    expect(result.cleanedCount).toBe(1)
    expect(killSpy).toHaveBeenCalledWith(orphanPid, 'SIGTERM')
    killSpy.mockRestore()
  })
})

describe('PtyManager — orphans that cannot be signalled', () => {
  usePtyMocks()

  it('cleanupOrphans handles SIGTERM failure gracefully', async () => {
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    const orphanPid = 88888
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([{ sessionId: 'zombie', pid: orphanPid, cwd: '/', shell: '/bin/sh' }])
    )

    // isProcessRunning returns true, SIGTERM throws
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0) return true
      throw new Error('EPERM')
    })

    const mgr = await makeManager()
    // The process went between the check and the signal: nothing was cleaned.
    expect(mgr.cleanupOrphans()).toEqual({ cleanedCount: 0 })
    killSpy.mockRestore()
  })
})

describe('PtyManager — orphans that are not running, and unknown sessions', () => {
  usePtyMocks()

  it('cleanupOrphans skips non-running PIDs', async () => {
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([{ sessionId: 'dead', pid: 77777, cwd: '/', shell: '/bin/sh' }])
    )

    // isProcessRunning signal 0 throws → process not running
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })

    const mgr = await makeManager()
    const result = mgr.cleanupOrphans()
    expect(result.cleanedCount).toBe(0)
    killSpy.mockRestore()
  })

  it('resize is a no-op for unknown sessionId', async () => {
    const mgr = await makeManager()
    expect(() => mgr.resize('no-such', 80, 24)).not.toThrow()
    expect(mockPty.resize).not.toHaveBeenCalled()
  })

  it('write is a no-op for unknown sessionId', async () => {
    const mgr = await makeManager()
    expect(() => mgr.write('no-such', 'data')).not.toThrow()
    expect(mockPty.write).not.toHaveBeenCalled()
  })
})

describe('PtyManager — pids and listing', () => {
  usePtyMocks()

  it('getPid returns the PID of a live session', async () => {
    const mgr = await makeManager()
    mgr.spawnSession({ sessionId: 's1', cwd: '/', shell: '/bin/sh', type: 'human', origin: 'app' })
    expect(mgr.getPid('s1')).toBe(12345)
  })

  it('getPid returns undefined for unknown sessionId', async () => {
    const mgr = await makeManager()
    expect(mgr.getPid('nope')).toBeUndefined()
  })
})

describe('PtyManager — listing', () => {
  usePtyMocks()

  it('listSessions returns all active sessions with cwd', async () => {
    const mgr = await makeManager()
    mgr.spawnSession({
      sessionId: 's1',
      cwd: '/home/user',
      shell: '/bin/sh',
      type: 'human',
      origin: 'app',
    })
    mgr.spawnSession({
      sessionId: 's2',
      cwd: '/tmp',
      shell: '/bin/sh',
      type: 'agent',
      origin: 'app',
    })
    const result = mgr.listSessions()
    expect(result).toHaveLength(2)
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: 's1', cwd: '/home/user' }),
        expect.objectContaining({ sessionId: 's2', cwd: '/tmp' }),
      ])
    )
  })
})

describe('PtyManager — listing nothing', () => {
  usePtyMocks()

  it('listSessions returns empty array when no sessions exist', async () => {
    const mgr = await makeManager()
    expect(mgr.listSessions()).toEqual([])
  })
})

let capturedDataCb: ((data: string) => void) | null
let capturedExitCb: ((args: { exitCode: number }) => void) | null

function useCapturedCallbacks(): void {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    capturedDataCb = null
    capturedExitCb = null
    mockPty.onData.mockImplementation((cb: (data: string) => void) => {
      capturedDataCb = cb
      return { dispose: vi.fn() }
    })
    mockPty.onExit.mockImplementation((cb: (args: { exitCode: number }) => void) => {
      capturedExitCb = cb
      return { dispose: vi.fn() }
    })
  })
}

describe('PtyManager session authority (spawnSession)', () => {
  useCapturedCallbacks()

  it('spawnSession records metadata and returns the session info', async () => {
    const mgr = await makeManager()
    const info = mgr.spawnSession({
      sessionId: 's-app',
      cwd: '/repo',
      shell: '/bin/zsh',
      type: 'human',
      origin: 'app',
      projectId: 'proj-1',
      tabTitle: 'Terminal 1',
    })
    expect(info).toMatchObject({
      sessionId: 's-app',
      cwd: '/repo',
      type: 'human',
      origin: 'app',
      projectId: 'proj-1',
      tabTitle: 'Terminal 1',
      pid: 12345,
    })
    expect(info.createdAt).toBeTruthy()
    expect(mgr.getSession('s-app')).toMatchObject({ sessionId: 's-app', origin: 'app' })
  })
})

describe('PtyManager session authority — fan-out', () => {
  useCapturedCallbacks()

  it('fans data out to every onData subscriber and disposes independently', async () => {
    const mgr = await makeManager()
    mgr.spawnSession({ sessionId: 's1', cwd: '/', shell: '/bin/sh', type: 'human', origin: 'app' })
    const a = vi.fn()
    const b = vi.fn()
    const disposeA = mgr.onData('s1', a)!
    mgr.onData('s1', b)
    capturedDataCb!('hello')
    expect(a).toHaveBeenCalledWith('hello')
    expect(b).toHaveBeenCalledWith('hello')
    disposeA()
    capturedDataCb!('again')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })
})

describe('PtyManager session authority — exit fan-out', () => {
  useCapturedCallbacks()

  it('fans exit out to every onExit subscriber and removes the session first', async () => {
    const mgr = await makeManager()
    mgr.spawnSession({
      sessionId: 's2',
      cwd: '/',
      shell: '/bin/sh',
      type: 'agent',
      origin: 'remote',
    })
    const seenDuringExit: boolean[] = []
    mgr.onExit('s2', () => seenDuringExit.push(mgr.getSession('s2') !== undefined))
    const exit2 = vi.fn()
    mgr.onExit('s2', exit2)
    capturedExitCb!({ exitCode: 3 })
    expect(exit2).toHaveBeenCalledWith(3)
    expect(seenDuringExit).toEqual([false])
    expect(mgr.getSession('s2')).toBeUndefined()
  })
})

describe('PtyManager session authority — unknown sessions and workspaces', () => {
  useCapturedCallbacks()

  it('onData and onExit return null for unknown sessions', async () => {
    const mgr = await makeManager()
    expect(mgr.onData('nope', vi.fn())).toBeNull()
    expect(mgr.onExit('nope', vi.fn())).toBeNull()
  })

  it('setWorkspace stamps and clears workspace metadata', async () => {
    const mgr = await makeManager()
    mgr.spawnSession({
      sessionId: 's3',
      cwd: '/',
      shell: '/bin/sh',
      type: 'human',
      origin: 'remote',
    })
    expect(mgr.setWorkspace('s3', 'ws-9')).toBe(true)
    expect(mgr.getSession('s3')?.workspaceId).toBe('ws-9')
    expect(mgr.setWorkspace('s3', null)).toBe(true)
    expect(mgr.getSession('s3')?.workspaceId).toBeUndefined()
    expect(mgr.setWorkspace('unknown', 'ws-9')).toBe(false)
  })
})

describe('PtyManager session authority — listing', () => {
  useCapturedCallbacks()

  it('listSessions exposes the full session info', async () => {
    const mgr = await makeManager()
    mgr.spawnSession({ sessionId: 'sa', cwd: '/a', shell: '/bin/sh', type: 'human', origin: 'app' })
    mgr.spawnSession({
      sessionId: 'sr',
      cwd: '/r',
      shell: '/bin/sh',
      type: 'agent',
      origin: 'remote',
    })
    const origins = mgr.listSessions().map((s) => [s.sessionId, s.origin])
    expect(origins).toEqual([
      ['sa', 'app'],
      ['sr', 'remote'],
    ])
  })
})

/** A manager whose PTY output and exit the test drives: `emit` writes output,
 * `exit` ends the process with `defaultExitCode` unless told otherwise. */
async function controlledManager(defaultExitCode: number) {
  const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
  let emit: (data: string) => void = () => {}
  let exit: (e: { exitCode: number }) => void = () => {}
  mockPty.onData.mockImplementation((cb: (data: string) => void) => {
    emit = cb
  })
  mockPty.onExit.mockImplementation((cb: (e: { exitCode: number }) => void) => {
    exit = cb
  })
  return {
    mgr: new PtyManager(),
    emit: (data: string) => emit(data),
    exit: (exitCode = defaultExitCode) => exit({ exitCode }),
  }
}

const spawn = (mgr: PtyManager, holdOutput: boolean) =>
  mgr.spawnSession({
    sessionId: 's1',
    cwd: '/repo',
    shell: '/bin/zsh',
    type: 'agent',
    origin: 'app',
    holdOutput,
  })

const spawnHeld = (mgr: PtyManager) =>
  mgr.spawnSession({
    sessionId: 'dead',
    cwd: '/repo',
    shell: '/bin/zsh',
    type: 'agent',
    origin: 'app',
    holdOutput: true,
  })

describe('holding output until something is on screen to show it', () => {
  // A terminal the application opened starts producing output while the tab
  // that will show it does not exist yet. Delivered live, everything in that
  // window is dropped — for a supervised agent that means the launch command
  // and its first output are simply missing from the terminal you open.
  it('delivers nothing while it is held', async () => {
    const { mgr, emit } = await controlledManager(0)
    spawn(mgr, true)
    const seen: string[] = []
    mgr.onData('s1', (data) => seen.push(data))
    emit('claude --session-id abc\r\n')
    expect(seen).toEqual([])
  })

  it('delivers everything held the moment something attaches', async () => {
    const { mgr, emit } = await controlledManager(0)
    spawn(mgr, true)
    const seen: string[] = []
    mgr.onData('s1', (data) => seen.push(data))
    emit('claude --session-id abc\r\n')
    emit('starting\r\n')
    expect(mgr.releaseOutput('s1')).toBe(true)
    expect(seen.join('')).toBe('claude --session-id abc\r\nstarting\r\n')
  })

  it('delivers live once released', async () => {
    const { mgr, emit } = await controlledManager(0)
    spawn(mgr, true)
    const seen: string[] = []
    mgr.onData('s1', (data) => seen.push(data))
    mgr.releaseOutput('s1')
    emit('later output')
    expect(seen).toEqual(['later output'])
  })
})

describe('holding output — terminals that never hold', () => {
  it('holds nothing for a terminal the operator opened themselves', async () => {
    const { mgr, emit } = await controlledManager(0)
    spawn(mgr, false)
    const seen: string[] = []
    mgr.onData('s1', (data) => seen.push(data))
    emit('immediate')
    expect(seen).toEqual(['immediate'])
  })

  it('reports that a session which was never holding had nothing to release', async () => {
    const { mgr } = await controlledManager(0)
    spawn(mgr, false)
    expect(mgr.releaseOutput('s1')).toBe(false)
  })

  it('reports nothing to release for a session it does not have', async () => {
    const { mgr } = await controlledManager(0)
    expect(mgr.releaseOutput('nobody')).toBe(false)
  })
})

describe('holding output — releasing once and bounding', () => {
  it('releases only once, so a second attach does not replay the whole session', async () => {
    const { mgr, emit } = await controlledManager(0)
    spawn(mgr, true)
    emit('once')
    mgr.releaseOutput('s1')
    expect(mgr.releaseOutput('s1')).toBe(false)
  })

  it('drops the oldest output rather than growing without limit', async () => {
    const { mgr, emit } = await controlledManager(0)
    spawn(mgr, true)
    const seen: string[] = []
    mgr.onData('s1', (data) => seen.push(data))
    emit('the-oldest-line')
    for (let i = 0; i < 12; i += 1) emit('x'.repeat(100_000))
    mgr.releaseOutput('s1')
    expect(seen.join('')).not.toContain('the-oldest-line')
    expect(seen.join('').length).toBeLessThanOrEqual(1_100_000)
  })
})

describe('a process that dies before anything is on screen', () => {
  // The case this hold exists for, and the one it used to miss: a bad flag, a
  // missing binary, the wrong cwd. The session was deleted on exit and its held
  // output went with it, leaving exactly the blank terminal the operator then
  // reports as "nothing ever shows up".

  it('still shows what it said to a tab that mounts afterwards', async () => {
    const { mgr, emit, exit } = await controlledManager(1)
    spawnHeld(mgr)
    emit('Error: Settings file not found\r\n')
    exit(1)

    const seen: string[] = []
    mgr.onData('dead', (data) => seen.push(data))
    expect(mgr.releaseOutput('dead')).toBe(true)
    expect(seen.join('')).toContain('Settings file not found')
  })

  it('delivers it immediately when something was already listening', async () => {
    const { mgr, emit, exit } = await controlledManager(1)
    spawnHeld(mgr)
    const seen: string[] = []
    mgr.onData('dead', (data) => seen.push(data))
    emit('Error: Settings file not found\r\n')
    exit(1)
    expect(seen.join('')).toContain('Settings file not found')
  })
})

describe('a process that dies — unknown and repeated attaches', () => {
  it('reports nothing for a session it never knew', async () => {
    const { mgr } = await controlledManager(1)
    expect(mgr.releaseOutput('never-existed')).toBe(false)
    expect(mgr.onData('never-existed', () => {})).toBeNull()
  })

  it('hands it over once, not to every later attach', async () => {
    const { mgr, emit, exit } = await controlledManager(1)
    spawnHeld(mgr)
    emit('gone\r\n')
    exit(1)
    mgr.onData('dead', () => {})
    expect(mgr.releaseOutput('dead')).toBe(true)
    expect(mgr.releaseOutput('dead')).toBe(false)
  })
})

/** The environment node-pty was actually handed. */
async function lastSpawnEnv(): Promise<Record<string, string | undefined>> {
  const pty = await import('node-pty')
  const calls = vi.mocked(pty.spawn).mock.calls
  return (calls[calls.length - 1][2] as { env: Record<string, string | undefined> }).env
}

describe('pty-manager — linked issue environment (FR-020 support)', () => {
  it('adds the issue variables on top of the inherited environment', async () => {
    const manager = await makeManager()
    manager.spawnSession({
      sessionId: 'env-1',
      cwd: '/tmp',
      shell: '/bin/sh',
      type: 'human',
      origin: 'app',
      env: { TERMINATOR_ISSUE_KEY: 'TAV-42', TERMINATOR_ISSUE_TRACKER: 'linear' },
    })

    const spawned = await lastSpawnEnv()
    expect(spawned.TERMINATOR_ISSUE_KEY).toBe('TAV-42')
    expect(spawned.TERMINATOR_ISSUE_TRACKER).toBe('linear')
    // The rest of the parent environment is still there.
    expect(spawned.PATH).toBe(process.env.PATH)
    manager.kill('env-1')
  })
})

describe('pty-manager — no linked issue', () => {
  it('adds nothing for a session with no linked issue', async () => {
    const manager = await makeManager()
    manager.spawnSession({
      sessionId: 'env-2',
      cwd: '/tmp',
      shell: '/bin/sh',
      type: 'human',
      origin: 'app',
    })

    const spawned = await lastSpawnEnv()
    expect(spawned.TERMINATOR_ISSUE_KEY).toBeUndefined()
    expect(spawned.PATH).toBe(process.env.PATH)
    manager.kill('env-2')
  })
})
