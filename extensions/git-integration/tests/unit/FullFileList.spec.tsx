import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { FullFileList } from '../../src/components/pr-review/FullFileList'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import { PrReviewDetailSchema, type PrReviewDetail } from '../../src/schemas/pr-review.schema'
import { changedFile } from './support/pr-review-file'
import { makeRiskScore } from './risk-score-fixtures'

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: vi.fn(),
}))

vi.mock('../../src/github/pr-review-service', () => ({
  chapterRiskLevel: vi.fn().mockReturnValue('low'),
}))

// Parsed as the review channel's answer is, so the schema's defaults are filled in.
function makePr(chapters: PrReviewDetail['chapters']): PrReviewDetail {
  return PrReviewDetailSchema.parse({
    number: 1,
    title: 'My PR',
    body: '',
    author: 'alice',
    authorAvatarUrl: '',
    openedAt: '2024-01-01T00:00:00Z',
    headRefName: 'feature',
    baseRefName: 'main',
    headSHA: 'abc',
    ciStatus: 'none',
    chapters,
  })
}

function makeFile(path: string) {
  return changedFile(path, { additions: 5, deletions: 2, riskScore: makeRiskScore() })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(usePrReviewStore).mockReturnValue({
    viewedFiles: new Set<string>(),
    fileOrderOverrides: {},
  })
})

const defaultProps = {
  pr: makePr([
    {
      id: 'ch-1',
      name: 'Core',
      estimatedMinutes: 10,
      status: 'not-started',
      files: [makeFile('src/foo.ts'), makeFile('src/bar.ts')],
    },
  ]),
  repoRoot: '/repo',
  headSHA: 'abc',
  currentFilePath: null,
  onSelectFile: vi.fn(),
}

describe('FullFileList', () => {
  it('renders chapter name', () => {
    render(<FullFileList {...defaultProps} />)
    expect(screen.getByText('1 · Core')).toBeTruthy()
  })

  it('renders file names', () => {
    render(<FullFileList {...defaultProps} />)
    expect(screen.getByText('foo.ts')).toBeTruthy()
    expect(screen.getByText('bar.ts')).toBeTruthy()
  })

  it('shows file additions and deletions', () => {
    render(<FullFileList {...defaultProps} />)
    const additions = screen.getAllByText('+5')
    expect(additions.length).toBeGreaterThan(0)
  })

  it('calls onSelectFile when file row is clicked', () => {
    const onSelectFile = vi.fn()
    render(<FullFileList {...defaultProps} onSelectFile={onSelectFile} />)
    fireEvent.click(screen.getByText('foo.ts'))
    expect(onSelectFile).toHaveBeenCalledWith('src/foo.ts', 'ch-1')
  })
})

describe('FullFileList — toggles chapter collapsed state when header is clicked', () => {
  it('toggles chapter collapsed state when header is clicked', () => {
    render(<FullFileList {...defaultProps} />)
    const chapterHeader = screen.getByRole('button', { name: /1 · Core/ })
    fireEvent.click(chapterHeader)
    expect(screen.queryByText('foo.ts')).toBeNull()
  })

  it('marks a viewed file as viewed and an unviewed one as not viewed', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(['src/foo.ts']),
      fileOrderOverrides: {},
    })
    render(<FullFileList {...defaultProps} />)
    expect(
      within(screen.getByTitle('src/foo.ts')).getByRole('img', { name: 'Viewed' })
    ).toBeTruthy()
    expect(
      within(screen.getByTitle('src/bar.ts')).getByRole('img', { name: 'Not viewed' })
    ).toBeTruthy()
  })

  it('marks active file with active class', () => {
    const { container } = render(<FullFileList {...defaultProps} currentFilePath="src/foo.ts" />)
    const activeRow = container.querySelector('.full-file-row--active')
    expect(activeRow).toBeTruthy()
    expect(activeRow?.getAttribute('aria-current')).toBe('true')
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(1)
  })
})

describe('FullFileList — shows progress per chapter', () => {
  it('shows viewed of total per chapter', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(['src/foo.ts']),
      fileOrderOverrides: {},
    })
    render(<FullFileList {...defaultProps} />)
    expect(screen.getByText('1 of 2')).toBeTruthy()
  })

  it('numbers each chapter before its name', () => {
    const second = { ...defaultProps.pr.chapters[0], id: 'ch-2', name: 'Tests' }
    const pr = makePr([...defaultProps.pr.chapters, second])
    render(<FullFileList {...defaultProps} pr={pr} />)
    expect(screen.getByText('1 · Core')).toBeTruthy()
    expect(screen.getByText('2 · Tests')).toBeTruthy()
  })

  it('respects fileOrderOverrides for chapter file order', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set<string>(),
      fileOrderOverrides: { 'ch-1': ['src/bar.ts', 'src/foo.ts'] },
    })
    render(<FullFileList {...defaultProps} />)
    const rows = screen.getAllByTitle(/src\//)
    expect(rows[0].getAttribute('title')).toBe('src/bar.ts')
    expect(rows[1].getAttribute('title')).toBe('src/foo.ts')
  })
})

describe('FullFileList — shows changed for a file the store lists as changed since viewed', () => {
  it('shows "changed" for a file the store lists as changed since viewed', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set<string>(),
      fileOrderOverrides: {},
      changedSince: new Set(['src/foo.ts']),
      viewedAt: {},
    })
    render(<FullFileList {...defaultProps} />)
    expect(screen.getByText('changed')).toBeTruthy()
  })

  it('shows "viewed" for a file marked viewed and unchanged since', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(['src/foo.ts']),
      fileOrderOverrides: {},
      changedSince: new Set<string>(),
      viewedAt: { 'src/foo.ts': 'abc' },
    })
    render(<FullFileList {...defaultProps} />)
    expect(screen.getByRole('img', { name: 'Viewed' })).toBeTruthy()
  })
})

describe.each([
  ['a push added since your last look', new Set(['src/new.ts']), true],
  ['a first review', new Set<string>(), false],
])('FullFileList — added file on %s', (_name, newSinceLook, isLabelled) => {
  it(`${isLabelled ? 'shows' : 'does not show'} "new file"`, () => {
    const pr = makePr([
      {
        id: 'ch-1',
        name: 'Core',
        estimatedMinutes: 10,
        status: 'not-started',
        files: [{ ...makeFile('src/new.ts'), changeType: 'added' }],
      },
    ])
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set<string>(),
      fileOrderOverrides: {},
      changedSince: new Set<string>(),
      newSinceLook,
    })
    render(<FullFileList {...defaultProps} pr={pr} />)
    expect(screen.queryByText('new file') !== null).toBe(isLabelled)
  })
})

describe('FullFileList — row details', () => {
  const highRiskFile = {
    ...makeFile('src/risky.ts'),
    riskScore: { ...makeRiskScore(), level: 'high' as const },
  }
  const riskyPr = makePr([
    {
      id: 'ch-1',
      name: 'Core',
      estimatedMinutes: 10,
      status: 'not-started',
      files: [highRiskFile],
    },
  ])

  it('shows the risk state on an unviewed high-risk file', () => {
    render(<FullFileList {...defaultProps} pr={riskyPr} />)
    expect(screen.getByRole('img', { name: 'High risk, not viewed' })).toBeTruthy()
  })

  it('shows viewed, not risk, once a high-risk file is viewed', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set(['src/risky.ts']),
      fileOrderOverrides: {},
    })
    render(<FullFileList {...defaultProps} pr={riskyPr} />)
    expect(screen.getByRole('img', { name: 'Viewed' })).toBeTruthy()
    expect(screen.queryByRole('img', { name: /High risk/ })).toBeNull()
  })
})

describe('FullFileList — comments and folder', () => {
  it('shows the comment count of a file with threads', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set<string>(),
      fileOrderOverrides: {},
      threads: { 'src/foo.ts': [{}, {}, {}] },
    })
    render(<FullFileList {...defaultProps} />)
    expect(within(screen.getByTitle('src/foo.ts')).getByText('3')).toBeTruthy()
    expect(within(screen.getByTitle('src/bar.ts')).queryByText('3')).toBeNull()
  })

  it.each([
    [3, 'comments'],
    [1, 'comment'],
  ])('names %s as "%s" for assistive technology', (count, word) => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      viewedFiles: new Set<string>(),
      fileOrderOverrides: {},
      threads: { 'src/foo.ts': Array.from({ length: count }, () => ({})) },
    })
    render(<FullFileList {...defaultProps} />)
    const row = screen.getByTitle('src/foo.ts')
    expect(within(row).getByText(word).className).toBe('pr-visually-hidden')
  })

  it('shows the folder muted after the file name', () => {
    render(<FullFileList {...defaultProps} />)
    expect(within(screen.getByTitle('src/foo.ts')).getByText('src/')).toBeTruthy()
  })
})

describe('FullFileList — reading-order reason', () => {
  it('does not render the reading-order reason on the row', () => {
    const pr = makePr([
      {
        id: 'ch-1',
        name: 'Core',
        estimatedMinutes: 10,
        status: 'not-started',
        files: [makeFile('src/foo.ts')],
      },
    ])
    pr.readingOrder = [
      { step: 1, path: 'src/foo.ts', symbol: null, reason: 'Defines RiskScore', uses: [] },
    ]
    render(<FullFileList {...defaultProps} pr={pr} />)
    expect(screen.queryByText('Defines RiskScore')).toBeNull()
  })
})
