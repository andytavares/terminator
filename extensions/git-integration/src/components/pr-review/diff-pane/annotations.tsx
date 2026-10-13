import React from 'react'
import { InlineCommentThread } from '../InlineCommentThread'
import { RichContent } from '../RichContent'
import { CommentComposer } from '../CommentComposer'
import { AgentNote } from '../AgentNote'
import { SelectionBar } from '../SelectionBar'
import { TestsPopover } from '../TestsPopover'
import type { DraftComment, ReviewNote, Thread } from '../../../schemas/pr-review.schema'
import type { LineSelection } from '../../../stores/review-ui.store'
import type { PaneContext, Side } from './types'
import { rangeStart, selectionCode } from './lines'

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

/** The agent findings the line shows: none while agent notes are off. */
function shownFindings(props: LineRef) {
  const { ctx, lineNum, side } = props
  if (!ctx.actions.agentNotesOn) return []
  return ctx.lookups.findingsForLine(lineNum, side)
}

/** True when the line has a composer, a visible thread, a shown finding, a note or a draft. */
export function hasAnnotations(at: LineRef): boolean {
  const { lookups } = at.ctx
  const { lineNum, side } = at
  return (
    composerOpenAt(at) ||
    lookups.visibleThreadsForLine(lineNum, side).length > 0 ||
    shownFindings(at).length > 0 ||
    lookups.notesForLine(lineNum, side).length > 0 ||
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

function PrivateNote(props: { ctx: PaneContext; note: ReviewNote }) {
  const { ctx, note } = props
  return (
    <div className="rs-thread">
      <div className="rs-thread-th">Private note</div>
      <div className="rs-thread-bd">{note.body}</div>
      <div className="rs-thread-actions">
        <button
          type="button"
          className="rs-btn"
          onClick={() => ctx.actions.removeNote(ctx.head, note.id)}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

function editDraft(ctx: PaneContext, draft: DraftComment): void {
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
        <button type="button" className="rs-btn" onClick={() => editDraft(ctx, draft)}>
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

/** The annotations for one line and side: composer, threads, agent and private notes, drafts.
 *  Unwrapped so it can sit in a <tr><td> (unified) or a plain <div> (split). */
export function AnnotationContent(at: LineRef) {
  const { ctx, lineNum, side } = at
  const { lookups } = ctx
  return (
    <>
      {composerOpenAt(at) && <OpenComposer ctx={ctx} />}
      {lookups.visibleThreadsForLine(lineNum, side).map((thread) => (
        <ThreadWithReply key={thread.id} ctx={ctx} thread={thread} />
      ))}
      {shownFindings(at).map((f) => (
        <AgentNote key={f.id} severity={f.severity} body={f.body} />
      ))}
      {lookups.notesForLine(lineNum, side).map((n) => (
        <PrivateNote key={n.id} ctx={ctx} note={n} />
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

/** The tests popover, when it is open for `anchor`. */
export function OpenTests(props: { ctx: PaneContext; anchor: string }) {
  const { ctx, anchor } = props
  const { tests } = ctx
  if (tests.testsFor?.anchor !== anchor) return null
  return (
    <TestsPopover
      block={tests.testsFor.block}
      prPaths={tests.prPaths}
      onOpenInReview={tests.openTestInReview}
      onClose={tests.closeTests}
    />
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
      onTests={() => ctx.tests.openTests('selection', selectionCode(ctx.diff?.hunks ?? [], sel))}
      onAskAgent={() => actions.openAgentPanel(linesScope(ctx, sel), 'review')}
      onExplain={() => actions.openAgentPanel(linesScope(ctx, sel), 'explain', true)}
      onAddNote={() => annot.setNoteAnchor({ line: sel.endLine, side: sel.side })}
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

function NoteComposer(props: { ctx: PaneContext }) {
  const { ctx } = props
  const { annot } = ctx
  return (
    <tr>
      <td colSpan={5}>
        <div className="rs-note-composer">
          <textarea
            value={annot.noteDraft}
            onChange={(e) => annot.setNoteDraft(e.target.value)}
            rows={3}
            placeholder="Private note…"
          />
          <div className="rs-note-composer-actions">
            <button type="button" className="rs-btn rs-btn--pri" onClick={annot.saveNote}>
              Save
            </button>
            <button type="button" className="rs-btn" onClick={annot.cancelNote}>
              Cancel
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

/** Under a line: the float bar for a selection ending there, and the note box opened there. */
export function SelectionExtras(at: LineRef) {
  const { ctx, lineNum, side } = at
  const sel = barAt(at)
  const note = ctx.annot.noteAnchor
  return (
    <>
      {sel && (
        <tr>
          <td colSpan={5} className="rs-hunk-anchor">
            <FloatBar ctx={ctx} sel={sel} />
            <OpenTests ctx={ctx} anchor="selection" />
          </td>
        </tr>
      )}
      {note && note.line === lineNum && note.side === side && <NoteComposer ctx={ctx} />}
    </>
  )
}
