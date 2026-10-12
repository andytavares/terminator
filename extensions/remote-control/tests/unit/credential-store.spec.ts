import { describe, it, expect } from 'vitest'
import { CredentialStore } from '../../src/server/credential-store'
import { hashPassword, verifyPassword } from '../../src/server/password-hash'

const KEYS = { legacyPassword: 'pw', passwordHash: 'hash' }
const BCRYPT = '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234'

function memorySettings(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial))
  return {
    values,
    get: <T>(key: string) => values.get(key) as T | undefined,
    set: (key: string, value: unknown) => void values.set(key, value),
  }
}

describe('credential store', () => {
  it('has no password until one is set', () => {
    expect(new CredentialStore(memorySettings(), KEYS).hasPassword()).toBe(false)
  })

  it('stores a verifiable hash and no stored value contains the password', async () => {
    const settings = memorySettings()
    const store = new CredentialStore(settings, KEYS)
    await store.setPassword('s3cret-passphrase')
    expect(store.hasPassword()).toBe(true)
    expect(await verifyPassword('s3cret-passphrase', store.getPasswordHash())).toBe(true)
    expect(JSON.stringify([...settings.values.values()])).not.toContain('s3cret-passphrase')
  })

  describe('migrating what earlier versions stored', () => {
    it('hashes a stored plaintext password, keeps it working, and erases the plaintext', async () => {
      const settings = memorySettings({ pw: 'old-plaintext', hash: BCRYPT })
      const store = new CredentialStore(settings, KEYS)
      expect(await store.migrateLegacy()).toBe('migrated')
      expect(await verifyPassword('old-plaintext', store.getPasswordHash())).toBe(true)
      expect(JSON.stringify([...settings.values.values()])).not.toContain('old-plaintext')
    })

    it('invalidates a bcrypt hash that has no plaintext beside it', async () => {
      const settings = memorySettings({ pw: '', hash: BCRYPT })
      const store = new CredentialStore(settings, KEYS)
      expect(await store.migrateLegacy()).toBe('invalidated')
      expect(store.hasPassword()).toBe(false)
      expect(store.getPasswordHash()).toBe('')
    })

    it('erases a plaintext left beside a current hash without changing the hash', async () => {
      const current = await hashPassword('new-password')
      const settings = memorySettings({ pw: 'leftover', hash: current })
      const store = new CredentialStore(settings, KEYS)
      expect(await store.migrateLegacy()).toBe('current')
      expect(store.getPasswordHash()).toBe(current)
      expect(settings.values.get('pw')).toBe('')
    })

    it('does nothing when no password was ever set', async () => {
      const store = new CredentialStore(memorySettings(), KEYS)
      expect(await store.migrateLegacy()).toBe('current')
      expect(store.hasPassword()).toBe(false)
    })
  })
})
