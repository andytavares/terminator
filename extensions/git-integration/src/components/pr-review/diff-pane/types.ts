import type { PrChangedFile, PrReviewDetail, PrHead } from '../../../schemas/pr-review.schema'
import type { FileDiff } from '../../../schemas/git.schema'
import type {
  CommentVisibility,
  DiffViewMode,
  LineSelection,
} from '../../../stores/review-ui.store'
import type { AgentScope } from '../../../schemas/review-agent.schema'
import type { TestBlock } from '../TestsPopover'
import type { LineLookups } from './line-lookups'
import type { LineDrag } from './useLineSelection'
import type { GapControl } from './useFileText'

export type Side = 'LEFT' | 'RIGHT'

/** Where the comment composer is open, and what it starts with. */
export interface ComposerAnchor {
  line: number
  startLine: number | null
  side: Side
  initialBody: string
  fromFindingId: string | null
}

export interface NoteAnchor {
  line: number
  side: Side
}

export interface ReplyTarget {
  threadId: string
  inReplyToId: number
}

export type FileText =
  | { status: 'idle' | 'loading' | 'tooLarge' }
  | { status: 'error'; message: string }
  | { status: 'ready'; lines: string[] }

/** The comment composer, the reply composer and the private-note box, with their actions. */
export interface Annotating {
  composerAnchor: ComposerAnchor | null
  setComposerAnchor: (anchor: ComposerAnchor | null) => void
  closeComposer: () => void
  replyTarget: ReplyTarget | null
  setReplyTarget: (target: ReplyTarget | null) => void
  noteAnchor: NoteAnchor | null
  setNoteAnchor: (anchor: NoteAnchor | null) => void
  noteDraft: string
  setNoteDraft: (draft: string) => void
  saveNote: () => void
  cancelNote: () => void
}

/** The tests popover: which block it is open for, and how to open it or jump to a test. */
export interface TestsControl {
  testsFor: { anchor: string; block: TestBlock } | null
  closeTests: () => void
  openTests: (anchor: string, code: string, hunkHeader?: string) => void
  openTestInReview: (path: string, line: number) => void
  prPaths: Set<string>
}

interface PaneLayout {
  numColWidth: number
  splitLeftPct: number
  onSplitDividerMouseDown: (e: React.MouseEvent) => void
}

/** The view settings and store actions the rows use. */
interface PaneActions {
  commentVisibility: CommentVisibility
  agentNotesOn: boolean
  showHiddenComments: () => void
  setHideFormattingHunks: (hide: boolean) => void
  openAgentPanel: (
    scope: AgentScope | null,
    request?: 'review' | 'explain' | 'ask',
    autoStart?: boolean
  ) => void
  refreshComments: () => void
  removeNote: (head: PrHead, id: string) => void
  updateDraft: (head: PrHead, id: string, body: string) => void
  removeDraft: (head: PrHead, id: string) => void
  toggleMoved: (key: string) => void
  toggleHunkViewed: (head: PrHead, path: string, hunkHeader: string) => void
  goToPath: (path: string) => void
}

/** Everything the diff's rows need, built once per render of the pane. */
export interface PaneContext {
  repoRoot: string
  pr: PrReviewDetail
  file: PrChangedFile
  head: PrHead
  diff: FileDiff | null
  mode: DiffViewMode
  lang: string | undefined
  selection: LineSelection | null
  lookups: LineLookups
  drag: LineDrag
  annot: Annotating
  tests: TestsControl
  layout: PaneLayout
  gaps: GapControl
  actions: PaneActions
}
