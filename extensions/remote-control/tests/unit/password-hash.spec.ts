import { describe, it, expect } from 'vitest'
import { hashPassword, isPasswordHash, verifyPassword } from '../../src/server/password-hash'

const BCRYPT = '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234'

describe('password-hash', () => {
  it('accepts the password it hashed', async () => {
    const stored = await hashPassword('correct horse')
    expect(await verifyPassword('correct horse', stored)).toBe(true)
  })

  it('rejects any other password, including a prefix and the empty string', async () => {
    const stored = await hashPassword('correct horse')
    expect(await verifyPassword('wrong horse', stored)).toBe(false)
    expect(await verifyPassword('correct hors', stored)).toBe(false)
    expect(await verifyPassword('', stored)).toBe(false)
  })

  it('does not contain the password and differs on every call (random salt)', async () => {
    const first = await hashPassword('correct horse')
    const second = await hashPassword('correct horse')
    expect(first).not.toContain('correct horse')
    expect(first).not.toEqual(second)
    expect(await verifyPassword('correct horse', second)).toBe(true)
  })

  it('rejects a stored value that is not a scrypt hash instead of throwing', async () => {
    expect(await verifyPassword('anything', BCRYPT)).toBe(false)
    expect(await verifyPassword('anything', '')).toBe(false)
    expect(await verifyPassword('anything', 'scrypt$not$numbers$x$y$z')).toBe(false)
    expect(await verifyPassword('anything', 'scrypt$3$8$1$c2FsdA$aGFzaA')).toBe(false)
  })

  it('tells a scrypt hash from a plaintext or bcrypt value', async () => {
    expect(isPasswordHash(await hashPassword('x'))).toBe(true)
    expect(isPasswordHash('plain-text-password')).toBe(false)
    expect(isPasswordHash(BCRYPT)).toBe(false)
    expect(isPasswordHash('')).toBe(false)
  })
})
