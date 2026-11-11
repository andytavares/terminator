import React from 'react'
import { InlineCommentThread } from '../InlineCommentThread'
import { RichContent } from '../RichContent'
import { CommentComposer } from '../CommentComposer'
import { AgentNote } from '../AgentNote'
import { SelectionBar } from '../SelectionBar'
import type { DraftComment, Thread } from '../../../schemas/pr-review.schema'
import type { LineSelection } from '../../../stores/review-ui.store'
import type { PaneContext, Side } from './types'
import { rangeStart } from './lines'

interface LineRef {
  ctx: PaneContext
  lineNum: number
  side: Side
}

function composerOpenAt(props: LineRef): boolean {
  const { ctx, lineNum, side } = props
  const anchor = ctx.annot.composerAnchor
  return anchor?.line === lineNum && anchor.side === side
}

/** True when the line has a composer, a thread, an agent finding or a draft. */
function hasAnnotations(at: LineRef): boolean {
  const { lookups } = at.ctx
  const { lineNum, side } = at
  return (
    composerOpenAt(at) ||
    lookups.threadsForLine(lineNum, side).length > 0 ||
    lookups.findingsForLine(lineNum, side).length > 0 ||
    lookups.draftsForLine(lineNum, side).length > 0
  )
}

function OpenComposer(props: { ctx: PaneContext }) {
  const { ctx } = props
  const anchor = ctx.annot.composerAnchor!
  return (
    <CommentComposer
      repoRoot={ctx.repoRoot}
      prNumber={ctx.pr.number}
      commitId={ctx.pr.headSHA}
      path={ctx.file.path}
      line={anchor.line}
      startLine={anchor.startLine ?? undefined}
      side={anchor.side}
      initialBody={anchor.initialBody}
      fromFindingId={anchor.fromFindingId}
      onSubmitted={ctx.annot.closeComposer}
      onCancel={ctx.annot.closeComposer}
    />
  )
}

function ThreadWithReply(props: { ctx: PaneContext; thread: Thread }) {
  const { ctx, thread } = props
  const { annot } = ctx
  const replied = () => {
    annot.setReplyTarget(null)
    ctx.actions.refreshComments()
  }
  return (
    <>
      <InlineCommentThread
        thread={thread}
        onReply={(tid) =>
          annot.setReplyTarget({ threadId: tid, inReplyToId: thread.comments[0].id })
        }
      />
      {annot.replyTarget?.threadId === thread.id && (
        <CommentComposer
          repoRoot={ctx.repoRoot}
          prNumber={ctx.pr.number}
          inReplyToId={annot.replyTarget.inReplyToId}
          onSubmitted={replied}
          onCancel={() => annot.setReplyTarget(null)}
        />
      )}
    </>
  )
}

function editDraftComment(ctx: PaneContext, draft: DraftComment): void {
  const next = prompt('Edit draft', draft.body)
  if (next != null) ctx.actions.updateDraft(ctx.head, draft.id, next)
}

function PendingDraft(props: { ctx: PaneContext; draft: DraftComment }) {
  const { ctx, draft } = props
  return (
    <div className="rs-thread">
      <div className="rs-thread-th">Pending · sent when you submit your review</div>
      <div className="rs-thread-bd">
        <RichContent>{draft.body}</RichContent>
      </div>
      <div className="rs-thread-actions">
        <button type="button" className="rs-btn" onClick={() => editDraftComment(ctx, draft)}>
          Edit
        </button>
        <button
          type="button"
          className="rs-btn"
          onClick={() => ctx.actions.removeDraft(ctx.head, draft.id)}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

/** The annotations for one line and side: composer, threads, agent notes, drafts. */
function AnnotationContent(at: LineRef) {
  const { ctx, lineNum, side } = at
  const { lookups } = ctx
  return (
    <>
      {composerOpenAt(at) && <OpenComposer ctx={ctx} />}
      {lookups.threadsForLine(lineNum, side).map((thread) => (
        <ThreadWithReply key={thread.id} ctx={ctx} thread={thread} />
      ))}
      {lookups.findingsForLine(lineNum, side).map((f) => (
        <AgentNote key={f.id} severity={f.severity} body={f.body} />
      ))}
      {lookups.draftsForLine(lineNum, side).map((d) => (
        <PendingDraft key={d.id} ctx={ctx} draft={d} />
      ))}
    </>
  )
}

/** The annotations under a unified row, when the line has any. */
export function LineAnnotations(at: LineRef) {
  if (!hasAnnotations(at)) return null
  return (
    <tr>
      <td colSpan={5}>
        <AnnotationContent ctx={at.ctx} lineNum={at.lineNum} side={at.side} />
      </td>
    </tr>
  )
}

function linesScope(ctx: PaneContext, sel: LineSelection) {
  const { startLine, endLine, side } = sel
  return { kind: 'lines' as const, path: ctx.file.path, startLine, endLine, side, chapter: null }
}

function FloatBar(props: { ctx: PaneContext; sel: LineSelection }) {
  const { ctx, sel } = props
  const { annot, actions } = ctx
  const comment = { line: sel.endLine, startLine: rangeStart(sel), side: sel.side }
  return (
    <SelectionBar
      canComment={!ctx.gaps.selectionTouchesRevealed(sel)}
      onAskAgent={() => actions.openAgentPanel(linesScope(ctx, sel), 'review')}
      onExplain={() => actions.openAgentPanel(linesScope(ctx, sel), 'explain', true)}
      onComment={() =>
        annot.setComposerAnchor({ ...comment, initialBody: '', fromFindingId: null })
      }
    />
  )
}

/** The float bar sits under the selection's last line, once the drag is over. */
function barAt(props: LineRef): LineSelection | null {
  const { ctx, lineNum, side } = props
  const sel = ctx.selection
  if (!sel || sel.path !== ctx.file.path || sel.side !== side) return null
  if (sel.endLine !== lineNum || ctx.drag.dragPreview !== null) return null
  return sel
}

/** Under a line: the float bar for a selection ending there. */
export function SelectionExtras(at: LineRef) {
  const sel = barAt(at)
  if (!sel) return null
  return (
    <tr>
      <td colSpan={5} className="rs-hunk-anchor">
        <FloatBar ctx={at.ctx} sel={sel} />
      </td>
    </tr>
  )
}
