import React, { useState } from 'react'
import { Button, Tab, TabList, TabPanel, TabsRoot } from '@terminator/extension-ui'
import { RichContent } from './RichContent'
import { githubAPI } from '../../api/github'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { choose } from '../text'

interface NewCommentProps {
  repoRoot: string
  prNumber: number
  commitId: string
  path: string
  line: number
  startLine?: number
  side: 'LEFT' | 'RIGHT'
  initialBody?: string
  fromFindingId?: string | null
  onSubmitted: () => void
  onCancel: () => void
}

interface ReplyProps {
  repoRoot: string
  prNumber: number
  inReplyToId: number
  onSubmitted: () => void
  onCancel: () => void
}

type Props = NewCommentProps | ReplyProps

function isReply(p: Props): p is ReplyProps {
  return 'inReplyToId' in p
}

type AddDraft = ReturnType<typeof usePrReviewStore.getState>['addDraft']

async function sendReply(props: ReplyProps, body: string): Promise<void> {
  const result = await githubAPI.prCommentReply({
    repoRoot: props.repoRoot,
    prNumber: props.prNumber,
    inReplyToId: props.inReplyToId,
    body,
  })
  if ('error' in result) throw new Error((result as { error: string }).error)
}

/** A new comment waits as a draft until the review is submitted. */
function addCommentDraft(props: NewCommentProps, body: string, addDraft: AddDraft): void {
  addDraft(
    { repoRoot: props.repoRoot, prNumber: props.prNumber, headSHA: props.commitId },
    {
      id: crypto.randomUUID(),
      path: props.path,
      line: props.line,
      startLine: props.startLine ?? null,
      side: props.side,
      body,
      fromFindingId: props.fromFindingId ?? null,
    }
  )
}

function initialBodyOf(props: Props): string {
  if (isReply(props)) return ''
  return props.initialBody ?? ''
}

function useComposer(props: Props) {
  const [body, setBody] = useState(initialBodyOf(props))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const addDraft = usePrReviewStore((s) => s.addDraft)

  const sendComposedReply = async (replyProps: ReplyProps) => {
    setSubmitting(true)
    setError(null)
    try {
      await sendReply(replyProps, body)
      replyProps.onSubmitted()
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }
  const handleSubmit = async () => {
    if (!body.trim()) return
    if (isReply(props)) return sendComposedReply(props)
    addCommentDraft(props, body, addDraft)
    props.onSubmitted()
  }
  return { body, setBody, submitting, error, handleSubmit }
}

type ComposerState = ReturnType<typeof useComposer>

function submitLabel(props: Props, submitting: boolean): string {
  if (!isReply(props)) return 'Add to pending review'
  return choose(submitting, 'Submitting…', 'Reply')
}

function ComposerTabs({ state }: { state: ComposerState }) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const { body } = state
  return (
    <TabsRoot selectedId={tab} onSelect={setTab}>
      <TabList label="Comment">
        <Tab id="write">Write</Tab>
        <Tab id="preview">Preview</Tab>
      </TabList>
      <TabPanel id="write">
        <textarea
          className="comment-composer-textarea"
          value={body}
          onChange={(e) => state.setBody(e.target.value)}
          placeholder="Leave a comment…"
          rows={4}
          disabled={state.submitting}
        />
      </TabPanel>
      <TabPanel id="preview">
        <div className="comment-composer-preview">
          {body.trim() && <RichContent>{body}</RichContent>}
          {!body.trim() && <em>Nothing to preview.</em>}
        </div>
      </TabPanel>
    </TabsRoot>
  )
}

function ComposerActions({ composer, state }: { composer: Props; state: ComposerState }) {
  const { submitting } = state
  return (
    <div className="comment-composer-actions">
      <Button size="sm" onClick={composer.onCancel} disabled={submitting}>
        Cancel
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={state.handleSubmit}
        disabled={submitting || !state.body.trim()}
      >
        {submitLabel(composer, submitting)}
      </Button>
      {!isReply(composer) && <span className="rs-note">Sent when you submit your review</span>}
    </div>
  )
}

function NewCommentHeading({ props }: { props: NewCommentProps }) {
  return (
    <div className="rs-thread-th">
      <span className="rs-av">A</span>New comment · line {props.line}
      {props.fromFindingId && ' · edited from agent finding'}
    </div>
  )
}

export function CommentComposer(props: Props) {
  const state = useComposer(props)
  return (
    <div className="comment-composer" data-testid="composer">
      {!isReply(props) && <NewCommentHeading props={props} />}
      <ComposerTabs state={state} />
      {state.error && <p className="comment-composer-error">{state.error}</p>}
      <ComposerActions composer={props} state={state} />
    </div>
  )
}
