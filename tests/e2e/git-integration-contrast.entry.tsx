/**
 * Client entry for git-integration-contrast.spec.ts: mounts the real
 * git-integration components with fixture data behind a stub `electronAPI`, so
 * plain Chromium can render them without launching Electron.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { FullFileList } from '../../extensions/git-integration/src/components/pr-review/FullFileList'
import { ChapterNav } from '../../extensions/git-integration/src/components/pr-review/ChapterNav'
import { ReviewDashboard } from '../../extensions/git-integration/src/components/pr-review/ReviewDashboard'
import { ReviewFooter } from '../../extensions/git-integration/src/components/pr-review/ReviewFooter'
import { ReviewQueue } from '../../extensions/git-integration/src/components/pr-review/ReviewQueue'
import { RepoPicker } from '../../extensions/git-integration/src/components/pr-review/RepoPicker'
import { GitFullView } from '../../extensions/git-integration/src/components/GitFullView'
import { MergeFlowView } from '../../extensions/git-integration/src/components/merge-flow/MergeFlowView'
import { usePrReviewStore } from '../../extensions/git-integration/src/stores/pr-review.store'
import { useGitStore } from '../../extensions/git-integration/src/stores/git.store'

const DAY = 86400000
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString()
const REPO = '/work/terminator'

type Level = 'low' | 'medium' | 'high'

function file(
  path: string,
  level: Level,
  tier: 0 | 1 | 2 | 3,
  additions: number,
  deletions: number
) {
  return {
    path,
    changeType: 'modified' as const,
    additions,
    deletions,
    isBinary: false,
    tier,
    whyHere: 'Changed in this pull request',
    riskScore: {
      level,
      composite: level === 'high' ? 80 : level === 'medium' ? 50 : 10,
      metrics: {
        changeSize: null,
        churn90d: null,
        blastRadius: null,
        testFilePresent: null,
        complexityDelta: null,
        patchCoverage: null,
      },
      dominantDriver: 'change size',
      topImporters: [],
      importerCount: 0,
    },
    estimatedMinutes: 4,
  }
}

const chapters = [
  {
    id: 'ch-1',
    name: 'Session records',
    estimatedMinutes: 12,
    status: 'in-progress' as const,
    files: [
      file('src/main/session/session-store.ts', 'high', 0, 120, 14),
      file('src/main/session/session-records.ts', 'medium', 1, 44, 6),
      file('src/main/session/session-types.ts', 'low', 2, 12, 0),
    ],
  },
  {
    id: 'ch-2',
    name: 'Home ledger',
    estimatedMinutes: 9,
    status: 'not-started' as const,
    files: [
      file('src/renderer/home/Ledger.tsx', 'medium', 1, 80, 22),
      file('src/renderer/home/Logbook.tsx', 'low', 2, 31, 3),
    ],
  },
  {
    id: 'ch-3',
    name: 'Generated and lockfiles',
    estimatedMinutes: 1,
    status: 'complete' as const,
    files: [file('package-lock.json', 'low', 3, 400, 380)],
  },
]

const prDetail = {
  number: 182,
  title: 'Session Home and Monitor Wall',
  chapters,
  readingOrder: [
    {
      step: 1,
      path: 'src/main/session/session-store.ts',
      symbol: 'SessionStore',
      reason: 'Defines the record every later file reads',
      uses: [],
    },
  ],
}

const gitStatus = {
  branch: 'feat/git-speed-contrast-keys',
  hasConflicts: false,
  truncated: false,
  files: [
    { path: 'src/main/index.ts', status: 'modified', staged: true, isBinary: false },
    { path: 'src/main/session/session-store.ts', status: 'added', staged: true, isBinary: false },
    { path: 'src/renderer/App.tsx', status: 'modified', staged: false, isBinary: false },
    { path: 'src/renderer/old-home.tsx', status: 'deleted', staged: false, isBinary: false },
    { path: 'docs/notes.md', status: 'untracked', staged: false, isBinary: false },
  ],
}

const diff = {
  path: 'src/renderer/App.tsx',
  isBinary: false,
  truncated: false,
  hunks: [
    {
      header: '@@ -10,7 +10,8 @@ export function App()',
      lines: [
        {
          type: 'context',
          content: "import React from 'react'",
          oldLineNumber: 10,
          newLineNumber: 10,
        },
        { type: 'remove', content: "const view = 'home'", oldLineNumber: 11, newLineNumber: null },
        { type: 'add', content: 'const view = getView()', oldLineNumber: null, newLineNumber: 11 },
        { type: 'add', content: 'const wall = useWall()', oldLineNumber: null, newLineNumber: 12 },
        {
          type: 'context',
          content: 'return <Home view={view} />',
          oldLineNumber: 12,
          newLineNumber: 13,
        },
      ],
    },
  ],
}

function dashboardPr(
  number: number,
  section: string,
  riskLevel: Level,
  extra: Record<string, unknown> = {}
) {
  return {
    repo: 'andytavares/terminator',
    localRepoRoot: number % 2 === 0 ? REPO : null,
    section,
    number,
    title: `Pull request ${number} for the session wall`,
    url: `https://github.com/andytavares/terminator/pull/${number}`,
    author: 'octocat',
    isDraft: false,
    createdAt: ago(number % 5),
    additions: 120 + number,
    deletions: 40,
    fileCount: 9,
    riskLevel,
    estimatedMinutes: 18,
    ciStatus: 'passing',
    reviewDecision: 'review-required',
    unresolvedThreads: 0,
    commitsSinceMyReview: 0,
    reviewerCount: 2,
    ...extra,
  }
}

const dashboardPrs = [
  dashboardPr(201, 'requested', 'high', { ciStatus: 'failing' }),
  dashboardPr(202, 'requested', 'medium'),
  dashboardPr(203, 're-review', 'low', { commitsSinceMyReview: 3 }),
  dashboardPr(204, 'team', 'medium', { ciStatus: 'pending' }),
  dashboardPr(205, 'mine', 'low', { reviewDecision: 'changes-requested', unresolvedThreads: 2 }),
  dashboardPr(206, 'mine', 'medium', { reviewDecision: 'approved' }),
  dashboardPr(207, 'mine', 'high', { ciStatus: 'failing' }),
  dashboardPr(208, 'involved', 'low'),
]

function author(name: string) {
  return { name, commitHash: 'a1b2c3d', timestamp: ago(2) }
}

function block(id: string, index: number, resolved: boolean) {
  return {
    blockId: id,
    index,
    oursText: 'const a = 1',
    theirsText: 'const a = 2',
    baseText: 'const a = 0',
    contextBefore: ['// before'],
    contextAfter: ['// after'],
    originalConflictText: '<<<<<<< ours\nconst a = 1\n=======\nconst a = 2\n>>>>>>> theirs',
    isResolved: resolved,
  }
}

const conflictSession = {
  repoRoot: REPO,
  isRebase: false,
  startedAt: ago(0),
  oursBranch: 'main',
  theirsBranch: 'feat/session-wall',
  totalConflicts: 7,
  totalResolved: 2,
  files: [
    {
      filePath: 'src/main/session/session-store.ts',
      conflictCount: 4,
      resolvedCount: 0,
      blocks: [0, 1, 2, 3].map((i) => block(`s-${i}`, i, false)),
      oursAuthor: author('Ada'),
      theirsAuthor: author('Grace'),
      conflictDescription: 'Both sides changed how a record is keyed',
    },
    {
      filePath: 'src/renderer/home/Ledger.tsx',
      conflictCount: 1,
      resolvedCount: 0,
      blocks: [block('l-0', 0, false)],
      oursAuthor: author('Ada'),
      theirsAuthor: author('Grace'),
      conflictDescription: '',
    },
    {
      filePath: 'package.json',
      conflictCount: 2,
      resolvedCount: 2,
      blocks: [block('p-0', 0, true), block('p-1', 1, true)],
      oursAuthor: author('Ada'),
      theirsAuthor: author('Grace'),
      conflictDescription: 'Version bump on both branches',
    },
  ],
}

const channels: Record<string, unknown> = {
  'git:status': gitStatus,
  'git:diff-file': { diff },
  'git:pr-status': null,
  'git:commit-output-poll': { lines: [] },
  'git:session-restore': { session: conflictSession },
  'git:session-persist': { success: true },
  'github:dashboard-search': {
    prs: dashboardPrs,
    login: 'andytavares',
    fetchedAt: new Date().toISOString(),
  },
  'github:review-settings': { cloneFolder: '/work/clones', repos: [] },
  'github:accessible-repos': {
    repos: [
      { fullName: 'acme/api', owner: 'acme', private: true, pushedAt: ago(3) },
      { fullName: 'acme/web', owner: 'acme', private: false, pushedAt: ago(40) },
      { fullName: 'acme/infra', owner: 'acme', private: true, pushedAt: ago(200) },
      {
        fullName: 'andytavares/terminator',
        owner: 'andytavares',
        private: false,
        pushedAt: ago(1),
      },
      {
        fullName: 'andytavares/dotfiles',
        owner: 'andytavares',
        private: false,
        pushedAt: ago(420),
      },
      { fullName: 'octo/cli', owner: 'octo', private: false, pushedAt: ago(9) },
    ],
  },
}

;(window as unknown as { electronAPI: unknown }).electronAPI = {
  extensionBridge: {
    invoke: (channel: string) => Promise.resolve(channels[channel] ?? null),
    on: () => () => {},
  },
  fs: { onChanged: () => () => {} },
}

function PrRail(): JSX.Element {
  usePrReviewStore.setState({
    viewedFiles: new Set(['src/main/session/session-types.ts', 'package-lock.json']),
    currentChapterId: 'ch-1',
    currentFilePath: 'src/main/session/session-records.ts',
  })
  return (
    <div className="pr-review-view" style={{ height: 640, width: 280 }}>
      <div className="pr-review-panels">
        <aside className="pr-review-panel pr-review-panel--left">
          <div className="pr-review-panel-header">
            <span className="pr-review-chapter-name">Files</span>
          </div>
          <div className="pr-rail-chapters">
            <ChapterNav chapters={chapters as never} />
          </div>
          <FullFileList
            pr={prDetail as never}
            repoRoot={REPO}
            headSHA="abc1234"
            currentFilePath="src/main/session/session-records.ts"
            onSelectFile={() => {}}
          />
        </aside>
      </div>
    </div>
  )
}

function GitView(): JSX.Element {
  useGitStore.setState({
    selectedFile: 'src/renderer/App.tsx',
    diffCache: new Map([['src/renderer/App.tsx', diff as never]]),
  })
  return (
    <div style={{ height: 640, width: 1000, display: 'flex' }}>
      <GitFullView repoRoot={REPO} />
    </div>
  )
}

function PausedQueue(): JSX.Element {
  usePrReviewStore.setState({
    prQueue: [
      {
        number: 301,
        title: 'Resume the session wall review',
        author: 'octocat',
        authorAvatarUrl: '',
        openedAt: ago(1),
        headRefName: 'feat/wall',
        baseRefName: 'main',
        isDraft: false,
        ciStatus: 'passing',
        fileCount: 9,
        additions: 120,
        deletions: 40,
        estimatedMinutes: 18,
        riskLevel: 'medium',
        signalDots: {},
        sessionStatus: 'paused',
        viewedFileCount: 3,
        approvalCount: 0,
        approvedBy: [],
        requestedReviewers: [],
        assigneeLogins: [],
        mergeStateStatus: 'clean',
      } as never,
    ],
  })
  return (
    <div style={{ height: 400, width: 1100, display: 'flex' }}>
      <ReviewQueue
        repoRoot={REPO}
        onOpenPr={() => {}}
        onRefresh={() => Promise.resolve()}
        onDismissPr={() => Promise.resolve()}
        includeClosedPrs={false}
        onToggleClosedPrs={() => Promise.resolve()}
      />
    </div>
  )
}

const surfaces: Record<string, () => JSX.Element> = {
  'review-footer': () => (
    <ReviewFooter
      drafts={[]}
      isLastFile
      isLastChapter
      onPause={() => {}}
      onPrevFile={() => {}}
      onMarkViewed={() => {}}
      onFinishChapter={() => {}}
      onOpenSubmit={() => {}}
    />
  ),
  'review-queue': PausedQueue,
  'pr-rail': PrRail,
  'git-view': GitView,
  'merge-flow': () => (
    <div style={{ height: 640, width: 1000, display: 'flex' }}>
      <MergeFlowView repoRoot={REPO} onExit={() => {}} />
    </div>
  ),
  'repo-picker': () => (
    <RepoPicker
      initial={['acme/api', 'andytavares/terminator', 'andytavares/dotfiles']}
      onClose={() => {}}
      onSaved={() => {}}
    />
  ),
  reviews: () => (
    <div style={{ height: 640, width: 1100, display: 'flex' }}>
      <ReviewDashboard />
    </div>
  ),
}

const name = (window as unknown as { __SURFACE__: string }).__SURFACE__
const Surface = surfaces[name]
const el = document.getElementById('app')
if (!Surface || !el) throw new Error(`No surface ${name}`)
createRoot(el).render(<Surface />)
