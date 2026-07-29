import { describe, it, expect } from 'vitest'
import {
  gradeRisk,
  matchesGlob,
  type ChangeSummary,
} from '../../../src/runtime/review/risk-grader.js'

// Grading is evaluated strictly top-down, first match wins. The order is the
// point: a lockfile change that also touches a critical path is P0, not P3.

function change(over: Partial<ChangeSummary> = {}): ChangeSummary {
  return {
    files: ['src/widgets/list.ts'],
    linesChanged: 20,
    checkState: 'passing',
    sharedContractFiles: [],
    criticalPaths: [],
    ...over,
  }
}

describe('P0 — highest risk (FR-047)', () => {
  it.each([
    ['authentication', 'src/auth/login.ts'],
    ['payments', 'src/payments/charge.ts'],
    ['secrets', 'config/secrets.ts'],
    ['migrations', 'db/migrations/003_add.sql'],
    ['a public interface', 'packages/extension-sdk/types/api.d.ts'],
  ])('grades a change touching %s as P0', (_label, file) => {
    const graded = gradeRisk(change({ files: [file] }))
    expect(graded.grade).toBe('P0')
    expect(graded.trigger).toBeTruthy()
  })

  it('grades a change matching the repository critical-path list as P0', () => {
    const graded = gradeRisk(
      change({ files: ['src/widgets/list.ts'], criticalPaths: ['src/widgets/**'] })
    )
    expect(graded.grade).toBe('P0')
    expect(graded.trigger).toContain('critical')
  })

  it('does not treat an empty critical-path list as matching everything (FR-055)', () => {
    expect(gradeRisk(change({ criticalPaths: [] })).grade).not.toBe('P0')
  })

  it('names the specific file that triggered the grade (FR-050)', () => {
    expect(gradeRisk(change({ files: ['src/auth/login.ts'] })).trigger).toContain(
      'src/auth/login.ts'
    )
  })
})

describe('P1 — second grade (FR-048)', () => {
  it('grades a schema change as P1', () => {
    expect(gradeRisk(change({ files: ['src/shared/schemas/thing.schema.ts'] })).grade).toBe('P1')
  })

  it('grades a declared shared-contract file as P1', () => {
    const graded = gradeRisk(
      change({ files: ['proto/session.proto'], sharedContractFiles: ['proto/session.proto'] })
    )
    expect(graded.grade).toBe('P1')
  })

  it('grades more than 300 changed lines as P1', () => {
    expect(gradeRisk(change({ linesChanged: 301 })).grade).toBe('P1')
  })

  it('does not grade exactly 300 lines as P1', () => {
    expect(gradeRisk(change({ linesChanged: 300 })).grade).toBe('P2')
  })
})

describe('P3 — lowest grade (FR-049)', () => {
  it.each([
    ['a lockfile', 'package-lock.json'],
    ['formatting config', '.prettierrc.json'],
  ])('grades %s with green checks as P3', (_label, file) => {
    expect(gradeRisk(change({ files: [file] })).grade).toBe('P3')
  })

  it.each(['pending', 'failing', 'unavailable'] as const)(
    'refuses P3 when checks are %s (FR-057, FR-062)',
    (checkState) => {
      // An unreachable code host must never produce a P3, because P3 is the
      // only grade that can merge unattended.
      expect(gradeRisk(change({ files: ['package-lock.json'], checkState })).grade).not.toBe('P3')
    }
  )

  it('does not grade a lockfile change alongside a source change as P3', () => {
    expect(gradeRisk(change({ files: ['package-lock.json', 'src/widgets/list.ts'] })).grade).toBe(
      'P2'
    )
  })
})

describe('evaluation order', () => {
  it('grades a lockfile change that also touches a critical path as P0, not P3', () => {
    // The trap: P3 is checked last precisely so that a "trivial" change with a
    // dangerous file in it cannot slip into the auto-merge lane.
    const graded = gradeRisk(change({ files: ['package-lock.json', 'src/auth/login.ts'] }))
    expect(graded.grade).toBe('P0')
  })

  it('grades a 400-line change touching auth as P0, not P1', () => {
    expect(gradeRisk(change({ files: ['src/auth/x.ts'], linesChanged: 400 })).grade).toBe('P0')
  })
})

describe('P2 — the default', () => {
  it('grades ordinary feature work as P2', () => {
    expect(gradeRisk(change()).grade).toBe('P2')
  })

  it('grades an empty change list as P2 rather than throwing', () => {
    expect(gradeRisk(change({ files: [] })).grade).toBe('P2')
  })
})

describe('glob matching for critical paths', () => {
  it.each([
    ['src/auth/**', 'src/auth/login.ts', true],
    ['src/auth/**', 'src/auth/deep/nested/x.ts', true],
    ['src/auth/**', 'src/authorised/x.ts', false],
    ['src/*/index.ts', 'src/a/index.ts', true],
    ['src/*/index.ts', 'src/a/b/index.ts', false],
    ['**/*.sql', 'db/migrations/1.sql', true],
    ['exact/path.ts', 'exact/path.ts', true],
    ['exact/path.ts', 'exact/other.ts', false],
    ['a.b.ts', 'axbxts', false],
  ])('%s vs %s -> %s', (glob, file, expected) => {
    expect(matchesGlob(file, glob)).toBe(expected)
  })
})
