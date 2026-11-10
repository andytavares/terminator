import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { appTools } from '../../../src/mcp/app-tools'
import type { QuietUpdateCheck } from '../../../src/app-updater'

const caller = { sessionId: 's1', claudePid: 1, projectDir: '/repo', terminalId: null }

let deps: {
  checkForUpdate: ReturnType<typeof vi.fn<() => Promise<QuietUpdateCheck>>>
  downloadedUpdate: ReturnType<typeof vi.fn<() => string | null>>
  quitAndInstall: ReturnType<typeof vi.fn<() => void>>
  showWindow: ReturnType<typeof vi.fn<() => void>>
}

beforeEach(() => {
  deps = {
    checkForUpdate: vi.fn<() => Promise<QuietUpdateCheck>>(),
    downloadedUpdate: vi.fn<() => string | null>(() => null),
    quitAndInstall: vi.fn<() => void>(),
    showWindow: vi.fn<() => void>(),
  }
})

afterEach(() => {
  vi.useRealTimers()
})

const tool = (name: string) =>
  appTools(deps)
    .tools()
    .find((each) => each.name === name)!

describe('appTools — tools/list', () => {
  it('lists the three tools with empty object schemas, install_update destructive', () => {
    const tools = appTools(deps).tools()
    expect(tools.map((each) => each.name)).toEqual([
      'check_for_update',
      'install_update',
      'show_window',
    ])
    for (const each of tools) expect(each.inputSchema).toEqual({ type: 'object', properties: {} })
    expect(tool('install_update')._meta).toEqual({ 'anthropic/requiresUserInteraction': true })
    expect(tool('check_for_update').annotations).toEqual({ destructiveHint: false })
  })
})

describe('check_for_update', () => {
  it.each<QuietUpdateCheck>([
    { status: 'up-to-date', version: '0.1.163' },
    { status: 'downloaded', version: '0.1.170' },
    { status: 'off', reason: 'Only an installed Terminator checks for updates.' },
  ])('answers $status as the updater reports it', async (check) => {
    deps.checkForUpdate.mockResolvedValue(check)
    expect(await tool('check_for_update').call({}, caller)).toEqual(check)
  })
})

describe('install_update', () => {
  it('refuses in plain words when no update is downloaded', async () => {
    await expect(tool('install_update').call({}, caller)).rejects.toThrow(
      'No update is downloaded. Run check_for_update first.'
    )
    expect(deps.quitAndInstall).not.toHaveBeenCalled()
  })

  it('answers with the version first, and quits into it a second later', async () => {
    vi.useFakeTimers()
    deps.downloadedUpdate.mockReturnValue('0.1.170')
    expect(await tool('install_update').call({}, caller)).toEqual({ restarting: '0.1.170' })
    expect(deps.quitAndInstall).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(deps.quitAndInstall).toHaveBeenCalledOnce()
  })
})

describe('show_window', () => {
  it('shows the main window', async () => {
    expect(await tool('show_window').call({}, caller)).toEqual({ shown: true })
    expect(deps.showWindow).toHaveBeenCalledOnce()
  })
})
