import { describe, it, expect } from 'vitest'
import {
  buildChapters,
  parseReviewQueuePR,
  classifyHunk,
  extractIssueRefs,
  detectDryViolations,
  parsePrFileDiff,
} from '../../src/github/pr-review-service'
import { ReviewSessionSchema } from '../../src/schemas/pr-review.schema'
import type { z } from 'zod'

// ─── Session persistence schema (T037) ───────────────────────────────────────

// A session as stored before v2: the fields v2 added are left to the schema's defaults.
const validSession: z.input<typeof ReviewSessionSchema> = {
  repoRoot: '/home/user/repo',
  prNumber: 42,
  headSHA: 'abc123',
  currentChapterId: 'src',
  currentFilePath: 'src/auth.ts',
  viewedFiles: ['src/auth.ts', 'src/types.ts'],
  fileOrderOverrides: { src: ['src/types.ts', 'src/auth.ts'] },
  scrollPosition: 250,
  pausedAt: '2026-05-07T12:00:00Z',
  lastAccessedAt: '2026-05-07T12:05:00Z',
}

describe('ReviewSessionSchema', () => {
  it('parses a valid session', () => {
    const result = ReviewSessionSchema.safeParse(validSession)
    expect(result.success).toBe(true)
  })

  it('accepts null currentChapterId and currentFilePath', () => {
    const result = ReviewSessionSchema.safeParse({
      ...validSession,
      currentChapterId: null,
      currentFilePath: null,
    })
    expect(result.success).toBe(true)
  })

  it('accepts null scrollPosition', () => {
    const result = ReviewSessionSchema.safeParse({ ...validSession, scrollPosition: null })
    expect(result.success).toBe(true)
  })

  it('accepts null pausedAt', () => {
    const result = ReviewSessionSchema.safeParse({ ...validSession, pausedAt: null })
    expect(result.success).toBe(true)
  })
})

describe('ReviewSessionSchema — rejects missing repoRoot', () => {
  it('rejects missing repoRoot', () => {
    const { repoRoot: _, ...rest } = validSession
    expect(ReviewSessionSchema.safeParse(rest).success).toBe(false)
  })
})

// ─── parseReviewQueuePR branches ─────────────────────────────────────────────

describe('parseReviewQueuePR()', () => {
  it.each([
    ['OPEN', 'open'],
    ['MERGED', 'merged'],
    ['closed', 'closed'],
    [undefined, 'open'],
    ['SOMETHING', 'open'],
  ])('maps state %s to %s', (state, expected) => {
    expect(parseReviewQueuePR({ number: 1, title: 't', state }).state).toBe(expected)
  })
})

describe('parseReviewQueuePR() — parses a PR with no files (uses changedFiles, additions, deletions from root)', () => {
  it('parses a PR with no files (uses changedFiles, additions, deletions from root)', () => {
    const raw = {
      number: 1,
      title: 'Test PR',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      changedFiles: 3,
      additions: 50,
      deletions: 10,
      statusCheckRollup: [],
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.fileCount).toBe(3)
    expect(pr.additions).toBe(50)
    expect(pr.deletions).toBe(10)
    expect(pr.ciStatus).toBe('none')
  })
})

describe('parseReviewQueuePR() — parses a PR with files array (sums additions/deletions from files)', () => {
  it('parses a PR with files array (sums additions/deletions from files)', () => {
    const raw = {
      number: 2,
      title: 'PR with files',
      author: { login: 'bob', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'fix/bug',
      baseRefName: 'main',
      isDraft: true,
      files: [
        { path: 'src/a.ts', additions: 10, deletions: 5 },
        { path: 'src/b.ts', additions: 20, deletions: 3 },
      ],
      statusCheckRollup: null,
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.fileCount).toBe(2)
    expect(pr.additions).toBe(30)
    expect(pr.deletions).toBe(8)
    expect(pr.isDraft).toBe(true)
  })
})

describe('parseReviewQueuePR() — maps ciSignal=fail to ciStatus=failing', () => {
  it('maps ciSignal=fail to ciStatus=failing', () => {
    const raw = {
      number: 3,
      title: 'Failing CI',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      statusCheckRollup: [{ state: 'FAILURE' }],
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.ciStatus).toBe('failing')
  })
})

describe('parseReviewQueuePR() — maps ciSignal=warn to ciStatus=pending', () => {
  it('maps ciSignal=warn to ciStatus=pending', () => {
    const raw = {
      number: 4,
      title: 'Pending CI',
      author: { login: 'alice', avatarUrl: '' },
      createdAt: '2025-01-01T00:00:00Z',
      headRefName: 'feat/test',
      baseRefName: 'main',
      isDraft: false,
      statusCheckRollup: [{ state: 'IN_PROGRESS' }],
    }
    const pr = parseReviewQueuePR(raw)
    expect(pr.ciStatus).toBe('pending')
  })
})

// ─── buildChapters — additional branch coverage ────────────────────────────

describe('buildChapters() — additional branches — handles file with explicit added/removed changeType', () => {
  it('handles file with explicit added/removed changeType', () => {
    const rawFiles = [
      { path: 'src/new-file.ts', additions: 50, deletions: 0, changeType: 'added' },
      { path: 'src/old-file.ts', additions: 0, deletions: 30, changeType: 'removed' },
    ]
    const chapters = buildChapters(rawFiles)
    const allFiles = chapters.flatMap((c) => c.files)
    const newFile = allFiles.find((f) => f.path === 'src/new-file.ts')
    const oldFile = allFiles.find((f) => f.path === 'src/old-file.ts')
    expect(newFile?.changeType).toBe('added')
    expect(oldFile?.changeType).toBe('deleted')
  })

  it('handles filename field instead of path', () => {
    const rawFiles = [{ filename: 'src/component.ts', additions: 10, deletions: 0 }]
    const chapters = buildChapters(rawFiles)
    expect(chapters[0].files[0].path).toBe('src/component.ts')
  })
})

// ─── classifyHunk ─────────────────────────────────────────────────────────────

describe('classifyHunk', () => {
  it('returns semantic for hunk with only context lines', () => {
    const hunk = {
      lines: [{ type: 'context', content: 'const x = 1' }],
    }
    expect(classifyHunk(hunk)).toBe('semantic')
  })

  it('returns semantic when add and remove counts differ', () => {
    const hunk = {
      lines: [
        { type: 'add', content: 'const x = 1' },
        { type: 'add', content: 'const y = 2' },
        { type: 'remove', content: 'const z = 3' },
      ],
    }
    expect(classifyHunk(hunk)).toBe('semantic')
  })
})

describe('classifyHunk — returns formatting when add and remove are whitespace variants of each other', () => {
  it('returns formatting when add and remove are whitespace variants of each other', () => {
    const hunk = {
      lines: [
        { type: 'remove', content: 'const x = 1' },
        { type: 'add', content: '  const x = 1' },
      ],
    }
    expect(classifyHunk(hunk)).toBe('formatting')
  })

  it('returns semantic when content differs meaningfully', () => {
    const hunk = {
      lines: [
        { type: 'remove', content: 'const x = 1' },
        { type: 'add', content: 'const x = 2' },
      ],
    }
    expect(classifyHunk(hunk)).toBe('semantic')
  })
})

describe('classifyHunk — returns formatting for reordered import lines', () => {
  it('returns formatting for reordered import lines', () => {
    const hunk = {
      lines: [
        { type: 'remove', content: "import { a } from './a'" },
        { type: 'remove', content: "import { b } from './b'" },
        { type: 'add', content: "import { b } from './b'" },
        { type: 'add', content: "import { a } from './a'" },
      ],
    }
    expect(classifyHunk(hunk)).toBe('formatting')
  })
})

// ─── extractIssueRefs ─────────────────────────────────────────────────────────

describe('extractIssueRefs', () => {
  it('extracts GitHub issue references', () => {
    const body = 'Fixes #123\nCloses #456'
    const refs = extractIssueRefs(body)
    expect(refs).toHaveLength(2)
    expect(refs[0]).toEqual({ type: 'github', ref: '#123' })
    expect(refs[1]).toEqual({ type: 'github', ref: '#456' })
  })

  it('extracts Linear issue URLs', () => {
    const body = 'Fixes https://linear.app/myteam/issue/TEAM-123 some extra text'
    const refs = extractIssueRefs(body)
    expect(refs.some((r) => r.type === 'linear' && r.ref === 'TEAM-123')).toBe(true)
  })

  it('returns empty array for body with no refs', () => {
    expect(extractIssueRefs('Just a description')).toHaveLength(0)
  })

  it('handles case-insensitive keywords', () => {
    const refs = extractIssueRefs('FIXES #99 RESOLVES #100')
    expect(refs).toHaveLength(2)
  })
})

// ─── detectDryViolations ──────────────────────────────────────────────────────

describe('detectDryViolations', () => {
  it('returns empty array when no patches provided', () => {
    const result = detectDryViolations([{ path: 'a.ts' }, { path: 'b.ts' }])
    expect(result).toHaveLength(0)
  })

  it('detects duplicate added blocks across files', () => {
    const sharedBlock = Array.from(
      { length: 5 },
      (_, i) => `+  const handler${i} = () => doSomethingWithThisLongLine${i}()`
    ).join('\n')
    const files = [
      { path: 'src/a.ts', patch: sharedBlock },
      { path: 'src/b.ts', patch: sharedBlock },
    ]
    const violations = detectDryViolations(files)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0].files).toContain('src/a.ts')
    expect(violations[0].files).toContain('src/b.ts')
  })

  it('returns no violations when blocks are unique', () => {
    const files = [
      { path: 'src/a.ts', patch: '+const uniqueA = doSomethingSpecificToFileA()' },
      { path: 'src/b.ts', patch: '+const uniqueB = doSomethingSpecificToFileB()' },
    ]
    expect(detectDryViolations(files)).toHaveLength(0)
  })
})

describe('extractIssueRefs — Jira', () => {
  it('finds a Jira browse URL', async () => {
    const { extractIssueRefs } = await import('../../src/github/pr-review-service')
    const refs = extractIssueRefs('Fixes https://tav.atlassian.net/browse/TAV-7 today')
    expect(refs).toContainEqual({
      type: 'jira',
      ref: 'TAV-7',
      url: 'https://tav.atlassian.net/browse/TAV-7',
    })
  })

  it('still finds GitHub and Linear references alongside it', async () => {
    const { extractIssueRefs } = await import('../../src/github/pr-review-service')
    const refs = extractIssueRefs(
      'Closes #12, https://linear.app/tav/issue/TAV-42 and https://tav.atlassian.net/browse/TAV-7'
    )
    expect(refs.map((r) => r.type).sort()).toEqual(['github', 'jira', 'linear'])
  })
})

const LINEAR_REF = {
  type: 'linear' as const,
  ref: 'TAV-42',
  url: 'https://linear.app/tav/issue/TAV-42',
}

describe('enrichIssueRefs (FR-030)', () => {
  it('fills in the title and state a bare key does not carry', async () => {
    const { enrichIssueRefs } = await import('../../src/github/pr-review-service')
    const issues = {
      get: vi
        .fn()
        .mockResolvedValue({ title: 'Unify connections', state: { name: 'In Progress' } }),
    }

    const [enriched] = await enrichIssueRefs([LINEAR_REF], issues)

    expect(issues.get).toHaveBeenCalledWith('linear', 'TAV-42')
    expect(enriched).toMatchObject({ title: 'Unify connections', state: 'In Progress' })
  })

  it('leaves GitHub references alone — they are not a tracker issue', async () => {
    const { enrichIssueRefs } = await import('../../src/github/pr-review-service')
    const issues = { get: vi.fn() }

    const [enriched] = await enrichIssueRefs([{ type: 'github' as const, ref: '#12' }], issues)

    expect(issues.get).not.toHaveBeenCalled()
    expect(enriched).toEqual({ type: 'github', ref: '#12' })
  })
})

describe('enrichIssueRefs (FR-030) — renders exactly as today when the tracker cannot be reached', () => {
  it('renders exactly as today when the tracker cannot be reached', async () => {
    const { enrichIssueRefs } = await import('../../src/github/pr-review-service')
    const issues = { get: vi.fn().mockRejectedValue(new Error('not connected')) }

    const [enriched] = await enrichIssueRefs([LINEAR_REF], issues)

    // Best-effort by design: a review must not fail because a tracker did.
    expect(enriched).toEqual(LINEAR_REF)
  })

  it('leaves a reference alone when the issue no longer exists', async () => {
    const { enrichIssueRefs } = await import('../../src/github/pr-review-service')
    const issues = { get: vi.fn().mockResolvedValue(null) }

    const [enriched] = await enrichIssueRefs([LINEAR_REF], issues)
    expect(enriched).toEqual(LINEAR_REF)
  })
})

describe('enrichIssueRefs (FR-030) — Jira references', () => {
  it('leaves a Jira reference as found without asking a tracker', async () => {
    const { enrichIssueRefs } = await import('../../src/github/pr-review-service')
    const issues = {
      get: vi.fn().mockResolvedValue({ title: 'Move Jira over', state: { name: 'Done' } }),
    }

    await enrichIssueRefs([{ type: 'jira' as const, ref: 'TAV-7' }], issues)
    expect(issues.get).not.toHaveBeenCalled()
  })
})

describe('enrichIssueRefs — no tracker available', () => {
  it('returns references untouched when the host offers no issues namespace', async () => {
    const { enrichIssueRefs } = await import('../../src/github/pr-review-service')
    const refs = [
      { type: 'linear' as const, ref: 'TAV-42', url: 'https://linear.app/tav/issue/TAV-42' },
      { type: 'github' as const, ref: '#12' },
    ]
    // An older host has no api.issues; the review view must render exactly as
    // it always did rather than failing.
    await expect(enrichIssueRefs(refs, undefined)).resolves.toEqual(refs)
  })
})

const head = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n'

const flat = (raw: string) =>
  parsePrFileDiff(raw, 'x').hunks.flatMap((h) =>
    h.lines.map((l) => [l.type, l.content, l.oldLineNumber, l.newLineNumber])
  )

describe('parsePrFileDiff — patch content that looks like a file header', () => {
  it('counts a removed `--- x` line and an added `+++i;` line as content, not headers', () => {
    const raw = `${head}@@ -1,3 +1,3 @@\n a\n--- x\n+++i;\n z\n`
    expect(flat(raw)).toEqual([
      ['context', 'a', 1, 1],
      ['remove', '-- x', 2, null],
      ['add', '++i;', null, 2],
      ['context', 'z', 3, 3],
    ])
  })
})

describe('parsePrFileDiff', () => {
  it('drops the "No newline at end of file" marker and the trailing empty element', () => {
    const raw = `${head}@@ -1,2 +1,2 @@\n a\n-b\n+c\n\\ No newline at end of file\n`
    expect(flat(raw)).toEqual([
      ['context', 'a', 1, 1],
      ['remove', 'b', 2, null],
      ['add', 'c', null, 2],
    ])
  })

  it('keeps a genuinely blank context line (a single space) mid-hunk', () => {
    const raw = `${head}@@ -1,3 +1,3 @@\n a\n \n-b\n+c\n`
    expect(flat(raw)).toEqual([
      ['context', 'a', 1, 1],
      ['context', '', 2, 2],
      ['remove', 'b', 3, null],
      ['add', 'c', null, 3],
    ])
  })
})

describe('parseDiff — numbers a second hunk from its own header', () => {
  it('numbers a second hunk from its own header', () => {
    const raw = `${head}@@ -1,1 +1,1 @@\n a\n@@ -10,2 +20,2 @@\n-x\n+y\n z\n`
    const hunks = parsePrFileDiff(raw, 'x').hunks
    expect(hunks).toHaveLength(2)
    expect(hunks[1].lines.map((l) => [l.oldLineNumber, l.newLineNumber])).toEqual([
      [10, null],
      [null, 20],
      [11, 21],
    ])
  })
})
