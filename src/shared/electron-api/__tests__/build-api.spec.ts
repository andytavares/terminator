import { describe, it, expect, vi } from 'vitest'
import { buildElectronApi, type ApiTransport } from '../build-api.js'

interface FakeTransport extends ApiTransport {
  invoke: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  push(channel: string, ...args: unknown[]): void
}

function makeTransport(): FakeTransport {
  const listeners = new Map<string, Set<(args: unknown[]) => void>>()
  return {
    invoke: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(),
    subscribe: vi.fn((channel: string, listener: (args: unknown[]) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set())
      listeners.get(channel)!.add(listener)
      return () => listeners.get(channel)!.delete(listener)
    }),
    push(channel: string, ...args: unknown[]) {
      listeners.get(channel)?.forEach((l) => l(args))
    },
  }
}

const NATIVE_LOCALS = {
  'keyboard.isReserved': (accelerator: string) => accelerator === 'CmdOrCtrl+T',
  getFilePath: () => '/tmp/file',
  'extensionBridge.invoke': vi.fn(),
  'extensionBridge.on': vi.fn(),
}

const REMOTE_LOCALS = {
  'keyboard.isReserved': () => false,
  'dialog.openDirectory': () => Promise.resolve({ cancelled: true }),
  'shell.openExternal': vi.fn(),
  'extension.updatePanelBounds': () => {},
  'extensionBridge.invoke': vi.fn(),
  'extensionBridge.on': vi.fn(),
}

// The built object is data-driven; type it loosely for property access in tests.
/* eslint-disable @typescript-eslint/no-explicit-any */

describe('buildElectronApi — native mode', () => {
  it('maps invoke methods with a payload mapper', async () => {
    const t = makeTransport()
    const api = buildElectronApi(t, { mode: 'native', locals: NATIVE_LOCALS }) as any
    await api.terminal.close('sess-1')
    expect(t.invoke).toHaveBeenCalledWith('terminal:close', { sessionId: 'sess-1' })
  })

  it('passes the first argument through when no mapper is declared', async () => {
    const t = makeTransport()
    const api = buildElectronApi(t, { mode: 'native', locals: NATIVE_LOCALS }) as any
    await api.terminal.create({ cwd: '/repo' })
    expect(t.invoke).toHaveBeenCalledWith('terminal:create', { cwd: '/repo' })
  })

  it('maps send methods', () => {
    const t = makeTransport()
    const api = buildElectronApi(t, { mode: 'native', locals: NATIVE_LOCALS }) as any
    api.terminal.input('sess-1', 'ls\n')
    expect(t.send).toHaveBeenCalledWith('terminal:input', { sessionId: 'sess-1', data: 'ls\n' })
  })

  it('subscribes event methods and maps pushed args to handler args', () => {
    const t = makeTransport()
    const api = buildElectronApi(t, { mode: 'native', locals: NATIVE_LOCALS }) as any
    const handler = vi.fn()
    const unsubscribe = api.terminal.onOutput(handler)
    t.push('terminal:output', { sessionId: 'sess-1', data: 'hello' })
    expect(handler).toHaveBeenCalledWith('sess-1', 'hello')
    unsubscribe()
    t.push('terminal:output', { sessionId: 'sess-1', data: 'again' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('maps zero-payload menu events to zero handler args', () => {
    const t = makeTransport()
    const api = buildElectronApi(t, { mode: 'native', locals: NATIVE_LOCALS }) as any
    const handler = vi.fn()
    api.extensionEvents.onMenuOpenSettings(handler)
    t.push('menu:open-settings')
    expect(handler).toHaveBeenCalledWith()
  })

  it('uses the supplied local implementations', () => {
    const t = makeTransport()
    const api = buildElectronApi(t, { mode: 'native', locals: NATIVE_LOCALS }) as any
    expect(api.keyboard.isReserved('CmdOrCtrl+T')).toBe(true)
    expect(api.keyboard.isReserved('CmdOrCtrl+Q')).toBe(false)
  })

  it('includes native-only methods', () => {
    const t = makeTransport()
    const api = buildElectronApi(t, { mode: 'native', locals: NATIVE_LOCALS }) as any
    expect(typeof api.workspace.getActive).toBe('function')
    expect(typeof api.db.health).toBe('function')
    expect(typeof api.getFilePath).toBe('function')
    expect(typeof api.extension.setBottomInset).toBe('function')
  })

  it('throws at build time when a local implementation is missing', () => {
    const t = makeTransport()
    expect(() => buildElectronApi(t, { mode: 'native', locals: {} })).toThrow(
      /missing local implementation/
    )
  })
})

describe('buildElectronApi — remote mode', () => {
  it('omits native-only methods and their empty namespaces', () => {
    const t = makeTransport()
    const api = buildElectronApi(t, { mode: 'remote', locals: REMOTE_LOCALS }) as any
    expect(api.workspace.getActive).toBeUndefined()
    expect(api.db).toBeUndefined()
    expect(api.getFilePath).toBeUndefined()
    expect(api.extension.setBottomInset).toBeUndefined()
    expect(api.project.onAdded).toBeUndefined()
  })

  it('replaces stub methods with the supplied local implementation', async () => {
    const t = makeTransport()
    const api = buildElectronApi(t, { mode: 'remote', locals: REMOTE_LOCALS }) as any
    await expect(api.dialog.openDirectory()).resolves.toEqual({ cancelled: true })
    api.extension.updatePanelBounds({})
    expect(t.invoke).not.toHaveBeenCalled()
  })

  it('routes non-stub methods through the transport unchanged', async () => {
    const t = makeTransport()
    const api = buildElectronApi(t, { mode: 'remote', locals: REMOTE_LOCALS }) as any
    await api.git.checkout('/repo', 'main')
    expect(t.invoke).toHaveBeenCalledWith('git:checkout', { path: '/repo', branch: 'main' })
  })

  it('builds the same event subscription surface as native for shared events', () => {
    const t = makeTransport()
    const api = buildElectronApi(t, { mode: 'remote', locals: REMOTE_LOCALS }) as any
    const handler = vi.fn()
    api.extensionEvents.onTogglePanel(handler)
    t.push('extension:toggle-panel', 'terminator.git-integration')
    expect(handler).toHaveBeenCalledWith('terminator.git-integration')
  })
})
