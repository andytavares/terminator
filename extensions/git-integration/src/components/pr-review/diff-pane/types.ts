import type { PrChangedFile, PrReviewDetail, PrHead } from '../../../schemas/pr-review.schema'
import type { FileDiff } from '../../../schemas/git.schema'
import type { LineSelection } from '../../../stores/review-ui.store'
import type { AgentScope } from '../../../schemas/review-agent.schema'
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

export interface ReplyTarget {
  threadId: string
  inReplyToId: number
}

export type FileText =
  | { status: 'idle' | 'loading' | 'tooLarge' }
  | { status: 'error'; message: string }
  | { status: 'ready'; lines: string[] }

/** The comment composer and the reply composer, with their actions. */
export interface Annotating {
  composerAnchor: ComposerAnchor | null
  setComposerAnchor: (anchor: ComposerAnchor | null) => void
  closeComposer: () => void
  replyTarget: ReplyTarget | null
  setReplyTarget: (target: ReplyTarget | null) => void
}

interface PaneLayout {
  numColWidth: number
}

/** The store actions the rows use. */
interface PaneActions {
  revealFormattingHunks: () => void
  openAgentPanel: (
    scope: AgentScope | null,
    request?: 'review' | 'explain' | 'ask',
    autoStart?: boolean
  ) => void
  refreshComments: () => void
  updateDraft: (head: PrHead, id: string, body: string) => void
  removeDraft: (head: PrHead, id: string) => void
  toggleMoved: (key: string) => void
  toggleFold: (hunkIndex: number) => void
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
  lang: string | undefined
  selection: LineSelection | null
  lookups: LineLookups
  drag: LineDrag
  annot: Annotating
  layout: PaneLayout
  gaps: GapControl
  actions: PaneActions
}
