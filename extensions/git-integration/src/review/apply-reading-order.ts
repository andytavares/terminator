import type { Chapter, ReadingStep } from '../schemas/pr-review.schema'

/**
 * Puts buildChapters' groups into reading order: chapters by their earliest
 * step, files within a chapter by step, each file's reason taken from its step.
 * Files with no step (no grammar) keep their order after the rest.
 */
export function applyReadingOrder(chapters: Chapter[], order: ReadingStep[]): Chapter[] {
  if (order.length === 0) return chapters
  const byPath = new Map(order.map((s) => [s.path, s]))
  const stepOf = (path: string) => byPath.get(path)?.step ?? Number.POSITIVE_INFINITY

  const reordered = chapters.map((chapter) => {
    const files = chapter.files
      .map((f, i) => ({ f, i }))
      .sort((a, b) => stepOf(a.f.path) - stepOf(b.f.path) || a.i - b.i)
      .map(({ f }) => {
        const step = byPath.get(f.path)
        return step ? { ...f, whyHere: step.reason } : f
      })
    return withSummary({ ...chapter, files }, byPath)
  })

  const firstStep = (c: Chapter) => Math.min(...c.files.map((f) => stepOf(f.path)))
  return reordered
    .map((c, i) => ({ c, i }))
    .sort((a, b) => firstStep(a.c) - firstStep(b.c) || a.i - b.i)
    .map(({ c }) => c)
}

const NAMED_SYMBOLS = 3

/** "a", "a and b", "a, b and c", "a, b, c and 2 more". */
function symbolList(symbols: string[]): string {
  const named = symbols.slice(0, NAMED_SYMBOLS)
  const rest = symbols.length - named.length
  if (rest > 0) return `${named.join(', ')} and ${rest} more`
  if (named.length === 1) return named[0]
  return `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`
}

/** The chapter with a one-line summary: the symbols its steps change. */
function withSummary(chapter: Chapter, byPath: Map<string, ReadingStep>): Chapter {
  const symbols = [...new Set(chapter.files.map((f) => byPath.get(f.path)?.symbol ?? null))].filter(
    (symbol): symbol is string => symbol !== null
  )
  return symbols.length > 0 ? { ...chapter, summary: `Changes ${symbolList(symbols)}` } : chapter
}
