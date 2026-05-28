import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'node:path'
import * as os from 'node:os'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => path.join(os.tmpdir(), 'foundry-test-userdata')) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from('enc:' + s)),
    decryptString: vi.fn((b: Buffer) => b.toString().replace('enc:', '')),
  },
}))

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

import { execFile } from 'node:child_process'

// ─── macOS path (darwin) ──────────────────────────────────────────────────────

function mockOk(stdout = '') {
  vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: null, out: string, e: string) => void
    cb(null, stdout, '')
  })
}

function mockFail() {
  vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error) => void
    cb(Object.assign(new Error('exit 44'), { code: 44 }))
  })
}

beforeEach(() => vi.clearAllMocks())

describe('macOS path (darwin)', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  })

  it('isAvailable() returns true', async () => {
    const { isAvailable } = await import('../../../src/core/keychain.js')
    expect(isAvailable()).toBe(true)
  })

  it('storeKey() calls security add-generic-password', async () => {
    const { storeKey } = await import('../../../src/core/keychain.js')
    mockOk()
    await storeKey('foundry.provider.p1.apikey', 'sk-ant-secret')
    const [bin, args] = vi.mocked(execFile).mock.calls[0] as [string, string[]]
    expect(bin).toBe('security')
    expect(args).toContain('add-generic-password')
    expect(args).toContain('sk-ant-secret')
  })

  it('retrieveKey() returns trimmed key from security', async () => {
    const { retrieveKey } = await import('../../../src/core/keychain.js')
    mockOk('sk-secret\n')
    expect(await retrieveKey('some-key')).toBe('sk-secret')
  })

  it('retrieveKey() returns null when security fails', async () => {
    const { retrieveKey } = await import('../../../src/core/keychain.js')
    mockFail()
    expect(await retrieveKey('missing-key')).toBeNull()
  })

  it('deleteKey() calls security delete-generic-password', async () => {
    const { deleteKey } = await import('../../../src/core/keychain.js')
    mockOk()
    await deleteKey('foundry.provider.p1.apikey')
    const [, args] = vi.mocked(execFile).mock.calls[0] as [string, string[]]
    expect(args).toContain('delete-generic-password')
  })

  it('deleteKey() does not throw when key absent', async () => {
    const { deleteKey } = await import('../../../src/core/keychain.js')
    mockFail()
    await expect(deleteKey('ghost')).resolves.not.toThrow()
  })
})

describe('fallback path (non-darwin / safeStorage)', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    vi.resetModules()
  })

  it('isAvailable() defers to safeStorage.isEncryptionAvailable', async () => {
    const { safeStorage } = await import('electron')
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(false)
    const { isAvailable } = await import('../../../src/core/keychain.js')
    expect(isAvailable()).toBe(false)
  })

  it('storeKey/retrieveKey round-trips via safeStorage', async () => {
    const { storeKey, retrieveKey } = await import('../../../src/core/keychain.js')
    await storeKey('test-key', 'my-secret')
    const result = await retrieveKey('test-key')
    expect(result).toBe('my-secret')
  })

  it('retrieveKey returns null for unknown key', async () => {
    const { retrieveKey } = await import('../../../src/core/keychain.js')
    expect(await retrieveKey('does-not-exist-xyz-' + Date.now())).toBeNull()
  })

  it('deleteKey removes key so retrieveKey returns null', async () => {
    const { storeKey, retrieveKey, deleteKey } = await import('../../../src/core/keychain.js')
    await storeKey('del-me', 'value')
    await deleteKey('del-me')
    expect(await retrieveKey('del-me')).toBeNull()
  })

  it('deleteKey on non-existent key does not throw', async () => {
    const { deleteKey } = await import('../../../src/core/keychain.js')
    await expect(deleteKey('ghost-' + Date.now())).resolves.not.toThrow()
  })
})
