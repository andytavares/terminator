import { describe, it, expect } from 'vitest'
import { computeHash, hashArtifacts } from '../../src/state/artifact-hash.js'
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

describe('hashArtifacts()', () => {
  /** Names an artifact by its file name, which is what the caller does with a
      repository-relative path. */
  const entries = (paths: string[]) =>
    paths.map((path) => ({ name: path.slice(path.lastIndexOf('/') + 1), path }))

  // A phase can produce more than one artifact — `plan` produces three — and
  // `approvedHash` is one field. Comparing every file against one file's hash,
  // which is what the unused version did, reports a change on the second
  // artifact of every multi-artifact phase.

  async function dir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'speckit-hash-'))
  }

  it('covers every artifact, not just the first', async () => {
    const d = await dir()
    const a = join(d, 'plan.md')
    const b = join(d, 'research.md')
    await writeFile(a, 'plan')
    await writeFile(b, 'research')

    const before = await hashArtifacts(entries([a, b]))
    await writeFile(b, 'research, revised')
    expect(await hashArtifacts(entries([a, b]))).not.toBe(before)
  })

  it('does not depend on the order the paths were listed in', async () => {
    const d = await dir()
    const a = join(d, 'a.md')
    const b = join(d, 'b.md')
    await writeFile(a, 'one')
    await writeFile(b, 'two')
    expect(await hashArtifacts(entries([a, b]))).toBe(await hashArtifacts(entries([b, a])))
  })

  it('changes when an artifact is renamed, since the path is part of it', async () => {
    const d = await dir()
    const a = join(d, 'spec.md')
    const b = join(d, 'spec-old.md')
    await writeFile(a, 'same content')
    await writeFile(b, 'same content')
    expect(await hashArtifacts(entries([a]))).not.toBe(await hashArtifacts(entries([b])))
  })

  it('changes when an artifact is deleted — an approval does not survive that', async () => {
    const d = await dir()
    const a = join(d, 'spec.md')
    await writeFile(a, 'content')
    const before = await hashArtifacts(entries([a]))
    await unlink(a)
    expect(await hashArtifacts(entries([a]))).not.toBe(before)
  })

  it('is stable when nothing changed', async () => {
    const d = await dir()
    const a = join(d, 'spec.md')
    await writeFile(a, 'content')
    expect(await hashArtifacts(entries([a]))).toBe(await hashArtifacts(entries([a])))
  })

  it('is the same read from another checkout, which is where it is read from', async () => {
    // A card acquires a worktree the moment its next phase starts. Hashing the
    // absolute path made every approval taken before that look modified after.
    const main = await dir()
    const worktree = await dir()
    await writeFile(join(main, 'spec.md'), 'the thing, as approved')
    await writeFile(join(worktree, 'spec.md'), 'the thing, as approved')

    expect(
      await hashArtifacts([{ name: 'specs/021-a/spec.md', path: join(main, 'spec.md') }])
    ).toBe(await hashArtifacts([{ name: 'specs/021-a/spec.md', path: join(worktree, 'spec.md') }]))
  })

  it('still differs when that other checkout has different content', async () => {
    const main = await dir()
    const worktree = await dir()
    await writeFile(join(main, 'spec.md'), 'the thing, as approved')
    await writeFile(join(worktree, 'spec.md'), 'and one more thing nobody approved')

    expect(
      await hashArtifacts([{ name: 'specs/021-a/spec.md', path: join(main, 'spec.md') }])
    ).not.toBe(
      await hashArtifacts([{ name: 'specs/021-a/spec.md', path: join(worktree, 'spec.md') }])
    )
  })

  it('reports nothing for a phase that produces no artifacts', async () => {
    // `analyze`, `implement` and `open-pr` produce none. There is nothing to
    // verify, and a hash of nothing would make every one of them look modified.
    expect(await hashArtifacts([])).toBeNull()
  })
})
