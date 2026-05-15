import { describe, it, expect } from 'vitest'
import { buildChapters } from '../../src/github/pr-review-service'

const f = (path: string, additions = 10, deletions = 2, patch?: string) => ({
  path,
  additions,
  deletions,
  status: 'modified',
  patch,
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

  it('groups files in the same immediate directory into one chapter', () => {
    const chapters = buildChapters([
      f('src/auth/login.ts'),
      f('src/auth/logout.ts'),
      f('docs/README.md'),
    ])
    const ids = chapters.map((c) => c.id)
    expect(ids).toContain('auth')
    expect(ids).toContain('docs')
  })

  it('assigns semantic group names for canonical directories', () => {
    const chapters = buildChapters([f('services/auth.ts'), f('components/Button.tsx')])
    const names = chapters.map((c) => c.name)
    expect(names).toContain('Business Logic')
    expect(names).toContain('UI')
  })

  it('sub-splits semantic groups that exceed 15 files', () => {
    const authFiles = Array.from({ length: 9 }, (_, i) => f(`services/auth/file${i}.ts`))
    const paymentFiles = Array.from({ length: 9 }, (_, i) => f(`services/payments/file${i}.ts`))
    const chapters = buildChapters([...authFiles, ...paymentFiles])
    expect(chapters.length).toBeGreaterThanOrEqual(2)
    expect(chapters.every((c) => c.files.length <= 15)).toBe(true)
  })

  it('keeps flat directories together even if large (no subdirs to split on)', () => {
    const manyFiles = Array.from({ length: 18 }, (_, i) => f(`src/payments/file${i}.ts`))
    const chapters = buildChapters(manyFiles)
    expect(chapters).toHaveLength(1)
  })

  it('places type/interface files in tier 0', () => {
    const chapters = buildChapters([f('src/auth.types.ts'), f('src/auth.ts')])
    const files = chapters.flatMap((c) => c.files)
    expect(files.find((f) => f.path === 'src/auth.types.ts')?.tier).toBe(0)
    expect(files.find((f) => f.path === 'src/auth.ts')?.tier).toBe(1)
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

  // ─── Signal 1: Semantic grouping ────────────────────────────────────────────

  it('uses canonical group name for well-known directories', () => {
    const chapters = buildChapters([
      f('services/auth.ts'),
      f('routes/users.ts'),
      f('types/payment.ts'),
    ])
    const names = chapters.map((c) => c.name)
    expect(names).toContain('Business Logic')
    expect(names).toContain('API Layer')
    expect(names).toContain('Types & Contracts')
  })

  it('falls back to immediate parent directory name for unknown directories', () => {
    const chapters = buildChapters([f('src/auth/login.ts'), f('src/auth/logout.ts')])
    expect(chapters).toHaveLength(1)
    expect(chapters[0].name).toBe('auth')
  })

  // ─── Signal 2: Feature-stem merge ───────────────────────────────────────────

  it('groups cross-directory files that share a feature stem', () => {
    // The core case: types in a types/ dir, implementation elsewhere
    const chapters = buildChapters([f('types/feature.ts'), f('src/code/feature/feature.ts')])
    expect(chapters).toHaveLength(1)
    const paths = chapters[0].files.map((f) => f.path)
    expect(paths).toContain('types/feature.ts')
    expect(paths).toContain('src/code/feature/feature.ts')
  })

  it('merges types/ file with its matching service implementation', () => {
    const chapters = buildChapters([f('types/auth.ts'), f('services/auth.ts')])
    expect(chapters).toHaveLength(1)
    expect(chapters[0].files).toHaveLength(2)
  })

  it('does not merge files with different stems into the same chapter', () => {
    const chapters = buildChapters([
      f('types/auth.ts'),
      f('types/payment.ts'),
      f('services/auth.ts'),
    ])
    // auth.ts files should merge; payment.ts should be separate
    const allPaths = chapters.flatMap((c) => c.files.map((f) => f.path))
    const authChapter = chapters.find((c) => c.files.some((f) => f.path === 'services/auth.ts'))
    expect(authChapter?.files.map((f) => f.path)).toContain('types/auth.ts')
    const paymentChapter = chapters.find((c) => c.files.some((f) => f.path === 'types/payment.ts'))
    expect(paymentChapter).toBeDefined()
    expect(allPaths).toHaveLength(3)
  })

  it('strips role suffixes when computing feature stems', () => {
    const chapters = buildChapters([
      f('src/auth.service.ts'),
      f('src/auth.types.ts'),
      f('src/auth.spec.ts'),
    ])
    // All three share stem "auth" → one chapter
    expect(chapters).toHaveLength(1)
    expect(chapters[0].files).toHaveLength(3)
  })

  // ─── Signal 3: Import-graph merge ───────────────────────────────────────────

  it('merges groups connected by an import in patch text', () => {
    const patch = "@@ -0,0 +1 @@\n+import { Foo } from '../utils/foo'"
    const chapters = buildChapters([f('components/Bar.tsx', 10, 0, patch), f('utils/foo.ts')])
    // import connects the two files even though their stems differ
    expect(chapters).toHaveLength(1)
    const paths = chapters[0].files.map((f) => f.path)
    expect(paths).toContain('components/Bar.tsx')
    expect(paths).toContain('utils/foo.ts')
  })

  it('files without patches are still grouped by other signals', () => {
    // No patch provided — falls back to semantic + stem signals
    const chapters = buildChapters([f('types/auth.ts'), f('services/auth.ts')])
    expect(chapters).toHaveLength(1)
  })
})
