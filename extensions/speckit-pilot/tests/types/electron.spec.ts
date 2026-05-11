import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SpeckitAPI } from '../../src/types/electron.js'

const mockInvoke = vi.fn()
const mockOn = vi.fn()

function setupElectronBridge() {
  ;(globalThis as unknown as Record<string, unknown>).window = {
    electronAPI: {
      extensionBridge: {
        invoke: mockInvoke,
        on: mockOn,
      },
    },
  }
}

describe('getSpeckitAPI()', () => {
  let api: SpeckitAPI

  beforeEach(async () => {
    vi.clearAllMocks()
    setupElectronBridge()
    const mod = await import('../../src/types/electron.js')
    api = mod.getSpeckitAPI()
  })

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).window
  })

  it('calls bridge.invoke with speckit:feature-list', async () => {
    mockInvoke.mockResolvedValue({ features: [] })
    await api.featureList({ repoRoot: '/repo' })
    expect(mockInvoke).toHaveBeenCalledWith('speckit:feature-list', { repoRoot: '/repo' })
  })

  it('calls bridge.invoke with speckit:check-artifacts', async () => {
    mockInvoke.mockResolvedValue({ exists: {} })
    await api.checkArtifacts({ featureDir: '/repo/specs/001', repoRoot: '/repo' })
    expect(mockInvoke).toHaveBeenCalledWith('speckit:check-artifacts', {
      featureDir: '/repo/specs/001',
      repoRoot: '/repo',
    })
  })

  it('calls bridge.invoke with speckit:file-write', async () => {
    mockInvoke.mockResolvedValue({ ok: true })
    await api.fileWrite({ filePath: '/repo/spec.md', content: '# Spec' })
    expect(mockInvoke).toHaveBeenCalledWith('speckit:file-write', {
      filePath: '/repo/spec.md',
      content: '# Spec',
    })
  })

  it('calls bridge.invoke with speckit:pilot-state', async () => {
    mockInvoke.mockResolvedValue({ notFound: true })
    await api.pilotState({ featureDir: '/repo/specs/001' })
    expect(mockInvoke).toHaveBeenCalledWith('speckit:pilot-state', {
      featureDir: '/repo/specs/001',
    })
  })

  it('calls bridge.invoke with speckit:phase-approve', async () => {
    mockInvoke.mockResolvedValue({ state: {} })
    await api.phaseApprove({ featureDir: '/repo/specs/001', phase: 'specify', note: 'LGTM' })
    expect(mockInvoke).toHaveBeenCalledWith('speckit:phase-approve', {
      featureDir: '/repo/specs/001',
      phase: 'specify',
      note: 'LGTM',
    })
  })

  it('calls bridge.invoke with speckit:phase-revoke', async () => {
    mockInvoke.mockResolvedValue({ state: {} })
    await api.phaseRevoke({ featureDir: '/repo/specs/001', phase: 'plan' })
    expect(mockInvoke).toHaveBeenCalledWith('speckit:phase-revoke', {
      featureDir: '/repo/specs/001',
      phase: 'plan',
    })
  })

  it('calls bridge.on for onStateChanged and returns unsub', () => {
    const handler = vi.fn()
    const unsub = vi.fn()
    mockOn.mockReturnValue(unsub)
    const result = api.onStateChanged(handler)
    expect(mockOn).toHaveBeenCalledWith('speckit:state-changed', handler)
    expect(result).toBe(unsub)
  })
})
