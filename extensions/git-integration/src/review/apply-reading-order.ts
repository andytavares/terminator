import type { Chapter, ReadingStep } from '../schemas/pr-review.schema'

/**
 * Puts buildChapters' groups into reading order: chapters by their earliest
 * step, files within a chapter by step, each file's reason taken from its step.
 * Files with no step (no grammar, lock files) keep their order after the rest.
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
    return { ...chapter, files }
  })

  const firstStep = (c: Chapter) => Math.min(...c.files.map((f) => stepOf(f.path)))
  return reordered
    .map((c, i) => ({ c, i }))
    .sort((a, b) => firstStep(a.c) - firstStep(b.c) || a.i - b.i)
    .map(({ c }) => c)
}
