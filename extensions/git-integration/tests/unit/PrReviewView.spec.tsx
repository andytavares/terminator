import React from 'react'
import { describe, it, beforeAll, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePrReviewStore, type PrReviewStore } from '../../src/stores/pr-review.store'
import { useReviewUiStore } from '../../src/stores/review-ui.store'
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
  ChapterNav: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chapter-nav">{children}</div>
  ),
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
    onPrevFile,
  }: {
    onMarkViewed: () => void
    onPrevFile: () => void
  }) => (
    <div data-testid="review-diff-pane">
      <button onClick={onMarkViewed}>MarkViewed</button>
      <button onClick={onPrevFile}>PrevFile</button>
    </div>
  ),
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
  whyHere: 'changed',
  churn90d: null,
}

const mockChapter = {
  id: 'ch-1',
  name: 'Chapter 1',
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
  chapters: [mockChapter],
})

const mockClose = vi.fn()
const mockRefresh = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.clearAllMocks()
  usePrReviewStore.getState().reset()
  localStorage.clear()
  useReviewUiStore.setState({ groupBy: 'all' })
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

  it('shows review progress once, in the header', async () => {
    await renderView({}, { currentFilePath: 'src/foo.ts' })
    expect(screen.getByText('0 of 1 viewed')).toBeTruthy()
    expect(screen.queryByText(/files reviewed/)).toBeNull()
  })

  it('shows exactly one Submit review control', async () => {
    await renderView({}, { currentFilePath: 'src/foo.ts' })
    expect(screen.getAllByRole('button', { name: /^Submit review/ })).toHaveLength(1)
  })
})

describe('PrReviewView — opens the inspector from Ask agent, and closes it', () => {
  it('opens the inspector from Ask agent, and closes it', async () => {
    const { user } = await renderView({}, { currentFilePath: 'src/foo.ts' })
    await user.click(screen.getByRole('button', { name: 'Ask agent about this PR' }))
    expect(screen.getByRole('heading', { name: 'Agent' })).toBeTruthy()
    expect(screen.getByTestId('agent-panel')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Close inspector' }))
    expect(screen.queryByTestId('agent-panel')).toBeNull()
  })

  it('has no View menu and always shows the file list', async () => {
    await renderView({}, { currentFilePath: 'src/foo.ts' })
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull()
    expect(screen.getByTestId('full-file-list')).toBeTruthy()
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
    await user.click(screen.getByRole('radio', { name: 'All files' }))
    expect(screen.getByTestId('full-file-list')).toBeTruthy()
  })
})

describe('PrReviewView — refresh', () => {
  it('calls onRefresh when Refresh button is clicked', async () => {
    const { user } = await renderView({}, { currentFilePath: 'src/foo.ts' })
    await user.click(screen.getByRole('button', { name: 'More review actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Refresh pull request' }))
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

describe('PrReviewView — progress counts only displayed files', () => {
  it('progress bar does not exceed 100% when viewedFiles holds paths outside the PR', async () => {
    const bigFile = makeLargeFile('src/low.ts', 500)
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

  it.each([
    { groupBy: 'all' as const, text: 'file 4 of 5' },
    { groupBy: 'chapters' as const, text: 'Two · file 2 of 2 · chapter 2 of 3' },
  ])(
    'says where the open file sits in the footer, grouped by $groupBy',
    async ({ groupBy, text }) => {
      useReviewUiStore.setState({ groupBy })
      await renderView({ chapters }, { currentChapterId: 'ch-2', currentFilePath: 'd.ts' })
      expect(screen.getByText(text)).toBeTruthy()
    }
  )
})

describe('PrReviewView — group by', () => {
  it('opens on the saved File list setting and saves a switch made in the sidebar', async () => {
    useReviewUiStore.setState({ groupBy: 'chapters' })
    const { user } = await renderView(
      { chapters },
      { currentChapterId: 'ch-1', currentFilePath: 'a.ts' }
    )
    expect(screen.getByRole('radio', { name: 'Chapters' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    expect(screen.getByTestId('chapter-nav')).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'All files' }))
    expect(useReviewUiStore.getState().groupBy).toBe('all')
    expect(screen.getByTestId('full-file-list')).toBeTruthy()
  })
})

describe('PrReviewView — footer Viewed checkbox', () => {
  it('marks the open file viewed and stays on it', async () => {
    const { user } = await renderView(
      { chapters },
      { currentChapterId: 'ch-1', currentFilePath: 'a.ts' }
    )
    await user.click(screen.getByRole('checkbox', { name: 'Viewed' }))
    expect([...usePrReviewStore.getState().viewedFiles]).toEqual(['a.ts'])
    expect(position()).toEqual({ currentChapterId: 'ch-1', currentFilePath: 'a.ts' })
  })
})

describe('PrReviewView — after a push', () => {
  it('says how many commits came since the reviewer last looked', async () => {
    const { PrReviewView } = await import('../../src/components/pr-review/PrReviewView')
    render(
      <PrReviewView
        repoRoot="/repo"
        pr={mockPr}
        onClose={mockClose}
        onRefresh={mockRefresh}
        sinceInfo={{ commitCount: 1, changedCount: 1, historyRewritten: false }}
      />
    )
    expect(screen.getByText('1 commit since you last looked')).toBeTruthy()
  })
})

describe('PrReviewView — only my files', () => {
  const twoFiles = [{ ...mockChapter, files: [f('src/mine.ts'), f('src/theirs.ts')] }]

  it('offers no Only my files toggle when the viewer owns no changed file', async () => {
    await renderView({ chapters: twoFiles, ownedPaths: [] }, { currentFilePath: 'src/mine.ts' })
    expect(screen.queryByRole('button', { name: 'Only my files' })).toBeNull()
  })

  it('shows only the owned files while the toggle is pressed', async () => {
    const { user } = await renderView(
      { chapters: twoFiles, ownedPaths: ['src/mine.ts'] },
      { currentFilePath: 'src/mine.ts' }
    )
    const total = () =>
      screen.getByRole('progressbar', { name: 'Files viewed' }).getAttribute('aria-valuemax')
    const toggle = screen.getByRole('button', { name: 'Only my files' })
    expect(total()).toBe('2')
    await user.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(total()).toBe('1')
  })
})
