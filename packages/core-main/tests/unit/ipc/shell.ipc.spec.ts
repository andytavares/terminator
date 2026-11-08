import { describe, it, expect, vi, beforeEach } from 'vitest'
import { homedir } from 'node:os'
import { ipcMain } from 'electron'

const { mockOpenPath, mockOpenExternal } = vi.hoisted(() => ({
  mockOpenPath: vi.fn(),
  mockOpenExternal: vi.fn(),
}))

// Opening a path or a URL hands it to the operating system; that is the boundary.
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    openPath: mockOpenPath,
    openExternal: mockOpenExternal,
  },
}))

import { registerShellHandlers } from '../../../src/ipc/shell.ipc'

function registeredHandler(
  channel: string
): (event: unknown, payload: unknown) => Promise<unknown> {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
  if (!call) throw new Error(`no handler registered for ${channel}`)
  return call[1] as (event: unknown, payload: unknown) => Promise<unknown>
}

describe('shell:open-external IPC handler', () => {
  let handler: (event: unknown, payload: unknown) => Promise<unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    mockOpenExternal.mockResolvedValue(undefined)

    registerShellHandlers()

    handler = registeredHandler('shell:open-external')
  })

  it('returns ok:true when openExternal succeeds', async () => {
    const result = await handler({}, { url: 'https://example.com' })
    expect(result).toEqual({ ok: true })
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('returns error string when openExternal throws', async () => {
    mockOpenExternal.mockRejectedValue(new Error('launch failed'))
    const result = (await handler({}, { url: 'https://example.com' })) as { error: string }
    expect(result.error).toContain('launch failed')
  })
})

describe('shell:open-path IPC handler', () => {
  let handler: (event: unknown, payload: unknown) => Promise<unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    mockOpenPath.mockResolvedValue('')

    registerShellHandlers()

    handler = registeredHandler('shell:open-path')
  })

  it('returns ok:true when openPath succeeds', async () => {
    const result = await handler({}, { filePath: '/some/file.txt' })
    expect(result).toEqual({ ok: true })
    expect(mockOpenPath).toHaveBeenCalledWith('/some/file.txt')
  })

  it('returns error when openPath returns a non-empty error message', async () => {
    mockOpenPath.mockResolvedValue('No application found')
    const result = (await handler({}, { filePath: '/some/file.txt' })) as { error: string }
    expect(result.error).toBe('No application found')
  })

  it.each([
    { filePath: '~/projects/foo', opened: `${homedir()}/projects/foo` },
    { filePath: '~', opened: homedir() },
    { filePath: '/some/~user/file', opened: '/some/~user/file' },
  ])('opens $filePath as $opened, expanding only a leading ~', async ({ filePath, opened }) => {
    await handler({}, { filePath })
    expect(mockOpenPath).toHaveBeenCalledWith(opened)
  })
})
