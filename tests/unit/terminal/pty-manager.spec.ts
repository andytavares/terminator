import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPty = {
  pid: 12345,
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
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

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '[]'),
  writeFileSync: vi.fn(),
}))

describe('PtyManager', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockPty.onData.mockImplementation((_cb: unknown) => {})
    mockPty.onExit.mockImplementation((_cb: unknown) => {})
  })

  it('spawn creates a PTY and returns sessionId', async () => {
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    const sessionId = 'test-session-1'
    const result = mgr.spawn(sessionId, '/home', '/bin/bash', 'human', vi.fn(), vi.fn())
    expect(result).toBe(sessionId)
    expect(mgr.getSessionIds()).toContain(sessionId)
  })

  it('resize calls pty.resize', async () => {
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    const id = 'resize-session'
    mgr.spawn(id, '/', '/bin/bash', 'human', vi.fn(), vi.fn())
    mgr.resize(id, 120, 40)
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40)
  })

  it('write sends data to PTY', async () => {
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    const id = 'write-session'
    mgr.spawn(id, '/', '/bin/bash', 'human', vi.fn(), vi.fn())
    mgr.write(id, 'ls\n')
    expect(mockPty.write).toHaveBeenCalledWith('ls\n')
  })

  it('kill terminates process', async () => {
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    const id = 'kill-session'
    mgr.spawn(id, '/', '/bin/bash', 'human', vi.fn(), vi.fn())
    mgr.kill(id)
    expect(mockPty.kill).toHaveBeenCalled()
    expect(mgr.getSessionIds()).not.toContain(id)
  })

  it('killAll terminates all tracked PTY processes', async () => {
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    mgr.spawn('s1', '/', '/bin/bash', 'human', vi.fn(), vi.fn())
    mgr.spawn('s2', '/', '/bin/bash', 'agent', vi.fn(), vi.fn())
    await mgr.killAll()
    expect(mgr.getSessionIds()).toHaveLength(0)
  })

  it('kill is a no-op for unknown sessionId', async () => {
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    // Should not throw
    expect(() => mgr.kill('nonexistent-session')).not.toThrow()
    expect(mockPty.kill).not.toHaveBeenCalled()
  })

  it('kill swallows errors thrown by pty.kill()', async () => {
    mockPty.kill.mockImplementationOnce(() => {
      throw new Error('already dead')
    })
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    const id = 'kill-err'
    mgr.spawn(id, '/', '/bin/bash', 'human', vi.fn(), vi.fn())
    expect(() => mgr.kill(id)).not.toThrow()
    expect(mgr.getSessionIds()).not.toContain(id)
  })

  it('onExit callback removes session and calls user onExit', async () => {
    let capturedOnExit: ((args: { exitCode: number }) => void) | undefined
    mockPty.onExit.mockImplementation((cb: (args: { exitCode: number }) => void) => {
      capturedOnExit = cb
    })

    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    const onExit = vi.fn()
    const id = 'exit-session'
    mgr.spawn(id, '/', '/bin/bash', 'human', vi.fn(), onExit)

    expect(mgr.getSessionIds()).toContain(id)
    capturedOnExit?.({ exitCode: 0 })
    expect(onExit).toHaveBeenCalledWith(0)
    expect(mgr.getSessionIds()).not.toContain(id)
  })

  it('cleanupOrphans returns 0 when registry file does not exist', async () => {
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    const result = mgr.cleanupOrphans()
    expect(result).toEqual({ cleanedCount: 0 })
  })

  it('cleanupOrphans returns 0 when registry JSON is malformed', async () => {
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('NOT_JSON' as unknown as Buffer)

    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    const result = mgr.cleanupOrphans()
    expect(result).toEqual({ cleanedCount: 0 })
  })

  it('cleanupOrphans sends SIGTERM to running orphan processes', async () => {
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    // Provide a registry with one orphan PID
    const orphanPid = 99999
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([
        { sessionId: 'orphan', pid: orphanPid, cwd: '/', shell: '/bin/sh' },
      ]) as unknown as Buffer
    )

    // Spy on process.kill — first call (signal 0) returns true (process running),
    // second call (SIGTERM) should succeed
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0) return true // isProcessRunning check
      return true // SIGTERM
    })

    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    const result = mgr.cleanupOrphans()

    expect(result.cleanedCount).toBe(1)
    expect(killSpy).toHaveBeenCalledWith(orphanPid, 'SIGTERM')
    killSpy.mockRestore()
  })

  it('cleanupOrphans handles SIGTERM failure gracefully', async () => {
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    const orphanPid = 88888
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([
        { sessionId: 'zombie', pid: orphanPid, cwd: '/', shell: '/bin/sh' },
      ]) as unknown as Buffer
    )

    // isProcessRunning returns true, SIGTERM throws
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0) return true
      throw new Error('EPERM')
    })

    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    // Should not throw
    expect(() => mgr.cleanupOrphans()).not.toThrow()
    killSpy.mockRestore()
  })

  it('cleanupOrphans skips non-running PIDs', async () => {
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([
        { sessionId: 'dead', pid: 77777, cwd: '/', shell: '/bin/sh' },
      ]) as unknown as Buffer
    )

    // isProcessRunning signal 0 throws → process not running
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })

    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    const result = mgr.cleanupOrphans()
    expect(result.cleanedCount).toBe(0)
    killSpy.mockRestore()
  })

  it('resize is a no-op for unknown sessionId', async () => {
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    expect(() => mgr.resize('no-such', 80, 24)).not.toThrow()
    expect(mockPty.resize).not.toHaveBeenCalled()
  })

  it('write is a no-op for unknown sessionId', async () => {
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    expect(() => mgr.write('no-such', 'data')).not.toThrow()
    expect(mockPty.write).not.toHaveBeenCalled()
  })

  it('getPid returns the PID of a live session', async () => {
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    mgr.spawn('s1', '/', '/bin/sh', 'human', vi.fn(), vi.fn())
    expect(mgr.getPid('s1')).toBe(12345)
  })

  it('getPid returns undefined for unknown sessionId', async () => {
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    expect(mgr.getPid('nope')).toBeUndefined()
  })

  it('listSessions returns all active sessions with cwd', async () => {
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    mgr.spawn('s1', '/home/user', '/bin/sh', 'human', vi.fn(), vi.fn())
    mgr.spawn('s2', '/tmp', '/bin/sh', 'agent', vi.fn(), vi.fn())
    const result = mgr.listSessions()
    expect(result).toHaveLength(2)
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: 's1', cwd: '/home/user' }),
        expect.objectContaining({ sessionId: 's2', cwd: '/tmp' }),
      ])
    )
  })

  it('listSessions returns empty array when no sessions exist', async () => {
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    expect(mgr.listSessions()).toEqual([])
  })

  it('attachOnData returns a dispose function that detaches the listener', async () => {
    const onDataCb = vi.fn()
    let capturedDataCb: ((data: string) => void) | null = null
    mockPty.onData.mockImplementation((cb: (data: string) => void) => {
      capturedDataCb = cb
      return { dispose: vi.fn() }
    })

    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    mgr.spawn('s1', '/tmp', '/bin/sh', 'human', vi.fn(), vi.fn())

    const dispose = mgr.attachOnData('s1', onDataCb)
    expect(dispose).toBeTypeOf('function')
    expect(capturedDataCb).not.toBeNull()
  })

  it('attachOnData returns null for unknown sessionId', async () => {
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    const mgr = new PtyManager()
    const result = mgr.attachOnData('no-such', vi.fn())
    expect(result).toBeNull()
  })
})

describe('PtyManager session authority (spawnSession)', () => {
  let capturedDataCb: ((data: string) => void) | null
  let capturedExitCb: ((args: { exitCode: number }) => void) | null

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

  async function makeManager() {
    const { PtyManager } = await import('../../../src/main/terminal/pty-manager')
    return new PtyManager()
  }

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

  it('legacy spawn() delegates to spawnSession with app origin and wires callbacks', async () => {
    const mgr = await makeManager()
    const onData = vi.fn()
    const onExit = vi.fn()
    mgr.spawn('legacy', '/l', '/bin/sh', 'human', onData, onExit)
    expect(mgr.getSession('legacy')?.origin).toBe('app')
    capturedDataCb!('out')
    expect(onData).toHaveBeenCalledWith('out')
    capturedExitCb!({ exitCode: 0 })
    expect(onExit).toHaveBeenCalledWith(0)
  })
})

describe('holding output until something is on screen to show it', () => {
  // A terminal the application opened starts producing output while the tab
  // that will show it does not exist yet. Delivered live, everything in that
  // window is dropped — for a supervised agent that means the launch command
  // and its first output are simply missing from the terminal you open.
  async function manager() {
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
      exit: (exitCode = 0) => exit({ exitCode }),
    }
  }

  const spawn = (mgr: { spawnSession: (o: unknown) => unknown }, holdOutput: boolean) =>
    mgr.spawnSession({
      sessionId: 's1',
      cwd: '/repo',
      shell: '/bin/zsh',
      type: 'agent',
      origin: 'app',
      holdOutput,
    })

  it('delivers nothing while it is held', async () => {
    const { mgr, emit } = await manager()
    spawn(mgr, true)
    const seen: string[] = []
    mgr.onData('s1', (data) => seen.push(data))
    emit('claude --session-id abc\r\n')
    expect(seen).toEqual([])
  })

  it('delivers everything held the moment something attaches', async () => {
    const { mgr, emit } = await manager()
    spawn(mgr, true)
    const seen: string[] = []
    mgr.onData('s1', (data) => seen.push(data))
    emit('claude --session-id abc\r\n')
    emit('starting\r\n')
    expect(mgr.releaseOutput('s1')).toBe(true)
    expect(seen.join('')).toBe('claude --session-id abc\r\nstarting\r\n')
  })

  it('delivers live once released', async () => {
    const { mgr, emit } = await manager()
    spawn(mgr, true)
    const seen: string[] = []
    mgr.onData('s1', (data) => seen.push(data))
    mgr.releaseOutput('s1')
    emit('later output')
    expect(seen).toEqual(['later output'])
  })

  it('holds nothing for a terminal the operator opened themselves', async () => {
    const { mgr, emit } = await manager()
    spawn(mgr, false)
    const seen: string[] = []
    mgr.onData('s1', (data) => seen.push(data))
    emit('immediate')
    expect(seen).toEqual(['immediate'])
  })

  it('reports that a session which was never holding had nothing to release', async () => {
    const { mgr } = await manager()
    spawn(mgr, false)
    expect(mgr.releaseOutput('s1')).toBe(false)
  })

  it('reports nothing to release for a session it does not have', async () => {
    const { mgr } = await manager()
    expect(mgr.releaseOutput('nobody')).toBe(false)
  })

  it('releases only once, so a second attach does not replay the whole session', async () => {
    const { mgr, emit } = await manager()
    spawn(mgr, true)
    emit('once')
    mgr.releaseOutput('s1')
    expect(mgr.releaseOutput('s1')).toBe(false)
  })

  it('drops the oldest output rather than growing without limit', async () => {
    const { mgr, emit } = await manager()
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

  async function manager() {
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
      exit: (exitCode = 1) => exit({ exitCode }),
    }
  }

  const spawnHeld = (mgr: { spawnSession: (o: unknown) => unknown }) =>
    mgr.spawnSession({
      sessionId: 'dead',
      cwd: '/repo',
      shell: '/bin/zsh',
      type: 'agent',
      origin: 'app',
      holdOutput: true,
    })

  it('still shows what it said to a tab that mounts afterwards', async () => {
    const { mgr, emit, exit } = await manager()
    spawnHeld(mgr)
    emit('Error: Settings file not found\r\n')
    exit(1)

    const seen: string[] = []
    mgr.onData('dead', (data) => seen.push(data))
    expect(mgr.releaseOutput('dead')).toBe(true)
    expect(seen.join('')).toContain('Settings file not found')
  })

  it('delivers it immediately when something was already listening', async () => {
    const { mgr, emit, exit } = await manager()
    spawnHeld(mgr)
    const seen: string[] = []
    mgr.onData('dead', (data) => seen.push(data))
    emit('Error: Settings file not found\r\n')
    exit(1)
    expect(seen.join('')).toContain('Settings file not found')
  })

  it('reports nothing for a session it never knew', async () => {
    const { mgr } = await manager()
    expect(mgr.releaseOutput('never-existed')).toBe(false)
    expect(mgr.onData('never-existed', () => {})).toBeNull()
  })

  it('hands it over once, not to every later attach', async () => {
    const { mgr, emit, exit } = await manager()
    spawnHeld(mgr)
    emit('gone\r\n')
    exit(1)
    mgr.onData('dead', () => {})
    expect(mgr.releaseOutput('dead')).toBe(true)
    expect(mgr.releaseOutput('dead')).toBe(false)
  })
})
