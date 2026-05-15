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

  it('splits directories with subdirectories when group exceeds 15 files', () => {
    // 9 files in src/auth and 9 files in src/payments — 18 total under src, split by subdir
    const authFiles = Array.from({ length: 9 }, (_, i) => f(`src/auth/file${i}.ts`))
    const paymentFiles = Array.from({ length: 9 }, (_, i) => f(`src/payments/file${i}.ts`))
    const chapters = buildChapters([...authFiles, ...paymentFiles])
    // Each subdir group (9 files) is ≤ 15, so we should get two separate chapters
    expect(chapters.length).toBeGreaterThanOrEqual(2)
    expect(chapters.every((c) => c.files.length <= 15)).toBe(true)
  })

  it('keeps flat directories together even if large (no subdirs to split on)', () => {
    const manyFiles = Array.from({ length: 18 }, (_, i) => f(`src/payments/file${i}.ts`))
    const chapters = buildChapters(manyFiles)
    // All files are directly in src/payments with no subdirectory — cannot split further
    expect(chapters).toHaveLength(1)
  })

  it('keeps small directories together in one chapter', () => {
    const chapters = buildChapters([
      f('src/auth/login.ts'),
      f('src/auth/logout.ts'),
      f('src/auth/register.ts'),
    ])
    expect(chapters).toHaveLength(1)
    expect(chapters[0].id).toBe('src')
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

  it('implementation files (tier 1) appear before type files (tier 0) within the same chapter', () => {
    const chapters = buildChapters([f('src/types.ts'), f('src/service.ts')])
    const files = chapters[0].files
    const implIdx = files.findIndex((f) => f.path === 'src/service.ts')
    const typeIdx = files.findIndex((f) => f.path === 'src/types.ts')
    expect(implIdx).toBeLessThan(typeIdx)
  })

  it('tier 2 files appear after tier 1 within the same chapter', () => {
    const chapters = buildChapters([f('src/service.spec.ts'), f('src/service.ts')])
    const files = chapters[0].files
    const sourceIdx = files.findIndex((f) => f.path === 'src/service.ts')
    const testIdx = files.findIndex((f) => f.path === 'src/service.spec.ts')
    expect(sourceIdx).toBeLessThan(testIdx)
  })

  it('higher-layer files (e.g. component) appear before lower-layer files (e.g. util) within tier 1', () => {
    const chapters = buildChapters([f('src/util.ts'), f('src/component.ts')])
    const files = chapters[0].files.filter((f) => f.tier === 1)
    const compIdx = files.findIndex((f) => f.path === 'src/component.ts')
    const utilIdx = files.findIndex((f) => f.path === 'src/util.ts')
    expect(compIdx).toBeLessThan(utilIdx)
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
