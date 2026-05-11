import { describe, it, expect } from 'vitest'
import { computeHash, getDisplayHash } from '../../src/state/artifact-hash.js'
import { writeFile, unlink, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

describe('computeHash()', () => {
  it('produces the correct SHA-256 for known content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'speckit-test-'))
    const filePath = join(dir, 'test.md')
    const content = 'Hello, SpecKit Pilot!'
    await writeFile(filePath, content)

    const expected = createHash('sha256').update(content).digest('hex')
    const result = await computeHash(filePath)

    expect(result).toBe(expected)
    await unlink(filePath)
  })

  it('returns null for a non-existent file', async () => {
    const result = await computeHash('/tmp/this-file-does-not-exist-speckit-12345.md')
    expect(result).toBeNull()
  })

  it('returns different hashes for different content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'speckit-test-'))
    const file1 = join(dir, 'a.md')
    const file2 = join(dir, 'b.md')
    await writeFile(file1, 'Content A')
    await writeFile(file2, 'Content B')

    const hash1 = await computeHash(file1)
    const hash2 = await computeHash(file2)

    expect(hash1).not.toBeNull()
    expect(hash2).not.toBeNull()
    expect(hash1).not.toBe(hash2)

    await unlink(file1)
    await unlink(file2)
  })

  it('returns same hash for same content in different files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'speckit-test-'))
    const file1 = join(dir, 'a.md')
    const file2 = join(dir, 'b.md')
    const content = 'Identical content'
    await writeFile(file1, content)
    await writeFile(file2, content)

    const hash1 = await computeHash(file1)
    const hash2 = await computeHash(file2)

    expect(hash1).toBe(hash2)
    await unlink(file1)
    await unlink(file2)
  })
})

describe('getDisplayHash()', () => {
  it('returns first 8 characters of a full SHA-256 hash', () => {
    const full = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
    expect(getDisplayHash(full)).toBe('a1b2c3d4')
  })

  it('result is exactly 8 characters', () => {
    const full = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'
    expect(getDisplayHash(full)).toHaveLength(8)
  })
})
