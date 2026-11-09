import { describe, it, expect, beforeEach, vi } from 'vitest'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
const termctlCommand = vi.hoisted(() => ({
  termctlStatus: vi.fn(),
  installTermctl: vi.fn(),
  uninstallTermctl: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))
vi.mock('../../../src/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('../../../src/integrations/termctl-command', () => termctlCommand)

import { registerTermctlHandlers } from '../../../src/ipc/termctl.ipc'

const options = { launcherPath: '/data/termctl/termctl', binDirectory: '/usr/local/bin' }
const installed = { state: 'installed', path: '/usr/local/bin/termctl' }
const call = (channel: string) => handlers.get(channel)!({}, undefined)

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  registerTermctlHandlers(Promise.resolve(options))
})

describe('termctl channels', () => {
  it('termctl:status answers the status for the launcher options', async () => {
    termctlCommand.termctlStatus.mockResolvedValue(installed)
    expect(await call('termctl:status')).toEqual({ data: installed })
    expect(termctlCommand.termctlStatus).toHaveBeenCalledWith(options)
  })

  it('termctl:install links the launcher', async () => {
    termctlCommand.installTermctl.mockResolvedValue(undefined)
    expect(await call('termctl:install')).toEqual({ data: true })
    expect(termctlCommand.installTermctl).toHaveBeenCalledWith(options)
  })

  it('termctl:uninstall removes the link', async () => {
    termctlCommand.uninstallTermctl.mockResolvedValue(undefined)
    expect(await call('termctl:uninstall')).toEqual({ data: true })
    expect(termctlCommand.uninstallTermctl).toHaveBeenCalledWith(options)
  })

  it('answers a failure envelope when the install throws', async () => {
    termctlCommand.installTermctl.mockRejectedValue(new Error('User canceled.'))
    expect(await call('termctl:install')).toEqual({ error: 'failed', message: 'User canceled.' })
  })
})
