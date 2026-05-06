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
})
