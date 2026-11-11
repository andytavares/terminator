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
import { electronApiOf } from '../../packages/test-support/src/electron-api'

const DAY = 86400000
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString()
const REPO = '/work/terminator'

/** How a file changed: its line counts. */
interface FileChange {
  additions: number
  deletions: number
}

function contrastFile(path: string, { additions, deletions }: FileChange) {
  return {
    path,
    changeType: 'modified' as const,
    additions,
    deletions,
    isBinary: false,
    whyHere: 'Changed in this pull request',
    churn90d: 4,
  }
}

const chapters = [
  {
    id: 'ch-1',
    name: 'Session records',
    status: 'in-progress' as const,
    files: [
      contrastFile('packages/core-main/src/session/session-store.ts', {
        additions: 120,
        deletions: 14,
      }),
      contrastFile('packages/core-main/src/session/session-records.ts', {
        additions: 44,
        deletions: 6,
      }),
      contrastFile('packages/core-main/src/session/session-types.ts', {
        additions: 12,
        deletions: 0,
      }),
    ],
  },
  {
    id: 'ch-2',
    name: 'Home ledger',
    status: 'not-started' as const,
    files: [
      contrastFile('packages/core-renderer/src/home/Ledger.tsx', {
        additions: 80,
        deletions: 22,
      }),
      contrastFile('packages/core-renderer/src/home/Logbook.tsx', {
        additions: 31,
        deletions: 3,
      }),
    ],
  },
  {
    id: 'ch-3',
    name: 'Generated and lockfiles',
    status: 'complete' as const,
    files: [contrastFile('package-lock.json', { additions: 400, deletions: 380 })],
  },
]

const prDetail = {
  number: 182,
  title: 'Session Home and Monitor Wall',
  chapters,
  readingOrder: [
    {
      step: 1,
      path: 'packages/core-main/src/session/session-store.ts',
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
    { path: 'packages/core-main/src/index.ts', status: 'modified', staged: true, isBinary: false },
    {
      path: 'packages/core-main/src/session/session-store.ts',
      status: 'added',
      staged: true,
      isBinary: false,
    },
    {
      path: 'packages/core-renderer/src/App.tsx',
      status: 'modified',
      staged: false,
      isBinary: false,
    },
    {
      path: 'packages/core-renderer/src/old-home.tsx',
      status: 'deleted',
      staged: false,
      isBinary: false,
    },
    { path: 'docs/notes.md', status: 'untracked', staged: false, isBinary: false },
  ],
}

const diff = {
  path: 'packages/core-renderer/src/App.tsx',
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

function dashboardPr(number: number, section: string, extra: Record<string, unknown> = {}) {
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
    updatedAt: ago(number % 5),
    additions: 120 + number,
    deletions: 40,
    fileCount: 9,
    ciStatus: 'passing',
    reviewDecision: 'review-required',
    unresolvedThreads: 0,
    commitsSinceMyReview: 0,
    reviewerCount: 2,
    ...extra,
  }
}

const dashboardPrs = [
  dashboardPr(201, 'requested', { ciStatus: 'failing' }),
  dashboardPr(202, 'requested'),
  dashboardPr(203, 're-review', { commitsSinceMyReview: 3 }),
  dashboardPr(204, 'team', { ciStatus: 'pending' }),
  dashboardPr(205, 'mine', {
    reviewDecision: 'changes-requested',
    unresolvedThreads: 2,
  }),
  dashboardPr(206, 'mine', { reviewDecision: 'approved' }),
  dashboardPr(207, 'mine', { ciStatus: 'failing' }),
  dashboardPr(208, 'involved'),
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
      filePath: 'packages/core-main/src/session/session-store.ts',
      conflictCount: 4,
      resolvedCount: 0,
      blocks: [0, 1, 2, 3].map((i) => block(`s-${i}`, i, false)),
      oursAuthor: author('Ada'),
      theirsAuthor: author('Grace'),
      conflictDescription: 'Both sides changed how a record is keyed',
    },
    {
      filePath: 'packages/core-renderer/src/home/Ledger.tsx',
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

declare global {
  interface Window {
    /** Which surface this page renders; the spec sets it before loading the bundle. */
    __SURFACE__?: string
  }
}

window.electronAPI = electronApiOf({
  extensionBridge: {
    invoke: (channel: string) => Promise.resolve(channels[channel] ?? null),
    on: () => () => {},
  },
  fs: {
    onChanged: () => () => {},
    watchStart: async () => ({ ok: true as const }),
    watchStop: async () => ({ ok: true as const }),
  },
  extension: { onSettingsChanged: () => () => {} },
})

function PrRail(): React.JSX.Element {
  usePrReviewStore.setState({
    viewedFiles: new Set(['packages/core-main/src/session/session-types.ts', 'package-lock.json']),
    currentChapterId: 'ch-1',
    currentFilePath: 'packages/core-main/src/session/session-records.ts',
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
            currentFilePath="packages/core-main/src/session/session-records.ts"
            onSelectFile={() => {}}
          />
        </aside>
      </div>
    </div>
  )
}

function GitView(): React.JSX.Element {
  useGitStore.setState({
    selectedFile: 'packages/core-renderer/src/App.tsx',
    diffCache: new Map([['packages/core-renderer/src/App.tsx', diff as never]]),
  })
  return (
    <div style={{ height: 640, width: 1000, display: 'flex' }}>
      <GitFullView repoRoot={REPO} />
    </div>
  )
}

/** A queued pull request whose review was paused part-way. */
function pausedPr(): never {
  return {
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

    sessionStatus: 'paused',
    viewedFileCount: 3,
    approvalCount: 0,
    approvedBy: [],
    requestedReviewers: [],
    assigneeLogins: [],
    mergeStateStatus: 'clean',
  } as never
}

function PausedQueue(): React.JSX.Element {
  usePrReviewStore.setState({ prQueue: [pausedPr()] })
  return (
    <div style={{ height: 400, width: 1100, display: 'flex' }}>
      <ReviewQueue
        repoRoot={REPO}
        onOpenPr={() => {}}
        onRefresh={() => Promise.resolve()}
        onDismissPr={() => Promise.resolve()}
      />
    </div>
  )
}

const surfaces: Record<string, () => React.JSX.Element> = {
  'review-footer': () => (
    <ReviewFooter
      previousFileName="math.ts"
      nextFileName={null}
      isLastFile
      isLastChapter
      position="file 2 of 2"
      isViewed={false}
      onToggleViewed={() => {}}
      onPrevFile={() => {}}
      onMarkViewed={() => {}}
      onFinishChapter={() => {}}
      onOpenShortcuts={() => {}}
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

const name = window.__SURFACE__ ?? ''
const Surface = surfaces[name]
const el = document.getElementById('app')
if (!Surface || !el) throw new Error(`No surface ${name}`)
createRoot(el).render(<Surface />)
