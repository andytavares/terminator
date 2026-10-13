// @vitest-environment jsdom
// The preload runs in a renderer context: it needs a real `window` to attach
// the double-Escape exit listener to.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcRendererEvent } from 'electron'
import { ELECTRON_API_MANIFEST } from '../../../src/shared/electron-api/manifest.js'
import { partialFake } from '../../support/fakes'
import { methodPathsOf } from '../../support/electron-api'

const exposed: Record<string, unknown> = {}
const mockSend = vi.fn()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      exposed[key] = value
    },
  },
  ipcRenderer: {
    invoke: vi.fn(),
    send: mockSend,
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}))

function usePreloadWebview(): void {
  beforeEach(async () => {
    Object.keys(exposed).forEach((k) => delete exposed[k])
    mockSend.mockClear()
    vi.resetModules()
    await import('../../../src/main/preload-webview.js')
  })
}

describe('preload-webview', () => {
  usePreloadWebview()

  it('exposes electronAPI via contextBridge', () => {
    expect(exposed).toHaveProperty('electronAPI')
  })

  it('exposes all required top-level namespaces', () => {
    const api = exposed['electronAPI'] as Record<string, unknown>
    const required = [
      'terminal',
      'workspace',
      'project',
      'git',
      'settings',
      'dialog',
      'extension',
      'shell',
      'fs',
      'extensionEvents',
      'app',
      'extensionBridge',
      'notifications',
      'db',
      'metrics',
      'logger',
    ]
    for (const ns of required) {
      expect(api, `namespace '${ns}' is missing`).toHaveProperty(ns)
    }
  })
})

describe('preload-webview — the declared surface', () => {
  usePreloadWebview()

  it('exposes exactly the methods the manifest declares for extension views', () => {
    const declared = ELECTRON_API_MANIFEST.filter((spec) => spec.extensionView !== undefined).map(
      (spec) => spec.path
    )
    const exposedPaths = methodPathsOf(exposed['electronAPI'] as Record<string, unknown>)
    expect(exposedPaths.sort()).toEqual(declared.sort())
  })
})

describe('preload-webview — what each method sends', () => {
  usePreloadWebview()

  // This preload is still written by hand (see the bundling note in
  // src/main/preload.ts), so each method must put on the wire what its spec says.
  it.each(
    ELECTRON_API_MANIFEST.filter(
      (spec) => spec.extensionView !== undefined && (spec.kind === 'invoke' || spec.kind === 'send')
    ).map((spec) => [spec.path, spec] as const)
  )('%s sends what the manifest declares', async (path, spec) => {
    const { ipcRenderer } = await import('electron')
    const [namespace, name] = path.split('.')
    const api = exposed['electronAPI'] as Record<string, Record<string, (...a: unknown[]) => void>>
    const callMethod = api[namespace][name]
    const args = ['first', 'second', 'third'].slice(0, callMethod.length)
    const wire = spec.kind === 'invoke' ? ipcRenderer.invoke : ipcRenderer.send
    vi.mocked(wire).mockClear()

    callMethod(...args)

    const toPayload = spec.toPayload as ((...a: unknown[]) => unknown) | undefined
    const payload = toPayload ? toPayload(...args) : args[0]
    const sent = vi.mocked(wire).mock.calls[0] as unknown[]
    expect([sent[0], sent[1]]).toEqual([spec.channel, payload])
  })
})

describe('preload-webview — what each event hands its handler', () => {
  usePreloadWebview()

  it.each(
    ELECTRON_API_MANIFEST.filter(
      (spec) => spec.extensionView !== undefined && spec.kind === 'event'
    ).map((spec) => [spec.path, spec] as const)
  )('%s hands its handler what the manifest declares', async (path, spec) => {
    const { ipcRenderer } = await import('electron')
    const [namespace, name] = path.split('.')
    const api = exposed['electronAPI'] as Record<string, Record<string, (h: unknown) => void>>
    vi.mocked(ipcRenderer.on).mockClear()
    const handler = vi.fn()

    api[namespace][name](handler)

    const pushed = { sessionId: 's1', data: 'd', exitCode: 0, id: 'x' }
    const [channel, listener] = vi.mocked(ipcRenderer.on).mock.calls[0]
    listener(partialFake<IpcRendererEvent>({}), pushed)
    expect(channel).toBe(spec.channel)
    expect(handler).toHaveBeenCalledWith(
      ...(spec.toHandlerArgs ? spec.toHandlerArgs([pushed]) : [pushed])
    )
  })
})

describe('preload-webview — commands', () => {
  usePreloadWebview()

  it('runCommand and hasCommand invoke the extension channels with key and args', async () => {
    const { ipcRenderer } = await import('electron')
    const api = exposed['electronAPI'] as Record<
      string,
      Record<string, (...a: unknown[]) => unknown>
    >
    api['extension']['runCommand']('ext.command.open', { n: 1 })
    api['extension']['hasCommand']('ext.command.open')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('extension:run-command', {
      key: 'ext.command.open',
      args: { n: 1 },
    })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('extension:has-command', {
      key: 'ext.command.open',
    })
  })
})

describe('preload-webview — double-Escape exit gesture', () => {
  usePreloadWebview()

  function pressEscape(times: number): void {
    for (let i = 0; i < times; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    }
  }

  it('stays silent on a single Escape so the extension keeps its own', () => {
    pressEscape(1)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('requests an exit on a second Escape', () => {
    pressEscape(2)
    expect(mockSend).toHaveBeenCalledWith('extension:request-exit')
  })

  it('does not let the extension cancel the gesture with preventDefault', () => {
    // The first press is genuinely the extension's; the exit is about what the
    // user does next, so a handled first Escape must not disarm the second.
    window.addEventListener('keydown', (e) => e.preventDefault())
    pressEscape(2)
    expect(mockSend).toHaveBeenCalledWith('extension:request-exit')
  })

  it('ignores other keys', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(mockSend).not.toHaveBeenCalled()
  })
})
