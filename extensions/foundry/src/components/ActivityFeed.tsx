import React, { useCallback, useEffect, useState } from 'react'
import { getSpeckitAPI } from '../types/electron.js'
import type { CardComment, HistoryEntry } from '../types/speckit.types.js'

type Entry =
  | { kind: 'comment'; ts: string; comment: CardComment }
  | { kind: 'event'; ts: string; event: HistoryEntry }

function merge(comments: CardComment[], history: HistoryEntry[]): Entry[] {
  const entries: Entry[] = [
    ...comments.map((c) => ({ kind: 'comment' as const, ts: c.ts, comment: c })),
    ...history.map((e) => ({ kind: 'event' as const, ts: e.ts, event: e })),
  ]
  return entries.sort((a, b) => a.ts.localeCompare(b.ts))
}

interface ActivityFeedProps {
  featureDir: string
}

export function ActivityFeed({ featureDir }: ActivityFeedProps) {
  const [comments, setComments] = useState<CardComment[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const api = getSpeckitAPI()
    const [c, h] = await Promise.all([
      api.commentList({ featureDir }),
      api.historyLoad({ featureDir }),
    ])
    if ('comments' in c) setComments(c.comments)
    if ('entries' in h) setHistory(h.entries)
  }, [featureDir])

  useEffect(() => {
    void load()
  }, [load])

  const post = useCallback(async () => {
    if (text.trim().length === 0) return
    setBusy(true)
    const result = await getSpeckitAPI().cardComment({ featureDir, body: text.trim() })
    setBusy(false)
    if ('comment' in result) {
      setText('')
      void load()
    }
  }, [text, featureDir, load])

  const entries = merge(comments, history)

  return (
    <div className="sk-activity">
      <ul className="sk-activity__list">
        {entries.length === 0 ? (
          <li className="sk-activity__empty">No activity yet.</li>
        ) : (
          entries.map((e, i) =>
            e.kind === 'comment' ? (
              <li key={`c-${e.comment.id}-${i}`} className="sk-activity__comment">
                <span className="sk-activity__author">{e.comment.author}</span>
                <span className="sk-activity__body">{e.comment.body}</span>
              </li>
            ) : (
              <li key={`e-${i}`} className="sk-activity__event">
                <span className="sk-activity__action">{e.event.action}</span>
                <span className="sk-activity__phase">{e.event.phase}</span>
                {e.event.note && <span className="sk-activity__note">{e.event.note}</span>}
              </li>
            )
          )
        )}
      </ul>
      <div className="sk-activity__composer">
        <textarea
          aria-label="Comment"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Leave a comment to steer the next phase…"
        />
        <button
          type="button"
          className="sk-btn sk-btn--primary"
          disabled={busy || text.trim().length === 0}
          onClick={post}
        >
          Comment
        </button>
        <p className="sk-activity__hint">Your comment steers the agent on its next phase run.</p>
      </div>
    </div>
  )
}
