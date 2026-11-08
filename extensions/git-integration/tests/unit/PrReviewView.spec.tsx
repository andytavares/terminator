import React from 'react'
import { describe, it, beforeAll, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePrReviewStore, type PrReviewStore } from '../../src/stores/pr-review.store'
import { githubAPI } from '../../src/api/github'
import { PrReviewDetailSchema } from '../../src/schemas/pr-review.schema'

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    sessionSet: vi.fn().mockResolvedValue({ ok: true }),
    filesViewedSet: vi.fn().mockResolvedValue({ ok: true }),
    fileViewedSet: vi.fn().mockResolvedValue({ ok: true }),
  },
}))
vi.mock('../../src/hooks/usePrReview', () => ({ useLoadInlineComments: vi.fn(() => vi.fn()) }))
vi.mock('../../src/components/pr-review/ChapterNav', () => ({
  ChapterNav: () => <div data-testid="chapter-nav" />,
}))
vi.mock('../../src/components/pr-review/ChapterFileList', () => ({
  ChapterFileList: () => <div data-testid="chapter-file-list" />,
}))
vi.mock('../../src/components/pr-review/FullFileList', () => ({
  FullFileList: () => <div data-testid="full-file-list" />,
}))
vi.mock('../../src/components/pr-review/ReviewDiffPane', () => ({
  ReviewDiffPane: ({
    onMarkViewed,
    onShowRisk,
    onPrevFile,
  }: {
    onMarkViewed: () => void
    onShowRisk: () => void
    onPrevFile: () => void
  }) => (
    <div data-testid="review-diff-pane">
      <button onClick={onMarkViewed}>MarkViewed</button>
      <button onClick={onShowRisk}>ShowRisk</button>
      <button onClick={onPrevFile}>PrevFile</button>
    </div>
  ),
}))
vi.mock('../../src/components/pr-review/WhyThisFile', () => ({
  WhyThisFile: () => <div data-testid="risk-panel" />,
}))
vi.mock('../../src/components/pr-review/ReviewSubmitPanel', () => ({
  ReviewSubmitPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="submit-panel">
      <button onClick={onClose}>CloseSubmit</button>
    </div>
  ),
}))
vi.mock('../../src/components/pr-review/AgentPanel', () => ({
  AgentPanel: () => <div data-testid="agent-panel" />,
}))
vi.mock('../../src/hooks/useAgentRuns', () => ({ useAgentRuns: vi.fn() }))

const mockFile = {
  path: 'src/foo.ts',
  changeType: 'modified' as const,
  additions: 5,
  deletions: 2,
  isBinary: false,
  tier: 1 as const,
  whyHere: 'changed',
  estimatedMinutes: 3,
  riskScore: {
    level: 'low' as const,
    composite: 5,
    dominantDriver: 'changeSize',
    topImporters: [],
    importerCount: 0,
    metrics: {
      changeSize: 5,
      churn90d: null,
      blastRadius: null,
      testFilePresent: null,
      complexityDelta: null,
      patchCoverage: null,
    },
  },
}

const mockChapter = {
  id: 'ch-1',
  name: 'Chapter 1',
  estimatedMinutes: 10,
  status: 'not-started' as const,
  files: [mockFile],
}

// Parsed as the review channel's answer is, so the schema's defaults are filled in.
const mockPr = PrReviewDetailSchema.parse({
  number: 1,
  title: 'PR',
  body: '',
  author: 'alice',
  authorAvatarUrl: '',
  openedAt: '2025-01-01T00:00:00Z',
  headRefName: 'feature',
  baseRefName: 'main',
  headSHA: 'abc',
  ciStatus: 'passing' as const,
  lintStatus: 'pass' as const,
  coverageStatus: 'pass' as const,
  chapters: [mockChapter],
})

const mockClose = vi.fn()
const mockRefresh = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.clearAllMocks()
  usePrReviewStore.getState().reset()
})

/** Seeds the real review store, renders the view on `mockPr` with `prOverrides`, and returns a
 *  user-event instance to drive it. */
async function renderView(
  prOverrides: Record<string, unknown> = {},
  storeOverrides: Partial<PrReviewStore> = {}
) {
  const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
  usePrReviewStore.setState(storeOverrides)
  const user = userEvent.setup()
  const rendered = render(
    <PrReviewView
      repoRoot="/repo"
      pr={{ ...mockPr, ...prOverrides }}
      onClose={mockClose}
      onRefresh={mockRefresh}
    />
  )
  return { user, ...rendered }
}

/** The reader's position in the real store. */
function position() {
  const { currentChapterId, currentFilePath } = usePrReviewStore.getState()
  return { currentChapterId, currentFilePath }
}

// The first import compiles the component tree, which on a loaded machine takes longer
// than one test's 5 s; load it once here so every test times only its own work.
beforeAll(async () => {
  await import('../../src/components/pr-review/PrReviewView')
})

describe('PrReviewView', () => {
  it('renders the diff pane when chapter and file are available', async () => {
    await renderView()
    expect(screen.getByTestId('review-diff-pane')).toBeTruthy()
  })

  it('shows chapter nav for multi-chapter PRs in guided mode', async () => {
    const ch2 = { ...mockChapter, id: 'ch-2', name: 'Chapter 2' }
    const { user } = await renderView(
      { chapters: [mockChapter, ch2] },
      { currentChapterId: 'ch-1', currentFilePath: 'src/foo.ts' }
    )
    await user.click(screen.getByRole('radio', { name: 'Chapters' }))
    expect(screen.getByTestId('chapter-nav')).toBeTruthy()
  })
})

describe('PrReviewView — single-chapter PRs', () => {
  it('offers no file list mode toggle and labels the list "Files" for a single-chapter PR', async () => {
    await renderView()
    expect(screen.queryByRole('radiogroup', { name: 'File list mode' })).toBeNull()
    expect(screen.getByText('Files')).toBeTruthy()
  })

  it('opens the submit panel from Submit review and hides it on CloseSubmit', async () => {
    const { user } = await renderView({}, { currentFilePath: 'src/foo.ts' })
    await user.click(screen.getByRole('button', { name: /^Submit review/ }))
    expect(screen.getByTestId('submit-panel')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'CloseSubmit' }))
    expect(screen.queryByTestId('submit-panel')).toBeNull()
  })
})

describe('PrReviewView — pausing', () => {
  it('records the pause time and closes the review when Pause review is picked', async () => {
    const { user } = await renderView({}, { currentFilePath: 'src/foo.ts' })
    await user.click(screen.getByRole('button', { name: 'More review actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Pause review' }))
    expect(usePrReviewStore.getState().pausedAt).not.toBeNull()
    expect(mockClose).toHaveBeenCalled()
  })

  it('shows review progress once, in the header, with the unviewed files estimate', async () => {
    await renderView({}, { currentFilePath: 'src/foo.ts' })
    expect(screen.getByText('0 of 1 viewed · about 3 min left')).toBeTruthy()
    expect(screen.queryByText(/files reviewed/)).toBeNull()
  })

  it('shows exactly one Submit review control', async () => {
    await renderView({}, { currentFilePath: 'src/foo.ts' })
    expect(screen.getAllByRole('button', { name: /^Submit review/ })).toHaveLength(1)
  })
})

describe('PrReviewView — opens the Agent tab of the inspector from Ask agent, and closes it', () => {
  it('opens the Agent tab of the inspector from Ask agent, and closes it', async () => {
    const { user } = await renderView({}, { currentFilePath: 'src/foo.ts' })
    await user.click(screen.getByRole('button', { name: 'Ask agent about this PR' }))
    expect(screen.getByRole('tab', { name: /Agent/, selected: true })).toBeTruthy()
    expect(screen.getByTestId('agent-panel')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Close inspector' }))
    expect(screen.queryByTestId('agent-panel')).toBeNull()
    expect(screen.queryByRole('tablist', { name: 'Inspector' })).toBeNull()
  })

  it('hides and restores the file list from the more menu', async () => {
    const { user } = await renderView({}, { currentFilePath: 'src/foo.ts' })
    expect(screen.getByTestId('full-file-list')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'More review actions' }))
    await user.click(screen.getByRole('menuitem', { name: /^Hide file list/ }))
    expect(screen.queryByTestId('full-file-list')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'More review actions' }))
    await user.click(screen.getByRole('menuitem', { name: /^Hide file list/ }))
    expect(screen.getByTestId('full-file-list')).toBeTruthy()
  })
})

describe('PrReviewView — shows risk panel when ShowRisk is clicked', () => {
  it('shows risk panel when ShowRisk is clicked', async () => {
    const { user } = await renderView({}, { currentFilePath: 'src/foo.ts' })
    await user.click(screen.getByRole('button', { name: 'ShowRisk' }))
    expect(screen.getByRole('tab', { name: 'Why this file', selected: true })).toBeTruthy()
    expect(screen.getByTestId('risk-panel')).toBeTruthy()
  })

  it('opens submit panel when FinishChapter is clicked on the last (only) chapter', async () => {
    const { user } = await renderView({}, { currentFilePath: 'src/foo.ts' })
    await user.click(screen.getByRole('button', { name: /^Viewed, submit review/ }))
    expect(screen.getByTestId('submit-panel')).toBeTruthy()
  })
})

describe('PrReviewView — finishing a non-final chapter', () => {
  it('opens the next chapter, not the submit panel, when Viewed, next chapter is clicked', async () => {
    const ch2 = { ...mockChapter, id: 'ch-2', name: 'Chapter 2', files: [mockFile] }
    const { user } = await renderView(
      { chapters: [mockChapter, ch2] },
      { currentChapterId: 'ch-1', currentFilePath: 'src/foo.ts' }
    )
    await user.click(screen.getByRole('button', { name: /^Viewed, next chapter/ }))
    expect(usePrReviewStore.getState().currentChapterId).toBe('ch-2')
    expect(screen.queryByTestId('submit-panel')).toBeNull()
  })
})

describe('PrReviewView — finishing a chapter marks its unviewed files in one batch', () => {
  it('marks every file of the chapter viewed and mirrors the unviewed ones in one request', async () => {
    const file2 = { ...mockFile, path: 'src/bar.ts' }
    const file3 = { ...mockFile, path: 'src/baz.ts' }
    const { user } = await renderView(
      { chapters: [{ ...mockChapter, files: [mockFile, file2, file3] }] },
      { currentFilePath: 'src/baz.ts', viewedFiles: new Set(['src/bar.ts']) }
    )
    await user.click(screen.getByRole('button', { name: /^Viewed, submit review/ }))
    expect([...usePrReviewStore.getState().viewedFiles].sort()).toEqual([
      'src/bar.ts',
      'src/baz.ts',
      'src/foo.ts',
    ])
    expect(githubAPI.filesViewedSet).toHaveBeenCalledTimes(1)
    expect(githubAPI.filesViewedSet).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 1, paths: ['src/foo.ts', 'src/baz.ts'], viewed: true })
    )
    expect(githubAPI.fileViewedSet).not.toHaveBeenCalled()
  })
})

describe('PrReviewView — MarkViewed', () => {
  it('marks the open file viewed and opens the next file', async () => {
    const file2 = { ...mockFile, path: 'src/bar.ts' }
    const { user } = await renderView(
      { chapters: [{ ...mockChapter, files: [mockFile, file2] }] },
      { currentFilePath: 'src/foo.ts' }
    )
    await user.click(screen.getByRole('button', { name: 'MarkViewed' }))
    expect([...usePrReviewStore.getState().viewedFiles]).toEqual(['src/foo.ts'])
    expect(usePrReviewStore.getState().currentFilePath).toBe('src/bar.ts')
  })
})

describe('PrReviewView — shows full-file-list by default, restores it after switching to guided and back', () => {
  it('shows full-file-list by default, restores it after switching to guided and back', async () => {
    const ch2 = { ...mockChapter, id: 'ch-2', name: 'Chapter 2' }
    const { user } = await renderView(
      { chapters: [mockChapter, ch2] },
      { currentFilePath: 'src/foo.ts', currentChapterId: 'ch-1' }
    )
    expect(screen.getByTestId('full-file-list')).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Chapters' }))
    expect(screen.getByTestId('chapter-file-list')).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Files' }))
    expect(screen.getByTestId('full-file-list')).toBeTruthy()
  })
})

describe('PrReviewView — refresh', () => {
  it('calls onRefresh when Refresh button is clicked', async () => {
    const { user } = await renderView({}, { currentFilePath: 'src/foo.ts' })
    await user.click(screen.getByRole('button', { name: 'More review actions' }))
    await user.click(screen.getByRole('menuitem', { name: /^Refresh PR/ }))
    expect(mockRefresh).toHaveBeenCalled()
  })
})

describe('PrReviewView — shows empty state message when no active file', () => {
  it('shows empty state message when no active file', async () => {
    await renderView({ chapters: [] }, { currentFilePath: null })
    expect(screen.getByText('Select a file to review.')).toBeTruthy()
  })
})

function makeLargeFile(path: string, additions: number) {
  return { ...mockFile, path, additions, deletions: 0 }
}

/** A one-chapter PR of 500 added lines, open at its only file. */
function renderLargePr() {
  const bigFile = makeLargeFile('src/big.ts', 500)
  return renderView(
    { chapters: [{ ...mockChapter, files: [bigFile] }] },
    { currentFilePath: 'src/big.ts' }
  )
}

describe('PrReviewView (continued) — large-PR warning', () => {
  it('shows large-PR banner when PR exceeds 400 LOC', async () => {
    const { user } = await renderLargePr()
    await user.click(screen.getByRole('button', { name: /500 LOC/ }))
    expect(screen.getByText(/Large PR — 500 LOC, estimated 125 min to review/)).toBeTruthy()
  })

  it('does not show large-PR banner when PR is under 400 LOC', async () => {
    await renderView()
    expect(screen.queryByRole('button', { name: /LOC ·/ })).toBeNull()
  })

  it('dismisses large-PR banner when × clicked', async () => {
    const { user } = await renderLargePr()
    await user.click(screen.getByRole('button', { name: /500 LOC/ }))
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('button', { name: /500 LOC/ })).toBeNull()
  })

  it('toggles focus mode on/off', async () => {
    const { user } = await renderLargePr()
    expect(screen.queryByRole('button', { name: 'Focus mode', pressed: true })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'More review actions' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: /^Focus mode/ }))
    await user.click(screen.getByRole('button', { name: 'Focus mode', pressed: true }))
    expect(screen.queryByRole('button', { name: 'Focus mode', pressed: true })).toBeNull()
  })
})

describe('PrReviewView (continued) — large-PR warning — drops all-low-risk chapters in focus mode instead of showing their full file list', () => {
  it('drops all-low-risk chapters in focus mode instead of showing their full file list', async () => {
    const lowFile = makeLargeFile('src/low.ts', 300)
    const highFile = {
      ...makeLargeFile('src/high.ts', 300),
      riskScore: { ...mockFile.riskScore, level: 'high' as const },
    }
    const lowChapter = { ...mockChapter, id: 'ch-low', name: 'Low only', files: [lowFile] }
    const highChapter = { ...mockChapter, id: 'ch-high', name: 'High risk', files: [highFile] }
    const { user } = await renderView(
      { chapters: [lowChapter, highChapter] },
      { currentFilePath: 'src/high.ts', currentChapterId: 'ch-high' }
    )
    await user.click(screen.getByRole('button', { name: 'More review actions' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: /^Focus mode/ }))
    // Progress total should reflect only the high-risk chapter (1 file), not both (2 files)
    expect(
      screen.getByRole('progressbar', { name: 'Files viewed' }).getAttribute('aria-valuemax')
    ).toBe('1')
  })
})

describe('PrReviewView (continued) — large-PR warning — progress bar does not exceed 100% when viewedFiles exceeds displayPr files in focus mode', () => {
  it('progress bar does not exceed 100% when viewedFiles exceeds displayPr files in focus mode', async () => {
    const bigFile = {
      ...makeLargeFile('src/low.ts', 500),
      riskScore: { ...mockFile.riskScore, level: 'low' as const },
    }
    // 3 viewed files but only 1 file in PR
    await renderView(
      { chapters: [{ ...mockChapter, files: [bigFile] }] },
      {
        currentFilePath: 'src/low.ts',
        viewedFiles: new Set(['src/low.ts', 'src/other.ts', 'src/another.ts']),
      }
    )
    // Only the one displayed file counts, however many viewed paths the store holds.
    const segments = screen.getByRole('progressbar', { name: 'Files viewed' })
    const [segment] = within(segments).getAllByTestId('progress-segment')
    expect(segment.style.getPropertyValue('--filled')).toBe('100%')
  })
})

const f = (path: string) => ({ ...mockFile, path })

const chapters = [
  { ...mockChapter, id: 'ch-1', name: 'One', files: [f('a.ts'), f('b.ts')] },
  { ...mockChapter, id: 'ch-2', name: 'Two', files: [f('c.ts'), f('d.ts')] },
  { ...mockChapter, id: 'ch-3', name: 'Three', files: [f('e.ts')] },
]

// user-event reads `{` and `[` as the start of a key name; doubling one types it.
describe('PrReviewView (continued) — chapter keyboard navigation', () => {
  it('} selects the next chapter and its first file', async () => {
    const { user } = await renderView(
      { chapters },
      { currentChapterId: 'ch-1', currentFilePath: 'b.ts' }
    )
    await user.keyboard('}')
    expect(position()).toEqual({ currentChapterId: 'ch-2', currentFilePath: 'c.ts' })
  })

  it('{ selects the previous chapter and its first file', async () => {
    const { user } = await renderView(
      { chapters },
      { currentChapterId: 'ch-3', currentFilePath: 'e.ts' }
    )
    await user.keyboard('{{')
    expect(position()).toEqual({ currentChapterId: 'ch-2', currentFilePath: 'c.ts' })
  })

  it.each([
    { key: '{{', name: '{ at the first chapter', chapterId: 'ch-1', path: 'a.ts' },
    { key: '}', name: '} at the last chapter', chapterId: 'ch-3', path: 'e.ts' },
  ])('$name leaves the position unchanged', async ({ key, chapterId, path }) => {
    const { user } = await renderView(
      { chapters },
      { currentChapterId: chapterId, currentFilePath: path }
    )
    await user.keyboard(key)
    expect(position()).toEqual({ currentChapterId: chapterId, currentFilePath: path })
  })
})

describe('PrReviewView (continued) — chapter keyboard navigation — } respects the file order override of the target chapter', () => {
  it('} respects the file order override of the target chapter', async () => {
    const { user } = await renderView(
      { chapters },
      {
        currentChapterId: 'ch-1',
        currentFilePath: 'a.ts',
        fileOrderOverrides: { 'ch-2': ['d.ts', 'c.ts'] },
      }
    )
    await user.keyboard('}')
    expect(position()).toEqual({ currentChapterId: 'ch-2', currentFilePath: 'd.ts' })
  })

  it('] crosses into the next chapter from the last file of a chapter (Files view)', async () => {
    const { user } = await renderView(
      { chapters },
      { currentChapterId: 'ch-1', currentFilePath: 'b.ts' }
    )
    await user.keyboard(']')
    expect(position()).toEqual({ currentChapterId: 'ch-2', currentFilePath: 'c.ts' })
  })

  it('] stays in the chapter and does not switch it mid-chapter', async () => {
    const { user } = await renderView(
      { chapters },
      { currentChapterId: 'ch-1', currentFilePath: 'a.ts' }
    )
    await user.keyboard(']')
    expect(position()).toEqual({ currentChapterId: 'ch-1', currentFilePath: 'b.ts' })
  })
})

describe('PrReviewView (continued) — chapter keyboard navigation — ] crosses chapters in the Chapters view too', () => {
  it('] crosses chapters in the Chapters view too', async () => {
    const { user } = await renderView(
      { chapters },
      { currentChapterId: 'ch-1', currentFilePath: 'b.ts' }
    )
    await user.click(screen.getByRole('radio', { name: 'Chapters' }))
    await user.keyboard(']')
    expect(position()).toEqual({ currentChapterId: 'ch-2', currentFilePath: 'c.ts' })
  })

  it('[ crosses back to the last file of the previous chapter', async () => {
    const { user } = await renderView(
      { chapters },
      { currentChapterId: 'ch-2', currentFilePath: 'c.ts' }
    )
    await user.keyboard('[[')
    expect(position()).toEqual({ currentChapterId: 'ch-1', currentFilePath: 'b.ts' })
  })

  it.each([
    { key: '[[', name: '[ at the first file of the PR', chapterId: 'ch-1', path: 'a.ts' },
    { key: ']', name: '] at the last file of the PR', chapterId: 'ch-3', path: 'e.ts' },
  ])('$name leaves the position unchanged', async ({ key, chapterId, path }) => {
    const { user } = await renderView(
      { chapters },
      { currentChapterId: chapterId, currentFilePath: path }
    )
    await user.keyboard(key)
    expect(position()).toEqual({ currentChapterId: chapterId, currentFilePath: path })
  })
})

describe('PrReviewView (continued) — chapter keyboard navigation — marking the last file of a chapter viewed advances into the next chapter', () => {
  it('marking the last file of a chapter viewed advances into the next chapter', async () => {
    const { user } = await renderView(
      { chapters },
      { currentChapterId: 'ch-1', currentFilePath: 'b.ts' }
    )
    await user.click(screen.getByRole('button', { name: 'MarkViewed' }))
    expect([...usePrReviewStore.getState().viewedFiles]).toEqual(['b.ts'])
    expect(position()).toEqual({ currentChapterId: 'ch-2', currentFilePath: 'c.ts' })
  })

  it('shows "Chapter 2 of 3" in the Chapters view only', async () => {
    const { user } = await renderView(
      { chapters },
      { currentChapterId: 'ch-2', currentFilePath: 'c.ts' }
    )
    expect(screen.queryByText('Chapter 2 of 3')).toBeNull()
    await user.click(screen.getByRole('radio', { name: 'Chapters' }))
    expect(screen.getByText('Chapter 2 of 3')).toBeTruthy()
  })
})
