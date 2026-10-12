import type { InlineComment, Thread } from '../schemas/pr-review.schema'

// ─── Thread building (T045) ───────────────────────────────────────────────────

function byCreatedAt(a: InlineComment, b: InlineComment): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
}

/** A thread of comments sorted oldest first; one with four or more replies starts collapsed. */
function threadOf(id: string, comments: InlineComment[]): Thread {
  const sorted = [...comments].sort(byCreatedAt)
  const root = sorted[0]
  return {
    id,
    path: root.path,
    line: root.line,
    startLine: root.startLine,
    side: root.side,
    outdated: sorted.some((c) => c.outdated),
    comments: sorted,
    collapsed: sorted.length - 1 >= 4,
    resolved: false,
  }
}

export function buildThreads(comments: InlineComment[]): Thread[] {
  const threadMap = new Map<string, InlineComment[]>()
  for (const comment of comments) {
    threadMap.set(comment.threadId, [...(threadMap.get(comment.threadId) ?? []), comment])
  }
  return [...threadMap].map(([id, threadComments]) => threadOf(id, threadComments))
}
