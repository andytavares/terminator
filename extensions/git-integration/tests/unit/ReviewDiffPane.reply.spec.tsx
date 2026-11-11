import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewDiffPane } from '../../src/components/pr-review/ReviewDiffPane'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import {
  PrReviewDetailSchema,
  type InlineComment,
  type PrChangedFile,
  type PrReviewDetail,
} from '../../src/schemas/pr-review.schema'

/** A reply in the diff pane, with the real stores, thread and composer: only the bridge is faked. */

const file: PrChangedFile = {
  path: 'src/math.ts',
  changeType: 'modified',
  additions: 3,
  deletions: 0,
  isBinary: false,
  whyHere: 'changed',
  churn90d: null,
  blastRadius: null,
}

const pr = PrReviewDetailSchema.parse({
  number: 1,
  title: 'Add subtract',
  body: '',
  author: 'octo-author',
  authorAvatarUrl: '',
  openedAt: '2026-10-01T09:00:00Z',
  headRefName: 'feat/subtract',
  baseRefName: 'main',
  headSHA: 'abc',
  ciStatus: 'passing',
  lintStatus: 'pass',
  chapters: [
    { id: 'ch-1', name: 'Math', estimatedMinutes: 1, status: 'not-started', files: [file] },
  ],
  readingOrder: [],
  movedBlocks: [],
  insights: null,
})

const SUBTRACT = ['export function subtract(a: number, b: number) {', '  return a - b', '}']
const diff = {
  path: 'src/math.ts',
  isBinary: false,
  hunks: [
    {
      header: '@@ -4,0 +5,3 @@',
      lines: SUBTRACT.map((content, i) => ({
        type: 'add',
        content,
        oldLineNumber: null,
        newLineNumber: 5 + i,
      })),
    },
  ],
}

interface CommentFields {
  id: number
  author: string
  body: string
  parentId: number | null
}

/** A review comment on line 6 of src/math.ts in thread `t-501`, as the inline comments channel sends it. */
function comment({ id, author, body, parentId }: CommentFields): InlineComment {
  return {
    id,
    author,
    authorAvatarUrl: '',
    body,
    createdAt: `2026-10-01T10:0${id - 501}:00Z`,
    updatedAt: `2026-10-01T10:0${id - 501}:00Z`,
    path: 'src/math.ts',
    line: 6,
    startLine: null,
    side: 'RIGHT',
    diffHunk: '@@ -4,0 +5,3 @@',
    outdated: false,
    threadId: 't-501',
    isReply: parentId !== null,
    parentId,
  }
}
const question = comment({
  id: 501,
  author: 'octo-author',
  body: 'Should this guard against NaN?',
  parentId: null,
})
const reply = comment({ id: 502, author: 'andrew', body: 'Callers validate first.', parentId: 501 })

// jsdom has no layout and the diff list is virtualised: give the scroller a height and rows a size.
const sized = ['offsetHeight', 'clientHeight', 'scrollHeight', 'offsetWidth'] as const
const jsdomSizes = sized.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name))
function layOut() {
  const scroller = (el: HTMLElement) => el.classList.contains('review-diff-scroll')
  const size = {
    offsetHeight: 4000,
    clientHeight: 4000,
    scrollHeight: 1_000_000,
    offsetWidth: 1000,
  }
  for (const name of sized) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return scroller(this) || name === 'offsetWidth' ? size[name] : 20
      },
    })
  }
}
afterAll(() => {
  sized.forEach((name, i) => {
    const original = jsdomSizes[i]
    if (original) Object.defineProperty(HTMLElement.prototype, name, original)
    else Reflect.deleteProperty(HTMLElement.prototype, name)
  })
})

/** GitHub as the bridge answers it: the reply joins the thread once it is posted. */
function fakeGithub() {
  const posted: unknown[] = []
  const invoke = vi.fn(async (channel: string, payload: unknown) => {
    if (channel === 'github:pr-file-diff') return { diff }
    if (channel === 'github:pr-comment-reply') {
      posted.push(payload)
      return { comment: reply }
    }
    if (channel === 'github:pr-inline-comments') {
      return { comments: posted.length > 0 ? [question, reply] : [question] }
    }
    return {}
  })
  Object.assign(globalThis, {
    electronAPI: { extensionBridge: { invoke }, usage: { record: vi.fn() } },
  })
  return posted
}

beforeEach(() => {
  layOut()
  usePrReviewStore.getState().reset()
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'electronAPI')
})

/** The pane on src/math.ts of the active pull request, whose line 6 has the reviewer's question. */
function renderPaneWithQuestion() {
  usePrReviewStore.setState({ activePr: pr })
  usePrReviewStore.getState().setThreads('src/math.ts', [
    {
      id: 't-501',
      path: 'src/math.ts',
      line: 6,
      startLine: null,
      side: 'RIGHT',
      outdated: false,
      comments: [question],
      collapsed: false,
      resolved: false,
    },
  ])
  render(<PaneInScroller pr={pr} file={file} />)
}

/** The pane inside the review stream's scroll element, as the stream renders each file. */
function PaneInScroller(props: { pr: PrReviewDetail; file: PrChangedFile }) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  return (
    <div className="review-diff-scroll" ref={scrollRef}>
      <ReviewDiffPane
        repoRoot="/repo"
        {...props}
        band="stream"
        scrollRef={scrollRef}
        active
        onPrevFile={vi.fn()}
        onNextFile={vi.fn()}
      />
    </div>
  )
}

describe('ReviewDiffPane — replying to a thread', () => {
  it("posts the reply to GitHub and shows it under the reviewer's comment", async () => {
    const user = userEvent.setup()
    const posted = fakeGithub()
    renderPaneWithQuestion()
    await screen.findByText('Should this guard against NaN?')
    await user.click(screen.getByRole('button', { name: 'Reply' }))
    await user.click(screen.getByPlaceholderText('Leave a comment…'))
    await user.paste('Callers validate first.')
    // The composer's send button comes after the thread's own Reply.
    await user.click(screen.getAllByRole('button', { name: 'Reply' }).at(-1)!)

    expect(await screen.findByText('Callers validate first.')).toBeTruthy()
    expect(screen.queryByPlaceholderText('Leave a comment…')).toBeNull()
    expect(posted).toEqual([
      { repoRoot: '/repo', prNumber: 1, inReplyToId: 501, body: 'Callers validate first.' },
    ])
  })
})
