import { describe, it, expect, vi, beforeEach } from 'vitest'

const app = {
  isPackaged: true,
  commandLine: { hasSwitch: () => false },
  getPath: () => '/profile',
  setPath: vi.fn(),
  requestSingleInstanceLock: vi.fn(),
  exit: vi.fn(),
}
vi.mock('electron', () => ({ app }))

describe('claim-profile', () => {
  beforeEach(() => {
    vi.resetModules()
    app.exit.mockReset()
  })

  it('exits when another process owns the profile', async () => {
    app.requestSingleInstanceLock.mockReturnValue(false)
    await import('../../../src/main/claim-profile')
    expect(app.exit).toHaveBeenCalledWith(0)
  })

  it('carries on when it owns the profile', async () => {
    app.requestSingleInstanceLock.mockReturnValue(true)
    await import('../../../src/main/claim-profile')
    expect(app.exit).not.toHaveBeenCalled()
  })
})
