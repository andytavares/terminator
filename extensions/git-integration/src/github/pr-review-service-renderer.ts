import type { InlineComment, Thread } from '../../../../src/shared/schemas/pr-review.schema'

// ─── Thread building (T045) ───────────────────────────────────────────────────

export function buildThreads(comments: InlineComment[]): Thread[] {
  const threadMap = new Map<string, InlineComment[]>()

  for (const comment of comments) {
    const key = comment.threadId
    const existing = threadMap.get(key) ?? []
    existing.push(comment)
    threadMap.set(key, existing)
  }

  const threads: Thread[] = []
  for (const [id, threadComments] of threadMap) {
    const sorted = [...threadComments].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
    const root = sorted[0]
    const replies = sorted.length - 1
    threads.push({
      id,
      path:      root.path,
      line:      root.line,
      startLine: root.startLine,
      side:      root.side,
      outdated:  sorted.some(c => c.outdated),
      comments:  sorted,
      collapsed: replies >= 4,
    })
  }

  return threads
}
