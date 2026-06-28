import { describe, it, expect, vi, beforeAll } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  safeStorage: {
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
  app: { getPath: vi.fn().mockReturnValue('/tmp') },
}))
vi.mock('../../src/api/credentials.js', () => ({
  setLinearKey: vi.fn(),
  getLinearKey: vi.fn(),
  setJiraCredentials: vi.fn(),
  getJiraCredentials: vi.fn(),
}))
vi.mock('../../src/api/linear.js', () => ({ fetchAssignedTickets: vi.fn(), postComment: vi.fn() }))
vi.mock('../../src/api/jira.js', () => ({
  fetchAssignedTickets: vi.fn(),
  postComment: vi.fn(),
  transitionStatus: vi.fn(),
}))
vi.mock('../../src/runner/agent-runner.js', () => ({
  createAgentRunner: vi
    .fn()
    .mockReturnValue({ startPhaseRunner: vi.fn().mockReturnValue({ stop: vi.fn() }) }),
}))
vi.mock('../../src/state/state-persistence.js', () => ({
  createInitialState: vi.fn(),
  writeState: vi.fn(),
  readState: vi.fn(),
  appendHistory: vi.fn(),
  ensurePilotDir: vi.fn(),
}))

const handlers = new Map<string, (p: unknown) => unknown>()

const api = {
  ipc: {
    registerHandler: vi.fn((ch: string, h: (p: unknown) => unknown) => {
      console.log('Registering:', ch)
      handlers.set(ch, h)
      return { dispose: vi.fn() }
    }),
    invokeChannel: vi.fn(),
    sendChannel: vi.fn(),
    onWindowEvent: vi.fn().mockReturnValue(() => {}),
    isRemoteAccessible: vi.fn(),
  },
  pty: {
    spawn: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    listSessions: vi.fn().mockReturnValue([]),
    attachOnData: vi.fn(),
    attachOnExit: vi.fn(),
  },
  window: { broadcast: vi.fn(), openAuxiliary: vi.fn(), focusSelf: vi.fn() },
  shell: {
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
  },
  notifications: {
    showToast: vi.fn(),
    createNotification: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  },
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  settings: { register: vi.fn().mockReturnValue({ dispose: vi.fn() }), get: vi.fn(), set: vi.fn() },
  terminal: {
    onSessionCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onSessionClose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  },
  app: { version: '0.0.0-test' },
}

beforeAll(async () => {
  try {
    const { activate } = await import('../../src/index.js')
    console.log('activate imported OK, type:', typeof activate)
    activate(api as never)
    console.log('handlers registered:', Array.from(handlers.keys()).join(', '))
  } catch (e) {
    console.error('FAILED:', e)
  }
})

describe('diag', () => {
  it('registers ticket-list', () => {
    console.log('All handlers:', Array.from(handlers.keys()))
    expect(handlers.get('speckit:ticket-list')).toBeDefined()
  })
})
