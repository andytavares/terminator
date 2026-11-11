import type { Chapter, PrChangedFile } from '../../schemas/pr-review.schema'
import type { PrReviewStore } from '../../stores/pr-review.store'

/** The chapter's files in the reviewer's own order when they dragged one, else the chapter's. */
export function orderedFiles(
  chapter: Chapter,
  overrideOrder: string[] | undefined
): PrChangedFile[] {
  if (!overrideOrder) return chapter.files
  return overrideOrder
    .map((p) => chapter.files.find((f) => f.path === p))
    .filter((f): f is PrChangedFile => !!f)
}

/** Makes `chapterId` current and opens its first file, in the reviewer's order. */
export function startAtChapter(
  store: Pick<PrReviewStore, 'setCurrentChapter' | 'setCurrentFile' | 'fileOrderOverrides'>,
  chapters: Chapter[],
  chapterId: string
): void {
  store.setCurrentChapter(chapterId)
  const chapter = chapters.find((c) => c.id === chapterId)
  if (chapter) {
    store.setCurrentFile(
      orderedFiles(chapter, store.fileOrderOverrides[chapter.id])[0]?.path ?? null
    )
  }
}

/** "true" for the row being shown, so assistive tech announces it as current. */
export function currentAttr(isActive: boolean): 'true' | undefined {
  if (isActive) return 'true'
  return undefined
}
