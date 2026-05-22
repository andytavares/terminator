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
})
