import { describe, it, expect } from 'vitest'
import { buildChapters } from '../../src/github/pr-review-service'

const f = (path: string, additions = 10, deletions = 2) => ({
  path,
  additions,
  deletions,
  status: 'modified',
})

describe('buildChapters()', () => {
  it('returns empty array for empty input', () => {
    expect(buildChapters([])).toEqual([])
  })

  it('returns a single chapter for a single file', () => {
    const chapters = buildChapters([f('src/index.ts')])
    expect(chapters).toHaveLength(1)
    expect(chapters[0].files).toHaveLength(1)
    expect(chapters[0].files[0].path).toBe('src/index.ts')
  })

  it('groups files by top-level directory segment', () => {
    const chapters = buildChapters([
      f('src/auth/login.ts'),
      f('src/auth/logout.ts'),
      f('docs/README.md'),
    ])
    const ids = chapters.map((c) => c.id)
    expect(ids).toContain('src')
    expect(ids).toContain('docs')
  })

  it('places type/interface files in tier 0', () => {
    const chapters = buildChapters([f('src/auth.types.ts'), f('src/auth.ts')])
    const files = chapters.flatMap((c) => c.files)
    const typesFile = files.find((f) => f.path === 'src/auth.types.ts')
    const sourceFile = files.find((f) => f.path === 'src/auth.ts')
    expect(typesFile?.tier).toBe(0)
    expect(sourceFile?.tier).toBe(1)
  })

  it('places *.spec.* and *.test.* files in tier 2', () => {
    const chapters = buildChapters([f('src/auth.spec.ts'), f('src/auth.ts')])
    const files = chapters.flatMap((c) => c.files)
    expect(files.find((f) => f.path === 'src/auth.spec.ts')?.tier).toBe(2)
    expect(files.find((f) => f.path === 'src/auth.ts')?.tier).toBe(1)
  })

  it('places lock files and generated files in tier 3', () => {
    const chapters = buildChapters([f('package-lock.json'), f('src/auth.ts')])
    const files = chapters.flatMap((c) => c.files)
    expect(files.find((f) => f.path === 'package-lock.json')?.tier).toBe(3)
  })

  it('tier 0 files appear before tier 1 within the same chapter', () => {
    const chapters = buildChapters([f('src/types.ts'), f('src/service.ts')])
    const files = chapters[0].files
    expect(files[0].path).toBe('src/types.ts')
    expect(files[1].path).toBe('src/service.ts')
  })

  it('tier 2 files appear after tier 1 within the same chapter', () => {
    const chapters = buildChapters([f('src/service.spec.ts'), f('src/service.ts')])
    const files = chapters[0].files
    const sourceIdx = files.findIndex((f) => f.path === 'src/service.ts')
    const testIdx = files.findIndex((f) => f.path === 'src/service.spec.ts')
    expect(sourceIdx).toBeLessThan(testIdx)
  })

  it('all-mechanical files form their own chapter with tier 3', () => {
    const chapters = buildChapters([f('package-lock.json'), f('src/auth.ts')])
    const mechChapter = chapters.find((c) => c.files.every((f) => f.tier === 3))
    expect(mechChapter).toBeDefined()
  })

  it('applies fileOrderOverrides when provided', () => {
    const chapters = buildChapters([f('src/types.ts'), f('src/service.ts'), f('src/utils.ts')], {
      src: ['src/utils.ts', 'src/service.ts', 'src/types.ts'],
    })
    const files = chapters[0].files
    expect(files[0].path).toBe('src/utils.ts')
    expect(files[1].path).toBe('src/service.ts')
    expect(files[2].path).toBe('src/types.ts')
  })

  it('includes a whyHere label for every file', () => {
    const chapters = buildChapters([f('src/auth.ts'), f('src/auth.spec.ts')])
    const files = chapters.flatMap((c) => c.files)
    expect(files.every((f) => typeof f.whyHere === 'string' && f.whyHere.length > 0)).toBe(true)
  })

  it('sets estimatedMinutes on each chapter as sum of file estimates', () => {
    const chapters = buildChapters([
      f('src/big.ts', 120, 0), // ceil(120/60) = 2
      f('src/small.ts', 30, 0), // ceil(30/60) = 1
    ])
    const chap = chapters.find((c) => c.id === 'src')
    expect(chap?.estimatedMinutes).toBe(3)
  })
})
