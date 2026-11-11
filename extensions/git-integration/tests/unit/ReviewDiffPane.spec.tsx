import React from 'react'
import { describe, it, beforeAll, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// Imported with the file rather than inside a test: the pane's module graph
// (highlight.js among it) takes about a second to load under vitest, and a
// test that imported it paid that against its own five-second timeout.
import { ReviewDiffPane } from '../../src/components/pr-review/ReviewDiffPane'
import { PrReviewDetailSchema, type PrChangedFile } from '../../src/schemas/pr-review.schema'
import { measureDiffComplexity } from '../../src/review/insights'

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
vi.mock('../../src/utils/syntax', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/syntax')>()
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
  }
})
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
vi.mock('../../src/review/insights', () => ({
  measureDiffComplexity: vi.fn(),
}))

const mockAddDraft = vi.fn()
const mockUpdateDraft = vi.fn()
const mockRemoveDraft = vi.fn()
const mockSetCurrentChapter = vi.fn()
const mockSetCurrentFile = vi.fn()
const mockMarkFileViewed = vi.fn()
const mockUnmarkFileViewed = vi.fn()
const mockSetSelection = vi.fn()
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
    changedSince: new Set<string>(),
    viewedAt: {},
    viewedHunks: {},
    historyRewritten: false,
    drafts: [],
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
    diffRange: 'whole' as const,
    selection: null,
    setSelection: mockSetSelection,
    composerRequest: null,
    requestComposer: mockRequestComposer,
    agentRuns: [],
    openAgentPanel: mockOpenAgentPanel,
    setFileHunks: vi.fn(),
  }
}

const mockFile: PrChangedFile = {
  path: 'src/foo.ts',
  changeType: 'modified' as const,
  additions: 5,
  deletions: 2,
  isBinary: false,
  whyHere: 'changed',
  churn90d: null,
  blastRadius: null,
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
  chapters: [
    {
      id: 'ch-1',
      name: 'Ch',
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
  active: true,
  onPrevFile: vi.fn(),
  onNextFile: vi.fn(),
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

beforeEach(async () => {
  // mockReset clears implementations before each test, so the spies get theirs back here.
  const syntax =
    await vi.importActual<typeof import('../../src/utils/syntax')>('../../src/utils/syntax')
  highlightSpy.mockImplementation(syntax.highlight)
  vi.mocked(measureDiffComplexity).mockResolvedValue(null)
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

/** The pane inside the review stream's scroll element, as the stream renders each file. */
function PaneInScroller(props: typeof defaultProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  return (
    <div className="review-diff-scroll" data-testid="review-diff-scroll" ref={scrollRef}>
      <ReviewDiffPane {...props} scrollRef={scrollRef} />
    </div>
  )
}

async function renderPane(props: Partial<typeof defaultProps> = {}) {
  return render(<PaneInScroller {...defaultProps} {...props} />)
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

/** Serves `diff` for the open file, renders the pane with `props`, and waits for its first hunk. */
async function renderDiffPane(diff: unknown, props: Partial<typeof defaultProps> = {}) {
  mockPrFileDiff.mockResolvedValue({ diff })
  const view = await renderPane(props)
  await findFirstHunk()
  return view
}

/** Waits for the pane to mount its first hunk header, which carries a "Section viewed" box. */
const findFirstHunk = () => screen.findAllByRole('checkbox', { name: 'Section viewed' })

/** The mounted code rows, top to bottom: gap and hunk rows are left out. */
const codeRows = () =>
  screen.queryAllByRole('row').filter((row) => row.classList.contains('diff-line'))

/** The mounted code row of new-side line `line`. */
const rowOfLine = (line: number) =>
  codeRows().find((row) => row.getAttribute('data-new-line') === String(line))!

/** A code row's comment button in the line-number gutter. */
const gutterButton = (row: HTMLElement) => within(row).getByRole('button', { name: 'Add comment' })

/** A unified code row's code cell, its last. */
const codeCell = (row: HTMLElement) => within(row).getAllByRole('cell').at(-1)!

/** The code rows the reviewer has selected. */
const selectedRows = () => screen.queryAllByRole('row', { selected: true })

/** Line 1 of src/foo.ts, right side, as the reviewer's selection. */
function selectLineOne() {
  uiStoreMock.mockReturnValue({
    ...baseReviewUiStoreState(),
    selection: { path: 'src/foo.ts', side: 'RIGHT' as const, startLine: 1, endLine: 1 },
  })
}

/** Puts the real UI store, in its initial state, behind the pane's selector. */
async function useRealUiStore() {
  const actual = await vi.importActual<typeof import('../../src/stores/review-ui.store')>(
    '../../src/stores/review-ui.store'
  )
  actual.useReviewUiStore.setState(actual.useReviewUiStore.getInitialState(), true)
  uiStoreMock.mockImplementation(actual.useReviewUiStore)
  return actual.useReviewUiStore
}

/** Puts the real PR review store, in its initial state, behind the pane's selector. */
async function useRealPrStore() {
  const actual = await vi.importActual<typeof import('../../src/stores/pr-review.store')>(
    '../../src/stores/pr-review.store'
  )
  actual.usePrReviewStore.setState(actual.usePrReviewStore.getInitialState(), true)
  prStoreMock.mockImplementation(actual.usePrReviewStore)
  return actual.usePrReviewStore
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

/** PR insights: `functions` changed, each with its branch gain. */
function insightsFor(functions: Array<{ name: string; line: number; branchDelta: number }>) {
  return {
    complexity: {
      branchDelta: Math.max(...functions.map((f) => f.branchDelta)),
      functions: functions.map((f) => ({ path: 'src/foo.ts', ...f })),
      source: 'tree-sitter',
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
})

describe('ReviewDiffPane', () => {
  it('renders file path in header', async () => {
    await renderPane()
    expect(screen.getByTitle('src/foo.ts').textContent).toBe('src/foo.ts')
  })

  it('shows no risk label', async () => {
    await renderPane()
    expect(screen.queryByText(/risk/i)).toBeNull()
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
    await screen.findByText(/Failed to load diff/)
  })
})

describe('ReviewDiffPane — section viewed toggle', () => {
  it('labels each hunk checkbox "Section viewed" on screen, apart from the file Viewed box', async () => {
    await renderTwoHunks()
    const boxes = await findFirstHunk()
    expect(screen.getAllByText('Section viewed')).toHaveLength(boxes.length)
    expect(screen.queryByText('Viewed')).toBeNull()
  })
})

describe('ReviewDiffPane — a gutter press selects the line and opens no composer', () => {
  it('a gutter press selects the line and opens no composer', async () => {
    const user = userEvent.setup()
    const uiStore = await useRealUiStore()
    await renderDiffPane(oneLineDiff())

    const btn = screen.getAllByRole('button', { name: 'Add comment' })[0]
    await user.pointer([{ keys: '[MouseLeft>]', target: btn }, { keys: '[/MouseLeft]' }])

    expect(uiStore.getState().selection).toEqual({
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
    const user = userEvent.setup()
    const uiStore = await useRealUiStore()
    const diff = oneHunk(
      '@@ -1,3 +1,3 @@',
      [1, 2, 3].map((n) => ctxLine(n))
    )
    await renderDiffPane(diff)

    const rows = codeRows()
    // A press and release on different elements clicks their common ancestor.
    await user.pointer([
      { keys: '[MouseLeft>]', target: gutterButton(rows[0]) },
      { target: rows[1] },
      { target: codeCell(rows[2]) },
      { keys: '[/MouseLeft]' },
    ])

    await waitFor(() => expect(selectedRows()).toHaveLength(3))
    expect(screen.getByRole('button', { name: /^Comment/ })).toBeTruthy()
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
    await renderDiffPane(diff)

    const rows = codeRows()
    // The drag ends with a zero-delay timer that lets the click after it through. user-event
    // waits one zero-delay tick after the release, so that timer has fired before the click below.
    const user = userEvent.setup()
    await user.pointer([
      { keys: '[MouseLeft>]', target: gutterButton(rows[0]) },
      { target: rows[1] },
      { keys: '[/MouseLeft]' },
    ])
    await waitFor(() => expect(selectedRows()).toHaveLength(2))

    await user.click(codeCell(rows[0]))

    await waitFor(() => expect(selectedRows()).toHaveLength(0))
    expect(uiStore.getState().selection).toBeNull()
  })
})

describe('ReviewDiffPane — shows the float bar under a selection, with Comment opening the composer', () => {
  it('shows the float bar under a selection, with Comment opening the composer', async () => {
    const user = userEvent.setup()
    selectLineOne()
    await renderDiffPane(oneLineDiff())

    expect(screen.queryByTestId('composer')).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Comment/ }))
    await screen.findByTestId('composer')

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByTestId('composer')).toBeNull())
  })
})

describe('ReviewDiffPane — opens the agent panel on the selected lines when Ask agent is clicked', () => {
  it('opens the agent panel on the selected lines when Ask agent is clicked', async () => {
    const user = userEvent.setup()
    const uiStore = await useRealUiStore()
    uiStore.setState({
      selection: { path: 'src/foo.ts', side: 'RIGHT', startLine: 1, endLine: 1 },
    })
    await renderDiffPane(oneLineDiff())

    await user.click(screen.getByRole('button', { name: /Ask agent/ }))
    expect(uiStore.getState()).toMatchObject({
      agentPanelScope: {
        kind: 'lines',
        path: 'src/foo.ts',
        startLine: 1,
        endLine: 1,
        side: 'RIGHT',
        chapter: null,
      },
      agentPanelRequest: 'review',
    })
  })
})

describe('ReviewDiffPane — renders inline comment threads on matching lines', () => {
  it('renders inline comment threads on matching lines', async () => {
    storeThreads([threadOnLineOne('thread-1')])
    mockPrFileDiff.mockResolvedValue({ diff: oneLineDiff() })
    await renderPane()
    await screen.findByTestId('thread')
  })
})

describe('ReviewDiffPane — comments', () => {
  it('shows every thread on the line, resolved ones too', async () => {
    storeThreads([threadOnLineOne('thread-open'), threadOnLineOne('thread-resolved', true)])
    await renderDiffPane(oneLineDiff())
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

  it('renders the agent note text after the finding line', async () => {
    uiStoreMock.mockReturnValue({ ...baseReviewUiStoreState(), agentRuns: [agentRun] })
    mockPrFileDiff.mockResolvedValue({ diff: singleLineDiff })
    await renderPane()
    await screen.findByText(/calls computeRiskScore again/)
    expect(screen.getByText(/Agent note ·/)).toBeTruthy()
  })
})

/** A semantic hunk at line 1 and a whitespace-only hunk at line 20. */
const formattingDiff = {
  path: 'src/foo.ts',
  isBinary: false,
  hunks: [
    { header: '@@ -1,1 +1,1 @@', lines: [removeLine(1, 'a'), addLine(1, 'b')] },
    {
      header: '@@ -20,1 +20,1 @@',
      lines: [removeLine(20, '  spaced()'), addLine(20, 'spaced()')],
    },
  ],
}

describe('ReviewDiffPane — formatting-only hunks', () => {
  it('hides formatting-only hunks behind a notice that reveals them', async () => {
    const user = userEvent.setup()
    await renderDiffPane(formattingDiff)
    expect(screen.getByText(/1 formatting-only hunk hidden/)).toBeTruthy()
    expect(screen.getAllByRole('checkbox', { name: 'Section viewed' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'show all' }))
    expect(screen.getAllByRole('checkbox', { name: 'Section viewed' })).toHaveLength(2)
    expect(screen.queryByText(/formatting-only/)).toBeNull()
  })
})

describe('ReviewDiffPane — moved code (S4)', () => {
  it('collapses a moved-here block into one row', async () => {
    const path = 'review/reading-order.ts'
    const diff = oneHunk('@@ -0,0 +1,3 @@', [addLine(41, 'a'), addLine(42, 'b')], path)
    mockPrFileDiff.mockResolvedValue({ diff })
    await renderPane({ file: { ...mockFile, path }, pr: prWithMove(path, 41) })
    const row = 'UnionFind · 28 lines, unchanged, from github/pr-review-service.ts:360'
    await screen.findByText(wholeText(row))
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
    await screen.findByText(wholeText(row))
    expect(screen.getByText('Moved')).toBeTruthy()
  })
})

const chipDiff = oneHunk('@@ -85,3 +88,3 @@', [addLine(88, 'a'), addLine(89, 'b')])

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
    await renderPane()
    await screen.findByText(/sent when you submit your review/)
    expect(screen.getAllByRole('code').map((code) => code.textContent)).toContain('fetch(filter)')
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
  renderDiffPane(keyTwoHunkDiff, props)

/** The scroll position of the entry holding the hunk at `hunkIndex`. */
const topOfHunk = (hunkIndex: number) => {
  const hunkEntries = screen
    .getAllByTestId('diff-entry')
    .filter((entry) => within(entry).queryByRole('checkbox', { name: 'Section viewed' }))
  return Number(hunkEntries[hunkIndex].dataset.index) * ROW_PX
}

describe('ReviewDiffPane — keyboard events (REVIEW_KEY_EVENTS)', () => {
  useOneRowViewport()

  it('nextHunk scrolls the next hunk header into view', async () => {
    await renderTwoHunks()
    const scroller = screen.getByTestId('review-diff-scroll')
    window.dispatchEvent(new CustomEvent('review:next-hunk'))
    expect(topOfHunk(1)).toBeGreaterThan(0)
    expect(scroller.scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: topOfHunk(1) })
    )
  })

  it('prevHunk scrolls the previous hunk header into view', async () => {
    await renderTwoHunks()
    const scroller = screen.getByTestId('review-diff-scroll')
    window.dispatchEvent(new CustomEvent('review:next-hunk')) // move to hunk 1 first
    expect(scroller.scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: topOfHunk(1) })
    )
    window.dispatchEvent(new CustomEvent('review:prev-hunk'))
    expect(scroller.scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: topOfHunk(0) })
    )
  })
})

const FIRST_HUNK = '@@ -1,1 +1,1 @@'
const SECOND_HUNK = '@@ -10,1 +10,1 @@'

describe('ReviewDiffPane — keyboard events (REVIEW_KEY_EVENTS) — Space and later', () => {
  useOneRowViewport()

  it('markHunkRead marks the current hunk read and scrolls to the next one', async () => {
    const prStore = await useRealPrStore()
    await renderTwoHunks()
    const scroller = screen.getByTestId('review-diff-scroll')
    window.dispatchEvent(new CustomEvent('review:mark-hunk-read'))
    expect(prStore.getState().viewedHunks['src/foo.ts']).toEqual([FIRST_HUNK])
    await waitFor(() =>
      expect(scroller.scrollTo).toHaveBeenLastCalledWith(
        expect.objectContaining({ top: topOfHunk(1) })
      )
    )
  })

  it('later keeps the current hunk for the end of the review and scrolls to the next one', async () => {
    const uiStore = await useRealUiStore()
    await renderTwoHunks()
    const scroller = screen.getByTestId('review-diff-scroll')
    window.dispatchEvent(new CustomEvent('review:later-hunk'))
    expect(uiStore.getState().laterHunks['/repo#1']).toEqual([
      { path: 'src/foo.ts', header: FIRST_HUNK },
    ])
    expect(scroller.scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: topOfHunk(1) })
    )
  })
})

describe('ReviewDiffPane — coming back to a later hunk', () => {
  useOneRowViewport()

  it('scrolls to a later hunk the review comes back to, then clears the request', async () => {
    const uiStore = await useRealUiStore()
    uiStore.setState({ revisitHunk: { path: 'src/foo.ts', header: SECOND_HUNK } })
    await renderTwoHunks()
    const scroller = screen.getByTestId('review-diff-scroll')
    await waitFor(() => expect(uiStore.getState().revisitHunk).toBeNull())
    expect(scroller.scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: topOfHunk(1) })
    )
  })
})

describe('ReviewDiffPane — keyboard events (REVIEW_KEY_EVENTS) — composer keys', () => {
  useOneRowViewport()

  it('comment opens the composer on the selection', async () => {
    selectLineOne()
    await renderTwoHunks()
    expect(screen.queryByTestId('composer')).toBeNull()
    window.dispatchEvent(new CustomEvent('review:comment'))
    await screen.findByTestId('composer')
  })
})

describe('ReviewDiffPane — keyboard events (REVIEW_KEY_EVENTS) — leaving the file', () => {
  useOneRowViewport()

  it('nextHunk at the last hunk calls onNextFile', async () => {
    const onNextFile = vi.fn()
    await renderDiffPane(oneHunk('@@ -1,1 +1,1 @@', [ctxLine(1, 'a')]), {
      onNextFile,
    })
    window.dispatchEvent(new CustomEvent('review:next-hunk'))
    expect(onNextFile).toHaveBeenCalled()
  })
})

describe('ReviewDiffPane — only the active file section handles the review keys', () => {
  useOneRowViewport()

  it('ignores nextHunk while another section is active', async () => {
    const onNextFile = vi.fn()
    await renderDiffPane(oneHunk('@@ -1,1 +1,1 @@', [ctxLine(1, 'a')]), {
      onNextFile,
      active: false,
    })
    window.dispatchEvent(new CustomEvent('review:next-hunk'))
    expect(onNextFile).not.toHaveBeenCalled()
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

describe('ReviewDiffPane — reading order (R3) — Peek definition opens the definition file', () => {
  it('opens the chapter and file of the definition when Peek definition is clicked', async () => {
    const user = userEvent.setup()
    const prStore = await useRealPrStore()
    await renderPane({ pr: prWithReadingOrder() })
    await user.click(screen.getByRole('button', { name: 'Peek definition' }))
    expect(prStore.getState()).toMatchObject({
      currentChapterId: 'ch-2',
      currentFilePath: 'src/other.ts',
    })
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
    await screen.findByText(/Showing 9f0c76eb/)
    expect(mockPrFileDiff).not.toHaveBeenCalled()
  })
})

describe('ReviewDiffPane — insight gutter chips (R4)', () => {
  it('shows a warning "+N" chip for each function that gained branches', async () => {
    const functions = [
      { name: 'shardByDuration', line: 88, branchDelta: 6 },
      { name: 'readBurnIn', line: 89, branchDelta: 3 },
    ]
    const insights = insightsFor(functions)
    await renderDiffPane(chipDiff, { pr: { ...mockPr, insights } })
    expect(screen.getByText('+6')).toBeTruthy()
    expect(screen.queryByText('untested')).toBeNull()
    // The gutter column is sized to its widest chip, so it never overlaps code.
    const gut = screen.getAllByRole('cell').find((cell) => within(cell).queryByText('+3'))!
    expect(gut.className).toBe('rs-gut')
    expect(gut.style.width).toBe('36px')
  })
})

const FILE_LINES = 100
const fileText = Array.from({ length: FILE_LINES }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
const contextLineAt = (n: number) => ({
  type: 'context' as const,
  content: `line ${n}`,
  oldLineNumber: n,
  newLineNumber: n,
})
const hunkAt = (start: number) => ({
  header: `@@ -${start},3 +${start},3 @@`,
  lines: [
    contextLineAt(start),
    { type: 'remove' as const, content: 'old', oldLineNumber: start + 1, newLineNumber: null },
    { type: 'add' as const, content: 'new', oldLineNumber: null, newLineNumber: start + 1 },
    contextLineAt(start + 2),
  ],
})
// Gaps: top 1-9, after-0 13-49, bottom 53-100.
const twoHunkDiff = { path: 'src/foo.ts', isBinary: false, hunks: [hunkAt(10), hunkAt(50)] }

const renderLoaded = async (
  diff: unknown = twoHunkDiff,
  props: Partial<typeof defaultProps> = {}
) => {
  mockPrFileDiff.mockResolvedValue({ diff })
  const view = await renderPane(props)
  await findFirstHunk()
  return view
}

/** The code rows revealed from the file text, top to bottom. */
const expandedRows = () => codeRows().filter((row) => row.getAttribute('data-expanded') === 'true')

/** The gaps between hunks, each with its expand buttons. */
const gaps = () => screen.queryAllByRole('group', { name: 'Unchanged lines' })

/** Clicks the button labelled `label` in gap `index`. */
const clickGap = (index: number, label: string) =>
  userEvent.setup().click(within(gaps()[index]).getByRole('button', { name: label }))

/** The unified view's hunk header cells. */
const unifiedHunkHeaders = () =>
  screen.queryAllByRole('cell').filter((cell) => cell.classList.contains('diff-hunk-header'))

/** The PR head's file text is the 100 numbered lines. */
const useFileContent = () =>
  beforeEach(() => {
    mockPrFileContent.mockResolvedValue({ content: fileText })
  })

describe('ReviewDiffPane expandable context', () => {
  useFileContent()

  it('shows no expanded rows and fetches nothing on first render', async () => {
    await renderLoaded()
    expect(expandedRows().length).toBe(0)
    expect(mockPrFileContent).not.toHaveBeenCalled()
  })

  it('offers the right buttons per gap kind without touching hunk headers', async () => {
    await renderLoaded()
    const rows = gaps()
    expect(rows.length).toBe(3)
    const names = rows.map((r) =>
      within(r)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    )
    expect(names[0]).toEqual(['Show 9 unchanged lines'])
    expect(names[1]).toEqual(['Show 20 lines below', 'Show all 37 lines', 'Show 20 lines above'])
    expect(names[2]).toEqual(['Show 20 lines below', 'Show all lines'])
    expect(unifiedHunkHeaders().length).toBe(2)
  })
})

describe('ReviewDiffPane expandable context — fetches once on the first click and renders 20 numbered rows below the hunk', () => {
  useFileContent()

  it('fetches once on the first click and renders 20 numbered rows below the hunk', async () => {
    await renderLoaded()
    await clickGap(1, 'Show 20 lines below')
    await waitFor(() => expect(expandedRows().length).toBe(20))
    expect(mockPrFileContent).toHaveBeenCalledTimes(1)
    expect(mockPrFileContent).toHaveBeenCalledWith({
      repoRoot: '/repo',
      prNumber: 1,
      path: 'src/foo.ts',
      ref: 'abc',
    })
    const rows = Array.from(expandedRows())
    expect(rows[0].getAttribute('data-old-line')).toBe('13')
    expect(rows[0].getAttribute('data-new-line')).toBe('13')
    expect(rows[19].getAttribute('data-new-line')).toBe('32')
    expect(rows[0].classList.contains('diff-line--expanded')).toBe(true)
    expect(rows[0].textContent).toContain('line 13')

    await clickGap(1, 'Show 17 unchanged lines')
    await waitFor(() => expect(expandedRows().length).toBe(37))
    expect(mockPrFileContent).toHaveBeenCalledTimes(1)
  })
})

describe('ReviewDiffPane expandable context — a gap no bigger than one step opens in one click', () => {
  useFileContent()

  it('reveals the whole 9-line gap above the first hunk', async () => {
    await renderLoaded()
    await clickGap(0, 'Show 9 unchanged lines')
    await waitFor(() => expect(expandedRows().length).toBe(9))
    const rows = Array.from(expandedRows())
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
            contextLineAt(10),
            { type: 'add' as const, content: 'x', oldLineNumber: null, newLineNumber: 11 },
            { type: 'context' as const, content: 'line 11', oldLineNumber: 11, newLineNumber: 12 },
          ],
        },
        {
          header: '@@ -20,1 +21,1 @@',
          lines: [{ ...contextLineAt(21), oldLineNumber: 20 }],
        },
      ],
    }
    await renderLoaded(shifted)
    await clickGap(1, 'Show 8 unchanged lines')
    await waitFor(() => expect(expandedRows().length).toBe(8))
    const rows = Array.from(expandedRows())
    expect(rows[0].getAttribute('data-new-line')).toBe('13')
    expect(rows[0].getAttribute('data-old-line')).toBe('12')
    expect(gaps().length).toBe(2)
  })
})

describe('ReviewDiffPane expandable context — hides Comment but keeps the other actions when the selection includes a revealed line', () => {
  useFileContent()

  it('hides Comment but keeps the other actions when the selection includes a revealed line', async () => {
    await useRealUiStore()
    await renderLoaded()
    await clickGap(1, 'Show 20 lines below')
    await waitFor(() => expect(expandedRows().length).toBe(20))

    await userEvent.setup().click(gutterButton(rowOfLine(13)))
    await screen.findByRole('button', { name: /Ask agent/ })
    expect(screen.queryByRole('button', { name: /Comment/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Explain' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Add note/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tests' })).toBeNull()
    expect(screen.queryByTestId('composer')).toBeNull()

    window.dispatchEvent(new Event('review:comment'))
    expect(screen.queryByTestId('composer')).toBeNull()
  })

  it('still offers Comment for a selection inside the diff', async () => {
    await useRealUiStore()
    await renderLoaded()
    await userEvent.setup().click(gutterButton(rowOfLine(11)))
    await screen.findByRole('button', { name: /Comment/ })
  })
})

describe('ReviewDiffPane expandable context — says the file is too large and offers no buttons', () => {
  useFileContent()

  it('says the file is too large and offers no buttons', async () => {
    mockPrFileContent.mockResolvedValue({ tooLarge: true })
    await renderLoaded()
    await clickGap(1, 'Show 20 lines below')
    await waitFor(() =>
      expect(screen.getAllByText('This file is too large to expand here.').length).toBe(3)
    )
    expect(gaps().flatMap((gap) => within(gap).queryAllByRole('button'))).toHaveLength(0)
  })

  it('shows the error with Retry, and Retry fetches again', async () => {
    mockPrFileContent.mockResolvedValueOnce({ error: 'NETWORK_DOWN' })
    await renderLoaded()
    await clickGap(1, 'Show 20 lines below')
    await waitFor(() => expect(screen.getAllByText('NETWORK_DOWN').length).toBe(3))
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Retry' })[0])
    await waitFor(() => expect(expandedRows().length).toBe(20))
    expect(mockPrFileContent).toHaveBeenCalledTimes(2)
  })
})

describe('ReviewDiffPane expandable context — resets expansions when another file opens', () => {
  useFileContent()

  it('resets expansions when another file opens', async () => {
    const { rerender } = await renderLoaded()
    await clickGap(1, 'Show 20 lines below')
    await waitFor(() => expect(expandedRows().length).toBe(20))

    const other = { ...mockFile, path: 'src/bar.ts' }
    mockPrFileDiff.mockResolvedValue({ diff: { ...twoHunkDiff, path: 'src/bar.ts' } })
    rerender(<PaneInScroller {...defaultProps} file={other} />)
    await screen.findByTitle('src/bar.ts')
    await waitFor(() => expect(gaps().length).toBe(3))
    expect(expandedRows().length).toBe(0)
  })

  it('shows no expanders for a binary file', async () => {
    await renderPane({ file: { ...mockFile, isBinary: true } })
    expect(gaps().length).toBe(0)
  })

  it('shows no expanders for a truncated diff', async () => {
    await renderLoaded({ ...twoHunkDiff, truncated: true })
    expect(gaps().length).toBe(0)
  })

  it('shows no expanders for an added file', async () => {
    const added = oneHunk('@@ -0,0 +1,2 @@', [addLine(1, 'a'), addLine(2, 'b')])
    await renderLoaded(added)
    expect(gaps().length).toBe(0)
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
    view.rerender(<PaneInScroller {...defaultProps} />)
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
    view.rerender(<PaneInScroller {...defaultProps} file={otherFile} />)
    await screen.findByText(codeLine('const in_bar = 1'))
    view.rerender(<PaneInScroller {...defaultProps} />)
    expect(screen.getByText(codeLine('const in_foo = 1'))).toBeTruthy()
    expect(screen.queryByText('Loading diff…')).toBeNull()
    expect(mockPrFileDiff).toHaveBeenCalledTimes(2)
  })

  it('refetches when the head moves, since the cached diff belongs to the old head', async () => {
    mockPrFileDiff.mockResolvedValue({ diff: diffOf('src/foo.ts', 'const headMoves = 1') })
    const view = await renderPane()
    await screen.findByText(codeLine('const headMoves = 1'))
    view.rerender(<PaneInScroller {...defaultProps} pr={{ ...mockPr, headSHA: 'def' }} />)
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
    view.rerender(<PaneInScroller {...defaultProps} onNextFile={vi.fn()} />)
    view.rerender(<PaneInScroller {...defaultProps} onNextFile={vi.fn()} />)
    const after = highlightSpy.mock.calls.filter((c) =>
      String(c[0]).includes('highlightOnce')
    ).length
    expect(after).toBe(seen)
  })
})

describe('ReviewDiffPane — fetch and render cost — a drag over the diff re-renders only the rows whose selection changed', () => {
  it('a drag over the diff re-renders only the rows whose selection changed', async () => {
    const user = userEvent.setup()
    mockPrFileDiff.mockResolvedValue({ diff: longDiff(30) })
    await renderPane()
    await findFirstHunk()
    const rows = codeRows()
    await user.pointer({ keys: '[MouseLeft>]', target: gutterButton(rows[0]) })
    rowRenderSpy.mockClear()

    await user.pointer([{ target: rows[1] }, { target: rows[2] }])

    expect(rowRenderSpy.mock.calls.map(([line]) => line)).toEqual([2, 3])
  })
})

describe('ReviewDiffPane — fetch and render cost — mounts few rows', () => {
  it('mounts only the rows near the viewport of a 2,000-line file', async () => {
    layOut(800)
    mockPrFileDiff.mockResolvedValue({ diff: longDiff(2000) })
    await renderPane()
    await findFirstHunk()

    const mounted = codeRows().length
    expect(mounted).toBeGreaterThan(800 / ROW_PX - 1)
    expect(mounted).toBeLessThan(MOUNTED_ROWS_CAP)
    expect(rowOfLine(1500)).toBeUndefined()
  })
})

describe('ReviewDiffPane — fetch and render cost — mounts the rows it scrolls to', () => {
  it('mounts the rows it scrolls to', async () => {
    layOut(800)
    mockPrFileDiff.mockResolvedValue({ diff: longDiff(2000) })
    await renderPane()
    await findFirstHunk()
    const scroller = screen.getByTestId('review-diff-scroll')

    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 1500 * ROW_PX })
    fireEvent.scroll(scroller)

    const mountedLines = () => codeRows().map((row) => Number(row.dataset.newLine))
    await waitFor(() => expect(Math.min(...mountedLines())).toBeGreaterThan(1000))
    expect(mountedLines().length).toBeLessThan(MOUNTED_ROWS_CAP)
  })
})

describe('ReviewDiffPane — hunk rows read as prose', () => {
  it('names the enclosing symbol and hides the line ranges', async () => {
    const diff = oneHunk('@@ -1,3 +1,3 @@ def add(a, b):', [ctxLine(1, 'return a + b')])
    const { container } = await renderDiffPane(diff)
    expect(screen.getByText(wholeText('in add'))).toBeTruthy()
    expect(screen.getByRole('code').textContent).toBe('add')
    expect(container.textContent).not.toContain('@@')
  })

  it('shows the context text when it names no symbol', async () => {
    const diff = oneHunk('@@ -1,3 +1,3 @@ (', [ctxLine(1, 'x')])
    const { container } = await renderDiffPane(diff)
    expect(unifiedHunkHeaders()[0].textContent).toContain('(')
    expect(container.textContent).not.toContain('@@')
  })
})

describe('ReviewDiffPane — gap of one line', () => {
  it('offers one control, "Show 1 unchanged line"', async () => {
    const hunks = [10, 14].map((start) => ({
      ...hunkAt(start),
      header: `@@ -${start},3 +${start},3 @@`,
    }))
    await renderLoaded({ path: 'src/foo.ts', isBinary: false, hunks })
    const between = gaps()[1]
    expect(between.textContent).toContain('Show 1 unchanged line')
    expect(between.textContent).not.toContain('1 unchanged lines')
    expect(within(between).getAllByRole('button').length).toBe(1)
  })
})

describe('ReviewDiffPane — changed words in the unified view', () => {
  const replaced = oneHunk('@@ -43,2 +43,3 @@', [
    removeLine(43, '        self.button = Button(pin, bounce_time=0.05)'),
    addLine(43, '        self.button = Button(pin, pull_up=True)'),
    addLine(44, '        self.contact = settings.contact'),
  ])

  it('marks the changed words of a replaced pair and nothing else', async () => {
    const { container } = await renderDiffPane(replaced)
    // The marks sit inside the highlighted HTML and carry no role, so they are found by class.
    // eslint-disable-next-line testing-library/no-node-access -- see above
    const added = container.querySelectorAll('.diff-word--add')
    // eslint-disable-next-line testing-library/no-node-access -- see above
    const removed = container.querySelectorAll('.diff-word--remove')
    expect(Array.from(added).map((n) => n.textContent)).toEqual(['pull_up', 'True'])
    expect(Array.from(removed).map((n) => n.textContent)).toEqual(['bounce_time', '0.05'])
  })

  it('leaves an unpaired added line unmarked', async () => {
    await renderDiffPane(replaced)
    const unpaired = rowOfLine(44)
    expect(unpaired.innerHTML).not.toContain('diff-word--add')
    expect(unpaired.textContent).toContain('self.contact = settings.contact')
  })
})
