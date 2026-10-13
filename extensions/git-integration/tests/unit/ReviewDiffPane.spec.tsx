import React from 'react'
import { describe, it, beforeAll, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
// Imported with the file rather than inside a test: the pane's module graph
// (highlight.js among it) takes about a second to load under vitest, and a
// test that imported it paid that against its own five-second timeout.
import { ReviewDiffPane } from '../../src/components/pr-review/ReviewDiffPane'
import { PrReviewDetailSchema, type PrChangedFile } from '../../src/schemas/pr-review.schema'

// The pane reads both stores through selectors; these resolve them against the state each test sets.
const { prStoreMock, uiStoreMock, highlightSpy, rowRenderSpy } = vi.hoisted(() => ({
  prStoreMock: vi.fn(),
  uiStoreMock: vi.fn(),
  highlightSpy: vi.fn(),
  rowRenderSpy: vi.fn(),
}))
vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: (sel?: (s: unknown) => unknown) => {
    const state = prStoreMock()
    return sel ? sel(state) : state
  },
}))
vi.mock('../../src/stores/review-ui.store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/stores/review-ui.store')>()
  return {
    ...actual,
    useReviewUiStore: (sel?: (s: unknown) => unknown) => {
      const state = uiStoreMock()
      return sel ? sel(state) : state
    },
  }
})
vi.mock('../../src/components/FileDiffView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/FileDiffView')>()
  highlightSpy.mockImplementation(actual.highlight)
  return { ...actual, highlight: highlightSpy }
})
// Counts renders inside each row's memo boundary, keeping the real component and its comparison.
vi.mock('../../src/components/pr-review/DiffLineRows', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/components/pr-review/DiffLineRows')>()
  const counted = <
    P extends { line: { newLineNumber: number | null; oldLineNumber: number | null } },
  >(
    row: React.NamedExoticComponent<P> & { type?: (props: P) => React.ReactNode }
  ) =>
    React.memo((props: P) => {
      rowRenderSpy(props.line.newLineNumber ?? props.line.oldLineNumber)
      return row.type!(props)
    })
  return {
    ...actual,
    UnifiedLineRow: counted(actual.UnifiedLineRow),
    SplitLineRow: counted(actual.SplitLineRow),
  }
})
vi.mock('../../src/components/pr-review/ViewMenu', () => ({
  ViewMenu: ({ sinceNote }: { sinceNote?: string | null }) => (
    <div data-testid="view-menu">{sinceNote}</div>
  ),
}))
vi.mock('../../src/components/pr-review/UsesPopover', () => ({
  UsesPopover: ({
    uses,
    onPeekDefinition,
  }: {
    uses: Array<{ symbol: string; definedInStep: number; read: boolean }>
    onPeekDefinition: () => void
  }) => (
    <div data-testid="uses">
      {uses.map((u) => (
        <span
          key={u.symbol}
        >{`${u.symbol} · step ${u.definedInStep} · ${u.read ? 'read' : 'not read'}`}</span>
      ))}
      <button onClick={onPeekDefinition}>Peek definition</button>
    </div>
  ),
}))
vi.mock('../../src/components/pr-review/InlineCommentThread', () => ({
  InlineCommentThread: () => <div data-testid="thread" />,
}))
vi.mock('../../src/components/pr-review/CommentComposer', () => ({
  CommentComposer: ({ onCancel }: { onCancel?: () => void }) => (
    <div data-testid="composer">
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}))
vi.mock('../../src/github/pr-review-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/github/pr-review-service')>()
  return {
    ...actual,
    detectComplexityHotspots: vi.fn().mockReturnValue([]),
    computeFileCyclomaticDelta: vi.fn().mockReturnValue(0),
  }
})

const mockPatchFileComplexity = vi.fn()
const mockAddNote = vi.fn()
const mockRemoveNote = vi.fn()
const mockAddDraft = vi.fn()
const mockUpdateDraft = vi.fn()
const mockRemoveDraft = vi.fn()
const mockSetCurrentChapter = vi.fn()
const mockSetCurrentFile = vi.fn()
const mockMarkFileViewed = vi.fn()
const mockUnmarkFileViewed = vi.fn()
const mockSetHideFormattingHunks = vi.fn()
const mockSetSelection = vi.fn()
const mockSetCommentVisibility = vi.fn()
const mockSetAgentNotesOn = vi.fn()
const mockRequestComposer = vi.fn()
const mockOpenAgentPanel = vi.fn()
const mockPrFileDiff = vi.fn()
const mockPrCompare = vi.fn()
const mockPrFileContent = vi.fn()
const mockInvoke = vi.fn()

function basePrReviewStoreState() {
  return {
    viewedFiles: new Set<string>(),
    threads: {},
    patchFileComplexity: mockPatchFileComplexity,
    changedSince: new Set<string>(),
    viewedAt: {},
    historyRewritten: false,
    notes: [],
    drafts: [],
    addNote: mockAddNote,
    removeNote: mockRemoveNote,
    addDraft: mockAddDraft,
    updateDraft: mockUpdateDraft,
    removeDraft: mockRemoveDraft,
    setCurrentChapter: mockSetCurrentChapter,
    setCurrentFile: mockSetCurrentFile,
    markFileViewed: mockMarkFileViewed,
    unmarkFileViewed: mockUnmarkFileViewed,
  }
}

function baseReviewUiStoreState() {
  return {
    commentVisibility: 'all' as const,
    setCommentVisibility: mockSetCommentVisibility,
    agentNotesOn: true,
    setAgentNotesOn: mockSetAgentNotesOn,
    diffViewMode: 'unified' as const,
    hideFormattingHunks: true,
    setHideFormattingHunks: mockSetHideFormattingHunks,
    diffRange: 'whole' as const,
    selection: null,
    setSelection: mockSetSelection,
    composerRequest: null,
    requestComposer: mockRequestComposer,
    agentRuns: [],
    openAgentPanel: mockOpenAgentPanel,
  }
}

const mockFile: PrChangedFile = {
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
  chapters: [
    {
      id: 'ch-1',
      name: 'Ch',
      estimatedMinutes: 5,
      status: 'not-started' as const,
      files: [mockFile],
    },
  ],
  readingOrder: [],
  movedBlocks: [],
  insights: null,
})

const defaultProps = {
  repoRoot: '/repo',
  pr: mockPr,
  file: mockFile,
  onMarkViewed: vi.fn(),
  onPrevFile: vi.fn(),
  onNextFile: vi.fn(),
  onShowRisk: vi.fn(),
}

// jsdom has no layout. The diff list is virtualised, so give the scroll container a
// height and every other element a row height; the default shows every test diff whole.
const ROW_PX = 20
const jsdomOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
const jsdomOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
function layOut(scrollerPx: number) {
  const isScroller = (el: HTMLElement) => el.classList.contains('review-diff-scroll')
  const getters: Record<string, (this: HTMLElement) => number> = {
    offsetHeight() {
      return isScroller(this) ? scrollerPx : ROW_PX
    },
    clientHeight() {
      return isScroller(this) ? scrollerPx : ROW_PX
    },
    // Taller than any test diff, so the scroller can reach every entry.
    scrollHeight() {
      return isScroller(this) ? 1_000_000 : ROW_PX
    },
    offsetWidth: () => 1000,
  }
  for (const [name, get] of Object.entries(getters)) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get })
  }
}
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', jsdomOffsetHeight)
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', jsdomOffsetWidth)
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
})

beforeEach(() => {
  vi.clearAllMocks()
  layOut(4000)
  mockPrFileDiff.mockResolvedValue({ diff: { hunks: [] } })
  mockPrCompare.mockResolvedValue({ rewritten: false, commits: [], files: [] })
  mockInvoke.mockImplementation((channel: string, payload: unknown) => {
    if (channel === 'github:pr-file-diff') return mockPrFileDiff(payload)
    if (channel === 'github:pr-compare') return mockPrCompare(payload)
    if (channel === 'github:pr-file-content') return mockPrFileContent(payload)
    return Promise.resolve({})
  })
  Object.assign(globalThis, {
    electronAPI: {
      extensionBridge: { invoke: mockInvoke },
    },
  })
  prStoreMock.mockReturnValue(basePrReviewStoreState())
  uiStoreMock.mockReturnValue(baseReviewUiStoreState())
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'electronAPI')
})

async function renderPane(props: Partial<typeof defaultProps> = {}) {
  return render(<ReviewDiffPane {...defaultProps} {...props} />)
}

const ctxLine = (n: number, content = `line ${n}`) => ({
  type: 'context' as const,
  content,
  oldLineNumber: n,
  newLineNumber: n,
})
const addLine = (n: number, content: string) => ({
  type: 'add' as const,
  content,
  oldLineNumber: null,
  newLineNumber: n,
})
const removeLine = (n: number, content: string) => ({
  type: 'remove' as const,
  content,
  oldLineNumber: n,
  newLineNumber: null,
})
type DiffLineFixture = ReturnType<typeof ctxLine | typeof addLine | typeof removeLine>

/** A diff of `path` with one hunk of `lines` under `header`. */
function oneHunk(header: string, lines: DiffLineFixture[], path = 'src/foo.ts') {
  return { path, isBinary: false, hunks: [{ header, lines }] }
}

/** The one-line diff 'const x = 1' under @@ -1,1 +1,1 @@. */
const oneLineDiff = () => oneHunk('@@ -1,1 +1,1 @@', [ctxLine(1, 'const x = 1')])

/** Serves `diff` for the open file, renders the pane with `props`, and waits for `header`. */
async function renderDiff(diff: unknown, header: string, props: Partial<typeof defaultProps> = {}) {
  mockPrFileDiff.mockResolvedValue({ diff })
  const view = await renderPane(props)
  await waitFor(() => expect(screen.getByText(header)).toBeTruthy())
  return view
}

/** Line 1 of src/foo.ts, right side, as the reviewer's selection. */
function selectLineOne() {
  uiStoreMock.mockReturnValue({
    ...baseReviewUiStoreState(),
    selection: { path: 'src/foo.ts', side: 'RIGHT' as const, startLine: 1, endLine: 1 },
  })
}

/** Puts the real UI store, with nothing selected, behind the pane's selector. */
async function useRealUiStore() {
  const actual = await vi.importActual<typeof import('../../src/stores/review-ui.store')>(
    '../../src/stores/review-ui.store'
  )
  actual.useReviewUiStore.setState({ selection: null })
  uiStoreMock.mockImplementation(actual.useReviewUiStore)
  return actual.useReviewUiStore
}

/** A review comment `id` in thread `threadId` on line 1 of src/foo.ts. */
function commentOnLineOne(id: number, threadId: string, body: string) {
  return {
    id,
    author: 'alice',
    authorAvatarUrl: '',
    body,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    path: 'src/foo.ts',
    line: 1,
    startLine: null,
    side: 'RIGHT' as const,
    diffHunk: '',
    outdated: false,
    threadId,
    isReply: false,
    parentId: null,
  }
}

/** An open thread `id` on line 1 of src/foo.ts holding one comment. */
function threadOnLineOne(id: string, resolved = false) {
  return {
    id,
    path: 'src/foo.ts',
    line: 1,
    startLine: null,
    side: 'RIGHT' as const,
    outdated: false,
    collapsed: false,
    resolved,
    comments: [commentOnLineOne(1, id, 'LGTM')],
  }
}

/** The PR's threads on src/foo.ts, in the store. */
function storeThreads(threads: unknown[]) {
  prStoreMock.mockReturnValue({ ...basePrReviewStoreState(), threads: { 'src/foo.ts': threads } })
}

/** A finished agent review of src/foo.ts lines `range` with one finding at `finding`. */
function doneAgentRun(range: [number, number], finding: Record<string, unknown>) {
  const [startLine, endLine] = range
  return {
    ...agentRunBase,
    scope: {
      kind: 'lines' as const,
      path: 'src/foo.ts',
      startLine,
      endLine,
      side: 'RIGHT' as const,
      chapter: null,
    },
    findings: [{ ...findingBase, ...finding }],
  }
}

const agentRunBase = {
  id: 'run-1',
  repoRoot: '/repo',
  prNumber: 1,
  headSHA: 'abc',
  sessionId: 's1',
  request: 'review' as const,
  question: null,
  status: 'done' as const,
  startedAt: '',
  finishedAt: '',
  activity: [],
  summary: null,
  walkthrough: [],
  error: null,
}

const findingBase = {
  id: 'f1',
  severity: 'suggestion' as const,
  path: 'src/foo.ts',
  side: 'RIGHT' as const,
  title: 'x',
  body: '',
  suggestedCode: null,
  dismissed: false,
}

/** A PR whose UnionFind moved from github/pr-review-service.ts:360 to `toPath`:`toLine`. */
function prWithMove(toPath: string, toLine: number) {
  const movedBlocks = [
    {
      fromPath: 'github/pr-review-service.ts',
      fromLine: 360,
      toPath,
      toLine,
      lineCount: 28,
      symbol: 'UnionFind',
    },
  ]
  return { ...mockPr, movedBlocks }
}

/** Matches an element whose whole text is `text`. */
const wholeText = (text: string) => (_: string, node: Element | null) => node?.textContent === text

/** PR insights: `functions` changed, `untested` of them without tests. */
function insightsFor(
  functions: Array<{ name: string; line: number; branchDelta: number }>,
  untested: string[]
) {
  return {
    complexity: {
      branchDelta: Math.max(...functions.map((f) => f.branchDelta)),
      functions: functions.map((f) => ({ path: 'src/foo.ts', ...f })),
      source: 'tree-sitter',
    },
    coverage: {
      changedFunctions: functions.length,
      testedFunctions: functions.length - untested.length,
      untestedFunctions: untested,
      patchPercent: null,
      source: 'test files',
      changedSourceFiles: 1,
      changedSourceFilesWithTests: untested.length === 0 ? 1 : 0,
    },
    health: { flags: [], source: 'tree-sitter' },
    understandability: {
      level: 'moderate' as const,
      linesToRead: 10,
      newExports: 1,
      longestChain: 1,
      crossChapterRefs: 0,
      source: 'reading-order',
    },
  }
}

/** A PR whose step 4, src/foo.ts, uses computeRiskScore from src/other.ts in a second chapter. */
function prWithReadingOrder() {
  const readingOrder = [
    {
      step: 4,
      path: 'src/foo.ts',
      symbol: 'fetchFileMetrics',
      reason: 'Uses computeRiskScore (step 2)',
      uses: [{ symbol: 'computeRiskScore', definedInStep: 2, definedInPath: 'src/other.ts' }],
    },
  ]
  const second = {
    ...mockPr.chapters[0],
    id: 'ch-2',
    name: 'Ch2',
    files: [{ ...mockFile, path: 'src/other.ts' }],
  }
  return { ...mockPr, readingOrder, chapters: [mockPr.chapters[0], second] }
}

/** A one-row viewport, so the list can scroll to any entry. */
function useOneRowViewport() {
  beforeEach(() => {
    layOut(ROW_PX)
    HTMLElement.prototype.scrollTo = vi.fn()
  })
}

// The first import compiles the component tree, which on a loaded machine takes longer
// than one test's 5 s; load it once here so every test times only its own work.
beforeAll(async () => {
  await import('../../src/components/pr-review/ReviewDiffPane')
}, 60_000)

describe('ReviewDiffPane', () => {
  it('renders file path in header', async () => {
    await renderPane()
    expect(screen.getByTitle('src/foo.ts').textContent).toBe('src/foo.ts')
  })

  it('leaves the additions and deletions to the file list', async () => {
    await renderPane()
    expect(screen.queryByText('+5/−2')).toBeNull()
  })

  it('shows low-risk label for low risk file', async () => {
    await renderPane()
    expect(screen.getByText(/Low risk/)).toBeTruthy()
  })

  it('shows high-risk label for high risk file', async () => {
    const highFile = { ...mockFile, riskScore: { ...mockFile.riskScore, level: 'high' as const } }
    await renderPane({ file: highFile })
    expect(screen.getByText(/High risk/)).toBeTruthy()
  })

  it('shows binary message for binary files', async () => {
    const binaryFile = { ...mockFile, isBinary: true }
    await renderPane({ file: binaryFile })
    expect(screen.getByText('Binary file — diff not available.')).toBeTruthy()
  })
})

describe('ReviewDiffPane — shows loading diff message while fetching', () => {
  it('shows loading diff message while fetching', async () => {
    mockPrFileDiff.mockImplementation(() => new Promise(() => {}))
    await renderPane()
    expect(screen.getByText('Loading diff…')).toBeTruthy()
  })

  it('shows error when diff fetch fails', async () => {
    mockPrFileDiff.mockResolvedValue({ error: 'RATE_LIMITED' })
    await renderPane()
    await waitFor(() => expect(screen.getByText(/Failed to load diff/)).toBeTruthy())
  })
})

describe('ReviewDiffPane — shows viewed badge when file is already viewed', () => {
  it('shows viewed badge when file is already viewed', async () => {
    prStoreMock.mockReturnValue({
      ...basePrReviewStoreState(),
      viewedFiles: new Set(['src/foo.ts']),
    })
    await renderPane()
    const box = screen.getByRole('checkbox', { name: 'Viewed' }) as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect(mockUnmarkFileViewed).toHaveBeenCalledWith(
      { repoRoot: '/repo', prNumber: mockPr.number, headSHA: mockPr.headSHA },
      'src/foo.ts'
    )
  })
})

describe('ReviewDiffPane — marks the file viewed from the header checkbox without leaving it', () => {
  it('marks the file viewed from the header checkbox without leaving it', async () => {
    const onMarkViewed = vi.fn()
    await renderPane({ onMarkViewed })
    const box = screen.getByRole('checkbox', { name: 'Viewed' }) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(mockMarkFileViewed).toHaveBeenCalledWith(
      { repoRoot: '/repo', prNumber: mockPr.number, headSHA: mockPr.headSHA },
      'src/foo.ts'
    )
    expect(onMarkViewed).not.toHaveBeenCalled()
  })

  it('calls onShowRisk when the Why? button is clicked', async () => {
    const onShowRisk = vi.fn()
    await renderPane({ onShowRisk })
    fireEvent.click(screen.getByRole('button', { name: 'Low risk' }))
    expect(onShowRisk).toHaveBeenCalled()
  })
})

describe('ReviewDiffPane — renders diff hunks when diff is loaded', () => {
  it('renders diff hunks when diff is loaded', async () => {
    const diff = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -1,3 +1,3 @@',
          lines: [{ type: 'context', content: 'const x = 1', oldLineNumber: 1, newLineNumber: 1 }],
        },
      ],
    }
    mockPrFileDiff.mockResolvedValue({ diff })
    await renderPane()
    await waitFor(() => expect(screen.getByText('@@ -1,3 +1,3 @@')).toBeTruthy())
  })

  it('does not repeat the change type in the file toolbar', async () => {
    const addedFile = { ...mockFile, changeType: 'added' as const }
    await renderPane({ file: addedFile })
    expect(screen.queryByText('added')).toBeNull()
  })
})

describe('ReviewDiffPane — calls patchFileComplexity after diff load', () => {
  it('calls patchFileComplexity after diff load', async () => {
    const diff = { hunks: [] }
    mockPrFileDiff.mockResolvedValue({ diff })
    await renderPane()
    await waitFor(() => expect(mockPrFileDiff).toHaveBeenCalled())
  })
})

describe('ReviewDiffPane — switches to split view mode when Split button is clicked', () => {
  it('switches to split view mode when Split button is clicked', async () => {
    const diff = oneHunk('@@ -1,3 +1,3 @@', [ctxLine(1, 'x'), addLine(2, 'y'), removeLine(2, 'z')])
    uiStoreMock.mockReturnValue({ ...baseReviewUiStoreState(), diffViewMode: 'split' })
    const { container } = await renderDiff(diff, '@@ -1,3 +1,3 @@')

    await waitFor(() => expect(container.querySelector('.diff-table--split')).toBeTruthy())
  })
})

describe('ReviewDiffPane — gutter drag no longer opens the composer, but calls setSelection', () => {
  it('gutter drag no longer opens the composer, but calls setSelection', async () => {
    await renderDiff(oneLineDiff(), '@@ -1,1 +1,1 @@')

    const btn = screen.getAllByRole('button', { name: 'Add comment' })[0]
    fireEvent.mouseDown(btn)
    fireEvent.mouseUp(btn)

    expect(mockSetSelection).toHaveBeenCalledWith({
      path: 'src/foo.ts',
      side: 'RIGHT',
      startLine: 1,
      endLine: 1,
    })
    expect(screen.queryByTestId('composer')).toBeNull()
  })
})

describe('ReviewDiffPane — a gutter drag across rows keeps the multi-line selection after the trailing click', () => {
  it('a gutter drag across rows keeps the multi-line selection after the trailing click', async () => {
    const uiStore = await useRealUiStore()
    const diff = oneHunk(
      '@@ -1,3 +1,3 @@',
      [1, 2, 3].map((n) => ctxLine(n))
    )
    const { container } = await renderDiff(diff, '@@ -1,3 +1,3 @@')

    const rows = container.querySelectorAll<HTMLTableRowElement>('tr.diff-line')
    fireEvent.mouseDown(rows[0].querySelector('.diff-gutter-btn')!)
    fireEvent.mouseEnter(rows[1])
    fireEvent.mouseEnter(rows[2])
    fireEvent.mouseUp(rows[2].querySelector('.diff-line__content')!)
    // A press and release on different elements clicks their common ancestor.
    fireEvent.click(rows[0].parentElement!)

    await waitFor(() => expect(container.querySelectorAll('tr.rs-line--selected')).toHaveLength(3))
    expect(screen.getByText('Comment')).toBeTruthy()
    expect(uiStore.getState().selection).toEqual({
      path: 'src/foo.ts',
      side: 'RIGHT',
      startLine: 1,
      endLine: 3,
    })
  })
})

describe('ReviewDiffPane — a background click after the drag has settled still clears the selection', () => {
  it('a background click after the drag has settled still clears the selection', async () => {
    const uiStore = await useRealUiStore()
    const diff = oneHunk(
      '@@ -1,2 +1,2 @@',
      [1, 2].map((n) => ctxLine(n))
    )
    const { container } = await renderDiff(diff, '@@ -1,2 +1,2 @@')

    const rows = container.querySelectorAll<HTMLTableRowElement>('tr.diff-line')
    fireEvent.mouseDown(rows[0].querySelector('.diff-gutter-btn')!)
    fireEvent.mouseEnter(rows[1])
    fireEvent.mouseUp(rows[1])
    await waitFor(() => expect(container.querySelectorAll('tr.rs-line--selected')).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 0))

    fireEvent.click(rows[0].querySelector('.diff-line__content')!)

    await waitFor(() => expect(container.querySelectorAll('tr.rs-line--selected')).toHaveLength(0))
    expect(uiStore.getState().selection).toBeNull()
  })
})

describe('ReviewDiffPane — shows the float bar under a selection, with Comment opening the composer', () => {
  it('shows the float bar under a selection, with Comment opening the composer', async () => {
    selectLineOne()
    await renderDiff(oneLineDiff(), '@@ -1,1 +1,1 @@')

    expect(screen.queryByTestId('composer')).toBeNull()
    fireEvent.click(screen.getByText('Comment'))
    await waitFor(() => expect(screen.getByTestId('composer')).toBeTruthy())

    fireEvent.click(screen.getByText('Cancel'))
    await waitFor(() => expect(screen.queryByTestId('composer')).toBeNull())
  })
})

describe('ReviewDiffPane — calls openAgentPanel with the lines scope when Ask agent is clicked', () => {
  it('calls openAgentPanel with the lines scope when Ask agent is clicked', async () => {
    selectLineOne()
    await renderDiff(oneLineDiff(), '@@ -1,1 +1,1 @@')

    fireEvent.click(screen.getByText(/Ask agent/))
    expect(mockOpenAgentPanel).toHaveBeenCalledWith(
      {
        kind: 'lines',
        path: 'src/foo.ts',
        startLine: 1,
        endLine: 1,
        side: 'RIGHT',
        chapter: null,
      },
      'review'
    )
  })
})

describe('ReviewDiffPane — renders inline comment threads on matching lines', () => {
  it('renders inline comment threads on matching lines', async () => {
    storeThreads([threadOnLineOne('thread-1')])
    mockPrFileDiff.mockResolvedValue({ diff: oneLineDiff() })
    await renderPane()
    await waitFor(() => expect(screen.getByTestId('thread')).toBeTruthy())
  })
})

describe('ReviewDiffPane — fires keyboard navigation events for prev-file and mark-viewed-next', () => {
  it('fires keyboard navigation events for prev-file and mark-viewed-next', async () => {
    const onPrevFile = vi.fn()
    const onMarkViewed = vi.fn()
    await renderPane({ onPrevFile, onMarkViewed })

    window.dispatchEvent(new CustomEvent('pr-review:prev-file'))
    window.dispatchEvent(new CustomEvent('pr-review:mark-viewed-next'))

    expect(onPrevFile).toHaveBeenCalled()
    expect(onMarkViewed).toHaveBeenCalled()
  })

  it('shows medium-risk label for medium risk file', async () => {
    const medFile = { ...mockFile, riskScore: { ...mockFile.riskScore, level: 'medium' as const } }
    await renderPane({ file: medFile })
    expect(screen.getByText(/Medium risk/)).toBeTruthy()
  })
})

describe('ReviewDiffPane — comment visibility (R2)', () => {
  const openThread = threadOnLineOne('thread-open')
  const resolvedThread = threadOnLineOne('thread-resolved', true)

  /** Shows the one-line diff with `threads`, comments set to `visibility`. */
  async function renderThreads(threads: unknown[], visibility: string) {
    storeThreads(threads)
    uiStoreMock.mockReturnValue({ ...baseReviewUiStoreState(), commentVisibility: visibility })
    await renderDiff(oneLineDiff(), '@@ -1,1 +1,1 @@')
  }

  it('Hidden removes thread rendering and shows a gutter pip with the count', async () => {
    await renderThreads([openThread, resolvedThread], 'hidden')

    expect(screen.queryByTestId('thread')).toBeNull()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('clicking a hidden pip sets visibility back to all', async () => {
    await renderThreads([openThread], 'hidden')

    fireEvent.click(screen.getByRole('button', { name: '1 hidden comments' }))
    expect(mockSetCommentVisibility).toHaveBeenCalledWith('all')
  })

  it('Unresolved hides a resolved thread but keeps an open one', async () => {
    await renderThreads([openThread, resolvedThread], 'unresolved')

    expect(screen.getAllByTestId('thread')).toHaveLength(1)
  })

  it('All shows every thread, including resolved ones', async () => {
    await renderThreads([openThread, resolvedThread], 'all')

    expect(screen.getAllByTestId('thread')).toHaveLength(2)
  })
})

describe('ReviewDiffPane — agent notes (R5)', () => {
  const singleLineDiff = oneHunk('@@ fetchFileMetrics @@', [ctxLine(317, 'x')])
  const agentRun = doneAgentRun([309, 317], {
    startLine: 317,
    endLine: 317,
    title: 'Risk scored twice per file',
    body: 'usePrReview.ts:317 calls computeRiskScore again.',
  })

  /** Shows the one-line diff with the agent's run, agent notes on unless `agentNotesOn`. */
  async function renderWithRun(agentNotesOn = true) {
    uiStoreMock.mockReturnValue({
      ...baseReviewUiStoreState(),
      agentRuns: [agentRun],
      agentNotesOn,
    })
    mockPrFileDiff.mockResolvedValue({ diff: singleLineDiff })
    await renderPane()
  }

  it('renders the agent note text after the finding line when agent notes are on', async () => {
    await renderWithRun()
    await waitFor(() => expect(screen.getByText(/calls computeRiskScore again/)).toBeTruthy())
    expect(screen.getByText(/Agent note ·/)).toBeTruthy()
  })

  it('shows an agent pip instead of the note when agent notes are off', async () => {
    await renderWithRun(false)
    await waitFor(() => expect(screen.getByText('@@ fetchFileMetrics @@')).toBeTruthy())
    expect(screen.queryByText(/Agent note ·/)).toBeNull()
    expect(screen.getByText('1')).toBeTruthy()
  })
})

describe('ReviewDiffPane — moved code (S4)', () => {
  it('collapses a moved-here block into one row', async () => {
    const path = 'review/reading-order.ts'
    const diff = oneHunk('@@ -0,0 +1,3 @@', [addLine(41, 'a'), addLine(42, 'b')], path)
    mockPrFileDiff.mockResolvedValue({ diff })
    await renderPane({ file: { ...mockFile, path }, pr: prWithMove(path, 41) })
    const row = 'UnionFind · 28 lines, unchanged, from github/pr-review-service.ts:360'
    await waitFor(() => expect(screen.getByText(wholeText(row))).toBeTruthy())
    expect(screen.getByText('Moved')).toBeTruthy()
  })
})

describe('ReviewDiffPane — moved code (S4) — collapses a moved-away (removed) block into one row', () => {
  it('collapses a moved-away (removed) block into one row', async () => {
    const path = 'github/pr-review-service.ts'
    const diff = oneHunk('@@ -360,2 +360,0 @@', [removeLine(360, 'a'), removeLine(361, 'b')], path)
    mockPrFileDiff.mockResolvedValue({ diff })
    await renderPane({ file: { ...mockFile, path }, pr: prWithMove('review/reading-order.ts', 41) })
    const row = 'UnionFind · 28 lines, unchanged, moved to review/reading-order.ts:41'
    await waitFor(() => expect(screen.getByText(wholeText(row))).toBeTruthy())
    expect(screen.getByText('Moved')).toBeTruthy()
  })
})

const splitDiff = oneHunk('@@ -85,3 +88,3 @@', [addLine(88, 'a'), addLine(89, 'b')])

async function renderSplit(overrides: Partial<typeof defaultProps> = {}) {
  mockPrFileDiff.mockResolvedValue({ diff: splitDiff })
  const state = uiStoreMock.getMockImplementation()?.() ?? baseReviewUiStoreState()
  uiStoreMock.mockReturnValue({
    ...(state as object),
    diffViewMode: 'split',
  })
  const view = await renderPane(overrides)
  await waitFor(() => expect(screen.getByText('@@ -85,3 +88,3 @@')).toBeTruthy())
  await waitFor(() => expect(document.querySelector('.diff-table--split')).toBeTruthy())
  return view
}

describe('ReviewDiffPane — split view parity', () => {
  it('renders the agent note text and pip in the split view', async () => {
    const agentRun = doneAgentRun([88, 89], {
      severity: 'nit' as const,
      startLine: 89,
      endLine: 89,
      body: 'split-view agent note body',
    })
    uiStoreMock.mockReturnValue({
      ...baseReviewUiStoreState(),
      agentRuns: [agentRun],
    })
    const first = await renderSplit()
    expect(screen.getByText(/split-view agent note body/)).toBeTruthy()
    first.unmount()

    uiStoreMock.mockReturnValue({
      ...baseReviewUiStoreState(),
      agentRuns: [agentRun],
      agentNotesOn: false,
    })
    await renderSplit()
    expect(screen.queryByText(/split-view agent note body/)).toBeNull()
    expect(screen.getByText('1')).toBeTruthy()
  })
})

describe('ReviewDiffPane — split view parity — collapses moved blocks (both directions) in the split view', () => {
  it('collapses moved blocks (both directions) in the split view', async () => {
    await renderSplit({ pr: prWithMove('src/foo.ts', 88) })
    expect(screen.getByText('Moved')).toBeTruthy()
    const row = 'UnionFind · 28 lines, unchanged, from github/pr-review-service.ts:360'
    expect(screen.getByText(wholeText(row))).toBeTruthy()
  })
})

describe('ReviewDiffPane — split view parity — shows the R4 gutter insight chips in the split view', () => {
  it('shows the R4 gutter insight chips in the split view', async () => {
    const insights = insightsFor([{ name: 'shardByDuration', line: 88, branchDelta: 6 }], [])
    await renderSplit({ pr: { ...mockPr, insights } })
    expect(screen.getByText('+6')).toBeTruthy()
  })
})

describe('ReviewDiffPane — private notes side (S2)', () => {
  it('renders a LEFT-side note under the removed line', async () => {
    mockPrFileDiff.mockResolvedValue({ diff: oneHunk('@@ -5,1 +5,0 @@', [removeLine(5, 'x')]) })
    prStoreMock.mockReturnValue({
      ...basePrReviewStoreState(),
      notes: [
        {
          id: 'n1',
          path: 'src/foo.ts',
          line: 5,
          side: 'LEFT' as const,
          body: 'left side note',
          createdAt: '',
        },
      ],
    })
    await renderPane()
    await waitFor(() => expect(screen.getByText('left side note')).toBeTruthy())
  })
})

describe('ReviewDiffPane — pending drafts (S5)', () => {
  it('shows a draft under its line, marked pending, with its markdown rendered', async () => {
    const diff = oneHunk('@@ -61,1 +61,1 @@', [addLine(62, 'fetch(filter)')])
    mockPrFileDiff.mockResolvedValue({ diff })
    prStoreMock.mockReturnValue({
      ...basePrReviewStoreState(),
      drafts: [
        {
          id: 'd1',
          path: 'src/foo.ts',
          line: 62,
          startLine: null,
          side: 'RIGHT' as const,
          body: '`fetch(filter)` reloads the same page.',
          fromFindingId: null,
        },
      ],
    })
    const { container } = await renderPane()
    await waitFor(() => expect(screen.getByText(/sent when you submit your review/)).toBeTruthy())
    const code = container.querySelector('.rs-thread-bd code')
    expect(code?.textContent).toBe('fetch(filter)')
  })
})

/** Answers tests-for-block with `locations` of symbol foo, and the open file's diff as usual. */
function answerTestsForBlock(locations: unknown[]) {
  mockInvoke.mockImplementation((channel: string, payload: unknown) => {
    if (channel === 'github:pr-file-diff') return mockPrFileDiff(payload)
    if (channel === 'github:tests-for-block')
      return Promise.resolve({ symbols: ['foo'], locations })
    return Promise.resolve({})
  })
}

/** Renders the pane on the block diff and asks for the tests of its block. */
async function jumpToTests() {
  mockPrFileDiff.mockResolvedValue({ diff: blockDiff })
  await renderPane()
  fireEvent.click(await screen.findByRole('button', { name: 'Jump to the tests for this block' }))
}

/** A block of foo() whose old() became next(). */
const blockDiff = oneHunk('@@ -1,2 +1,2 @@ export function foo(', [
  removeLine(1, 'old()'),
  addLine(1, 'next()'),
  ctxLine(2, 'done()'),
])

describe('ReviewDiffPane — jump to the tests for a block', () => {
  useOneRowViewport()

  it('searches the tests with the hunk as it reads after the change', async () => {
    answerTestsForBlock([])
    await jumpToTests()
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('github:tests-for-block', {
        repoRoot: '/repo',
        headSHA: mockPr.headSHA,
        path: 'src/foo.ts',
        code: 'next()\ndone()',
        hunkHeader: '@@ -1,2 +1,2 @@ export function foo(',
      })
    )
    expect(await screen.findByText('No test mentions foo.')).toBeTruthy()
  })
})

describe('ReviewDiffPane — jump to the tests for a block — opening one', () => {
  useOneRowViewport()

  it('opens a test in the PR at its line', async () => {
    answerTestsForBlock([{ path: 'src/foo.ts', line: 2, symbol: 'foo', text: 'done()' }])
    await jumpToTests()
    fireEvent.click(await screen.findByRole('button', { name: /src\/foo\.ts:2/ }))
    expect(mockSetCurrentFile).toHaveBeenCalledWith('src/foo.ts')
    const entry = document
      .querySelector('[data-new-line="2"]')!
      .closest<HTMLElement>('[data-index]')!
    const scroller = document.querySelector<HTMLElement>('.review-diff-scroll')!
    await waitFor(() =>
      expect(scroller.scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ top: Number(entry.dataset.index) * ROW_PX })
      )
    )
  })
})

/** Hunks at lines 1 and 10 of src/foo.ts. */
const keyTwoHunkDiff = {
  path: 'src/foo.ts',
  isBinary: false,
  hunks: [
    { header: '@@ -1,1 +1,1 @@', lines: [ctxLine(1, 'a')] },
    { header: '@@ -10,1 +10,1 @@', lines: [ctxLine(10, 'b')] },
  ],
}

/** Renders the two-hunk diff and waits for its first hunk. */
const renderTwoHunks = (props: Partial<typeof defaultProps> = {}) =>
  renderDiff(keyTwoHunkDiff, '@@ -1,1 +1,1 @@', props)

/** The scroll position of the entry holding `header`. */
const topOfHunk = (header: string) =>
  Number(screen.getByText(header).closest<HTMLElement>('[data-index]')!.dataset.index) * ROW_PX

/** The hunk at line 1, the scope the agent keys act on without a selection. */
const firstHunkScope = {
  kind: 'hunk',
  path: 'src/foo.ts',
  startLine: 1,
  endLine: 1,
  side: 'RIGHT',
  chapter: null,
}

describe('ReviewDiffPane — keyboard events (REVIEW_KEY_EVENTS)', () => {
  useOneRowViewport()

  it('nextHunk scrolls the next hunk header into view', async () => {
    await renderTwoHunks()
    const scroller = document.querySelector<HTMLElement>('.review-diff-scroll')!
    window.dispatchEvent(new CustomEvent('review:next-hunk'))
    expect(topOfHunk('@@ -10,1 +10,1 @@')).toBeGreaterThan(0)
    expect(scroller.scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: topOfHunk('@@ -10,1 +10,1 @@') })
    )
  })

  it('prevHunk scrolls the previous hunk header into view', async () => {
    await renderTwoHunks()
    const scroller = document.querySelector<HTMLElement>('.review-diff-scroll')!
    window.dispatchEvent(new CustomEvent('review:next-hunk')) // move to hunk 1 first
    expect(scroller.scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: topOfHunk('@@ -10,1 +10,1 @@') })
    )
    window.dispatchEvent(new CustomEvent('review:prev-hunk'))
    expect(scroller.scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: topOfHunk('@@ -1,1 +1,1 @@') })
    )
  })
})

describe('ReviewDiffPane — keyboard events (REVIEW_KEY_EVENTS) — agent keys', () => {
  useOneRowViewport()

  it('askAgent with no selection opens the agent panel scoped to the nearest hunk', async () => {
    await renderTwoHunks()
    window.dispatchEvent(new CustomEvent('review:ask-agent'))
    expect(mockOpenAgentPanel).toHaveBeenCalledWith(firstHunkScope, 'review')
  })

  it('explain requests explain with autoStart', async () => {
    await renderTwoHunks()
    window.dispatchEvent(new CustomEvent('review:explain'))
    expect(mockOpenAgentPanel).toHaveBeenCalledWith(firstHunkScope, 'explain', true)
  })
})

describe('ReviewDiffPane — keyboard events (REVIEW_KEY_EVENTS) — composer keys', () => {
  useOneRowViewport()

  it('comment opens the composer on the selection', async () => {
    selectLineOne()
    await renderTwoHunks()
    expect(screen.queryByTestId('composer')).toBeNull()
    window.dispatchEvent(new CustomEvent('review:comment'))
    await waitFor(() => expect(screen.getByTestId('composer')).toBeTruthy())
  })

  it('note opens the note composer on the selection', async () => {
    selectLineOne()
    await renderTwoHunks()
    window.dispatchEvent(new CustomEvent('review:note'))
    await waitFor(() => expect(screen.getByPlaceholderText('Private note…')).toBeTruthy())
  })
})

describe('ReviewDiffPane — keyboard events (REVIEW_KEY_EVENTS) — leaving the file', () => {
  useOneRowViewport()

  it('nextHunk at the last hunk calls onNextFile', async () => {
    const onNextFile = vi.fn()
    await renderDiff(oneHunk('@@ -1,1 +1,1 @@', [ctxLine(1, 'a')]), '@@ -1,1 +1,1 @@', {
      onNextFile,
    })
    window.dispatchEvent(new CustomEvent('review:next-hunk'))
    expect(onNextFile).toHaveBeenCalled()
  })

  it('peekDefinition selects the definition file', async () => {
    await renderTwoHunks({ pr: prWithReadingOrder() })
    window.dispatchEvent(new CustomEvent('review:peek-definition'))
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('ch-2')
    expect(mockSetCurrentFile).toHaveBeenCalledWith('src/other.ts')
  })
})

describe('ReviewDiffPane — reading order (R3)', () => {
  it('shows "Step N of M" and a use chip for a defined-and-read symbol', async () => {
    const prWithOrder = {
      ...mockPr,
      readingOrder: [
        {
          step: 4,
          path: 'src/foo.ts',
          symbol: 'fetchFileMetrics',
          reason: 'Uses computeRiskScore (step 2)',
          uses: [{ symbol: 'computeRiskScore', definedInStep: 2, definedInPath: 'src/other.ts' }],
        },
      ],
    }
    prStoreMock.mockReturnValue({
      ...basePrReviewStoreState(),
      viewedFiles: new Set(['src/other.ts']),
    })
    await renderPane({ pr: prWithOrder })
    expect(screen.queryByText('Step 4 of 1')).toBeNull()
    expect(screen.getByText('computeRiskScore · step 2 · read')).toBeTruthy()
  })
})

describe('ReviewDiffPane — reading order (R3) — calls setCurrentChapter/setCurrentFile when Peek definition is clicked', () => {
  it('calls setCurrentChapter/setCurrentFile when Peek definition is clicked', async () => {
    await renderPane({ pr: prWithReadingOrder() })
    fireEvent.click(screen.getByText('Peek definition'))
    expect(mockSetCurrentChapter).toHaveBeenCalledWith('ch-2')
    expect(mockSetCurrentFile).toHaveBeenCalledWith('src/other.ts')
  })
})

describe('ReviewDiffPane — since-my-review diff (S1)', () => {
  it('calls prCompare with the viewed sha when the file changed since the review', async () => {
    prStoreMock.mockReturnValue({
      ...basePrReviewStoreState(),
      changedSince: new Set(['src/foo.ts']),
      viewedAt: { 'src/foo.ts': '9f0c76eb0000000000000000000000000000000' },
    })
    uiStoreMock.mockReturnValue({
      ...baseReviewUiStoreState(),
      diffRange: 'since',
    })
    mockPrCompare.mockResolvedValue({
      rewritten: false,
      commits: [],
      files: [{ path: 'src/foo.ts', status: 'modified', patch: '@@ -1,1 +1,1 @@\n-a\n+b' }],
    })
    await renderPane()
    await waitFor(() =>
      expect(mockPrCompare).toHaveBeenCalledWith({
        repoRoot: '/repo',
        fromSha: '9f0c76eb0000000000000000000000000000000',
        toSha: 'abc',
      })
    )
    await waitFor(() => expect(screen.getByText(/Showing 9f0c76eb/)).toBeTruthy())
    expect(mockPrFileDiff).not.toHaveBeenCalled()
  })
})

describe('ReviewDiffPane — insight gutter chips (R4)', () => {
  it('shows a warning "+N" chip and a danger "untested" chip', async () => {
    const functions = [
      { name: 'shardByDuration', line: 88, branchDelta: 6 },
      { name: 'readBurnIn', line: 89, branchDelta: 3 },
    ]
    const insights = insightsFor(functions, ['readBurnIn'])
    await renderDiff(splitDiff, '@@ -85,3 +88,3 @@', { pr: { ...mockPr, insights } })
    expect(screen.getByText('+6')).toBeTruthy()
    expect(screen.getByText('untested')).toBeTruthy()
    // The gutter column is sized to its widest chip ("untested"), so it never overlaps code.
    const gut = screen.getByText('untested').closest('td') as HTMLElement
    expect(gut.className).toBe('rs-gut')
    expect(gut.style.width).toBe('78px')
  })
})

const FILE_LINES = 100
const fileText = Array.from({ length: FILE_LINES }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
const ctx = (n: number) => ({
  type: 'context' as const,
  content: `line ${n}`,
  oldLineNumber: n,
  newLineNumber: n,
})
const hunk = (start: number) => ({
  header: `@@ -${start},3 +${start},3 @@`,
  lines: [
    ctx(start),
    { type: 'remove' as const, content: 'old', oldLineNumber: start + 1, newLineNumber: null },
    { type: 'add' as const, content: 'new', oldLineNumber: null, newLineNumber: start + 1 },
    ctx(start + 2),
  ],
})
// Gaps: top 1-9, after-0 13-49, bottom 53-100.
const twoHunkDiff = { path: 'src/foo.ts', isBinary: false, hunks: [hunk(10), hunk(50)] }

const renderLoaded = async (
  diff: unknown = twoHunkDiff,
  props: Partial<typeof defaultProps> = {}
) => {
  mockPrFileDiff.mockResolvedValue({ diff })
  const view = await renderPane(props)
  await waitFor(() => expect(view.container.querySelector('.diff-hunk-header')).toBeTruthy())
  return view
}
const expandedRows = (c: HTMLElement) => c.querySelectorAll('tr[data-expanded="true"]')

/** Clicks the button labelled `label` in gap row `index`. */
const clickGap = (c: HTMLElement, index: number, label: string) =>
  fireEvent.click(
    (c.querySelectorAll('.diff-gap-row')[index] as HTMLElement).querySelector(
      `button[aria-label${label.endsWith('*') ? '^' : ''}="${label.replace(/\*$/, '')}"]`
    )!
  )

/** The PR head's file text is the 100 numbered lines. */
const useFileContent = () =>
  beforeEach(() => {
    mockPrFileContent.mockResolvedValue({ content: fileText })
  })

describe('ReviewDiffPane expandable context', () => {
  useFileContent()

  it('shows no expanded rows and fetches nothing on first render', async () => {
    const { container } = await renderLoaded()
    expect(expandedRows(container).length).toBe(0)
    expect(mockPrFileContent).not.toHaveBeenCalled()
  })

  it('offers the right buttons per gap kind without touching hunk headers', async () => {
    const { container } = await renderLoaded()
    const rows = Array.from(container.querySelectorAll('.diff-gap-row'))
    expect(rows.length).toBe(3)
    const names = rows.map((r) =>
      Array.from(r.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))
    )
    expect(names[0]).toEqual(['Show all 9 lines', 'Show 20 lines above'])
    expect(names[1]).toEqual(['Show 20 lines below', 'Show all 37 lines', 'Show 20 lines above'])
    expect(names[2]).toEqual(['Show 20 lines below', 'Show all lines'])
    expect(container.querySelectorAll('.diff-hunk-header').length).toBe(2)
  })
})

describe('ReviewDiffPane expandable context — fetches once on the first click and renders 20 numbered rows below the hunk', () => {
  useFileContent()

  it('fetches once on the first click and renders 20 numbered rows below the hunk', async () => {
    const { container } = await renderLoaded()
    clickGap(container, 1, 'Show 20 lines below')
    await waitFor(() => expect(expandedRows(container).length).toBe(20))
    expect(mockPrFileContent).toHaveBeenCalledTimes(1)
    expect(mockPrFileContent).toHaveBeenCalledWith({
      repoRoot: '/repo',
      prNumber: 1,
      path: 'src/foo.ts',
      ref: 'abc',
    })
    const rows = Array.from(expandedRows(container))
    expect(rows[0].getAttribute('data-old-line')).toBe('13')
    expect(rows[0].getAttribute('data-new-line')).toBe('13')
    expect(rows[19].getAttribute('data-new-line')).toBe('32')
    expect(rows[0].classList.contains('diff-line--expanded')).toBe(true)
    expect(rows[0].textContent).toContain('line 13')

    clickGap(container, 1, 'Show 20 lines below')
    await waitFor(() => expect(expandedRows(container).length).toBe(37))
    expect(mockPrFileContent).toHaveBeenCalledTimes(1)
  })
})

describe('ReviewDiffPane expandable context — reveals lines just above the next hunk from the above button', () => {
  useFileContent()

  it('reveals lines just above the next hunk from the above button', async () => {
    const { container } = await renderLoaded()
    clickGap(container, 0, 'Show 20 lines above')
    await waitFor(() => expect(expandedRows(container).length).toBe(9))
    const rows = Array.from(expandedRows(container))
    expect(rows[0].getAttribute('data-new-line')).toBe('1')
    expect(rows[8].getAttribute('data-new-line')).toBe('9')
  })
})

describe('ReviewDiffPane expandable context — Show all removes that expander and offsets old numbers after a net line change', () => {
  useFileContent()

  it('Show all removes that expander and offsets old numbers after a net line change', async () => {
    const shifted = {
      path: 'src/foo.ts',
      isBinary: false,
      hunks: [
        {
          header: '@@ -10,2 +10,3 @@',
          lines: [
            ctx(10),
            { type: 'add' as const, content: 'x', oldLineNumber: null, newLineNumber: 11 },
            { type: 'context' as const, content: 'line 11', oldLineNumber: 11, newLineNumber: 12 },
          ],
        },
        {
          header: '@@ -20,1 +21,1 @@',
          lines: [{ ...ctx(21), oldLineNumber: 20 }],
        },
      ],
    }
    const { container } = await renderLoaded(shifted)
    clickGap(container, 1, 'Show all*')
    await waitFor(() => expect(expandedRows(container).length).toBe(8))
    const rows = Array.from(expandedRows(container))
    expect(rows[0].getAttribute('data-new-line')).toBe('13')
    expect(rows[0].getAttribute('data-old-line')).toBe('12')
    expect(container.querySelectorAll('.diff-gap-row').length).toBe(2)
  })
})

describe('ReviewDiffPane expandable context — renders revealed rows in split view', () => {
  useFileContent()

  it('renders revealed rows in split view', async () => {
    uiStoreMock.mockReturnValue({
      ...baseReviewUiStoreState(),
      diffViewMode: 'split' as const,
    })
    mockPrFileDiff.mockResolvedValue({ diff: twoHunkDiff })
    const { container } = await renderPane()
    await waitFor(() => expect(container.querySelector('.diff-split-header')).toBeTruthy())
    clickGap(container, 1, 'Show 20 lines below')
    await waitFor(() =>
      expect(container.querySelectorAll('tr[data-expanded="true"]').length).toBe(40)
    )
    expect(container.querySelectorAll('.diff-table--left tr[data-old-line="13"]').length).toBe(1)
    expect(container.querySelectorAll('.diff-table--right tr[data-new-line="13"]').length).toBe(1)
    expect(container.querySelectorAll('.diff-hunk-header').length).toBe(0)
  })
})

describe('ReviewDiffPane expandable context — hides Comment but keeps the other actions when the selection includes a revealed line', () => {
  useFileContent()

  it('hides Comment but keeps the other actions when the selection includes a revealed line', async () => {
    await useRealUiStore()
    const { container } = await renderLoaded()
    clickGap(container, 1, 'Show 20 lines below')
    await waitFor(() => expect(expandedRows(container).length).toBe(20))

    const row = container.querySelector('tr[data-new-line="13"]')!
    fireEvent.mouseDown(row.querySelector('.diff-gutter-btn')!)
    fireEvent.mouseUp(window)
    await waitFor(() => expect(screen.getByRole('button', { name: /Ask agent/ })).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Comment/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Add note/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Explain' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tests' })).toBeTruthy()
    expect(screen.queryByTestId('composer')).toBeNull()

    window.dispatchEvent(new Event('review:comment'))
    expect(screen.queryByTestId('composer')).toBeNull()
  })

  it('still offers Comment for a selection inside the diff', async () => {
    await useRealUiStore()
    const { container } = await renderLoaded()
    const row = container.querySelector('tr[data-new-line="11"]')!
    fireEvent.mouseDown(row.querySelector('.diff-gutter-btn')!)
    fireEvent.mouseUp(window)
    await waitFor(() => expect(screen.getByRole('button', { name: /Comment/ })).toBeTruthy())
  })
})

describe('ReviewDiffPane expandable context — says the file is too large and offers no buttons', () => {
  useFileContent()

  it('says the file is too large and offers no buttons', async () => {
    mockPrFileContent.mockResolvedValue({ tooLarge: true })
    const { container } = await renderLoaded()
    clickGap(container, 1, 'Show 20 lines below')
    await waitFor(() =>
      expect(screen.getAllByText('This file is too large to expand here.').length).toBe(3)
    )
    expect(container.querySelectorAll('.diff-gap-row button').length).toBe(0)
  })

  it('shows the error with Retry, and Retry fetches again', async () => {
    mockPrFileContent.mockResolvedValueOnce({ error: 'NETWORK_DOWN' })
    const { container } = await renderLoaded()
    clickGap(container, 1, 'Show 20 lines below')
    await waitFor(() => expect(screen.getAllByText('NETWORK_DOWN').length).toBe(3))
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0])
    await waitFor(() => expect(expandedRows(container).length).toBe(20))
    expect(mockPrFileContent).toHaveBeenCalledTimes(2)
  })
})

describe('ReviewDiffPane expandable context — resets expansions when another file opens', () => {
  useFileContent()

  it('resets expansions when another file opens', async () => {
    const { container, rerender } = await renderLoaded()
    clickGap(container, 1, 'Show 20 lines below')
    await waitFor(() => expect(expandedRows(container).length).toBe(20))

    const other = { ...mockFile, path: 'src/bar.ts' }
    mockPrFileDiff.mockResolvedValue({ diff: { ...twoHunkDiff, path: 'src/bar.ts' } })
    rerender(<ReviewDiffPane {...defaultProps} file={other} />)
    await waitFor(() => expect(screen.getByTitle('src/bar.ts')).toBeTruthy())
    await waitFor(() => expect(container.querySelectorAll('.diff-gap-row').length).toBe(3))
    expect(expandedRows(container).length).toBe(0)
  })

  it('shows no expanders for a binary file', async () => {
    const { container } = await renderPane({ file: { ...mockFile, isBinary: true } })
    expect(container.querySelectorAll('.diff-gap-row').length).toBe(0)
  })

  it('shows no expanders for a truncated diff', async () => {
    const { container } = await renderLoaded({ ...twoHunkDiff, truncated: true })
    expect(container.querySelectorAll('.diff-gap-row').length).toBe(0)
  })

  it('shows no expanders for an added file', async () => {
    const added = oneHunk('@@ -0,0 +1,2 @@', [addLine(1, 'a'), addLine(2, 'b')])
    const { container } = await renderLoaded(added)
    expect(container.querySelectorAll('.diff-gap-row').length).toBe(0)
  })
})

const diffOf = (path: string, content: string) => ({
  path,
  isBinary: false,
  hunks: [
    {
      header: '@@ -1,2 +1,2 @@',
      lines: [
        { type: 'context' as const, content, oldLineNumber: 1, newLineNumber: 1 },
        {
          type: 'add' as const,
          content: `${content} // again`,
          oldLineNumber: null,
          newLineNumber: 2,
        },
      ],
    },
  ],
})

const codeLine = (text: string) => (_: string, el: Element | null) =>
  el?.tagName === 'PRE' && el.textContent === text

const otherFile = { ...mockFile, path: 'src/bar.ts' }

const longDiff = (count: number) => ({
  path: 'src/foo.ts',
  isBinary: false,
  hunks: [
    {
      header: `@@ -1,${count} +1,${count} @@`,
      lines: Array.from({ length: count }, (_, i) => ({
        type: 'context' as const,
        content: `const line${i + 1} = ${i + 1}`,
        oldLineNumber: i + 1,
        newLineNumber: i + 1,
      })),
    },
  ],
})

// Every row mounted beyond the viewport is render work a jump through a long file pays
// for: the viewport (800 px) plus at most half of it again.
const MOUNTED_ROWS_CAP = (800 / ROW_PX) * 1.5

describe('ReviewDiffPane — fetch and render cost', () => {
  it('tells the main process the base ref and head sha so it can skip its own fetch', async () => {
    await renderPane()
    await waitFor(() => expect(mockPrFileDiff).toHaveBeenCalledTimes(1))
    expect(mockPrFileDiff).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'src/foo.ts', baseRef: 'main', headSHA: 'abc' })
    )
  })

  it('does not refetch the open file when it is marked viewed', async () => {
    mockPrFileDiff.mockResolvedValue({ diff: diffOf('src/foo.ts', 'const viewedMark = 1') })
    const view = await renderPane()
    await screen.findByText(codeLine('const viewedMark = 1'))
    prStoreMock.mockReturnValue({
      ...basePrReviewStoreState(),
      viewedFiles: new Set(['src/foo.ts']),
      viewedAt: { 'src/foo.ts': 'abc' },
    })
    const { ReviewDiffPane } = await import('../../src/components/pr-review/ReviewDiffPane')
    view.rerender(<ReviewDiffPane {...defaultProps} />)
    expect(await screen.findByRole('checkbox', { name: 'Viewed' })).toHaveProperty('checked', true)
    expect(mockPrFileDiff).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Loading diff…')).toBeNull()
    expect(screen.getByText(codeLine('const viewedMark = 1'))).toBeTruthy()
  })
})

describe('ReviewDiffPane — fetch and render cost — shows a diff it already has straight away when switching back to a file', () => {
  it('shows a diff it already has straight away when switching back to a file', async () => {
    mockPrFileDiff.mockImplementation((payload: { path: string }) =>
      Promise.resolve({ diff: diffOf(payload.path, `const in_${payload.path.slice(4, 7)} = 1`) })
    )
    const view = await renderPane()
    await screen.findByText(codeLine('const in_foo = 1'))
    const { ReviewDiffPane } = await import('../../src/components/pr-review/ReviewDiffPane')
    view.rerender(<ReviewDiffPane {...defaultProps} file={otherFile} />)
    await screen.findByText(codeLine('const in_bar = 1'))
    view.rerender(<ReviewDiffPane {...defaultProps} />)
    expect(screen.getByText(codeLine('const in_foo = 1'))).toBeTruthy()
    expect(screen.queryByText('Loading diff…')).toBeNull()
    expect(mockPrFileDiff).toHaveBeenCalledTimes(2)
  })

  it('refetches when the head moves, since the cached diff belongs to the old head', async () => {
    mockPrFileDiff.mockResolvedValue({ diff: diffOf('src/foo.ts', 'const headMoves = 1') })
    const view = await renderPane()
    await screen.findByText(codeLine('const headMoves = 1'))
    const { ReviewDiffPane } = await import('../../src/components/pr-review/ReviewDiffPane')
    view.rerender(<ReviewDiffPane {...defaultProps} pr={{ ...mockPr, headSHA: 'def' }} />)
    await waitFor(() => expect(mockPrFileDiff).toHaveBeenCalledTimes(2))
  })
})

describe('ReviewDiffPane — fetch and render cost — highlights each distinct line once however often the pane re-renders', () => {
  it('highlights each distinct line once however often the pane re-renders', async () => {
    mockPrFileDiff.mockResolvedValue({ diff: diffOf('src/foo.ts', 'const highlightOnce = 1') })
    const view = await renderPane()
    await screen.findByText(codeLine('const highlightOnce = 1'))
    const seen = highlightSpy.mock.calls.filter((c) =>
      String(c[0]).includes('highlightOnce')
    ).length
    expect(seen).toBe(2)
    const { ReviewDiffPane } = await import('../../src/components/pr-review/ReviewDiffPane')
    view.rerender(<ReviewDiffPane {...defaultProps} onMarkViewed={vi.fn()} />)
    view.rerender(<ReviewDiffPane {...defaultProps} onMarkViewed={vi.fn()} />)
    const after = highlightSpy.mock.calls.filter((c) =>
      String(c[0]).includes('highlightOnce')
    ).length
    expect(after).toBe(seen)
  })
})

describe('ReviewDiffPane — fetch and render cost — a drag over the diff re-renders only the rows whose selection changed', () => {
  it('a drag over the diff re-renders only the rows whose selection changed', async () => {
    mockPrFileDiff.mockResolvedValue({ diff: longDiff(30) })
    const { container } = await renderPane()
    await screen.findByText('@@ -1,30 +1,30 @@')
    const rows = container.querySelectorAll<HTMLTableRowElement>('tr.diff-line')
    fireEvent.mouseDown(rows[0].querySelector('.diff-gutter-btn')!)
    rowRenderSpy.mockClear()

    fireEvent.mouseEnter(rows[1])
    fireEvent.mouseEnter(rows[2])

    expect(rowRenderSpy.mock.calls.map(([line]) => line)).toEqual([2, 3])
  })
})

describe('ReviewDiffPane — fetch and render cost — dragging the split divider re-renders no row', () => {
  it('dragging the split divider re-renders no row', async () => {
    uiStoreMock.mockReturnValue({ ...baseReviewUiStoreState(), diffViewMode: 'split' })
    mockPrFileDiff.mockResolvedValue({ diff: longDiff(30) })
    const { container } = await renderPane()
    await screen.findByText('@@ -1,30 +1,30 @@')
    vi.spyOn(
      container.querySelector('.review-diff-scroll')!,
      'getBoundingClientRect'
    ).mockReturnValue({ width: 400 } as DOMRect)
    rowRenderSpy.mockClear()

    fireEvent.mouseDown(container.querySelector('.diff-split-resize-handle')!, { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 140 })
    fireEvent.mouseUp(window)

    expect(container.querySelector<HTMLElement>('.diff-table--left')!.style.width).toBe('60%')
    expect(rowRenderSpy).not.toHaveBeenCalled()
  })

  it('mounts only the rows near the viewport of a 2,000-line file', async () => {
    layOut(800)
    mockPrFileDiff.mockResolvedValue({ diff: longDiff(2000) })
    const { container } = await renderPane()
    await screen.findByText('@@ -1,2000 +1,2000 @@')

    const mounted = container.querySelectorAll('tr.diff-line').length
    expect(mounted).toBeGreaterThan(800 / ROW_PX - 1)
    expect(mounted).toBeLessThan(MOUNTED_ROWS_CAP)
    expect(container.querySelector('[data-new-line="1500"]')).toBeNull()
  })
})

describe('ReviewDiffPane — fetch and render cost — mounts the rows it scrolls to', () => {
  it('mounts the rows it scrolls to', async () => {
    layOut(800)
    mockPrFileDiff.mockResolvedValue({ diff: longDiff(2000) })
    const { container } = await renderPane()
    await screen.findByText('@@ -1,2000 +1,2000 @@')
    const scroller = container.querySelector<HTMLElement>('.review-diff-scroll')!

    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 1500 * ROW_PX })
    fireEvent.scroll(scroller)

    const mountedLines = () =>
      Array.from(container.querySelectorAll<HTMLElement>('tr.diff-line')).map((row) =>
        Number(row.dataset.newLine)
      )
    await waitFor(() => expect(Math.min(...mountedLines())).toBeGreaterThan(1000))
    expect(mountedLines().length).toBeLessThan(MOUNTED_ROWS_CAP)
  })
})
