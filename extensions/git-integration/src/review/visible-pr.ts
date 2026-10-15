import type { Chapter, PrReviewDetail } from '../schemas/pr-review.schema.js'

export interface PrFilters {
  focusMode: boolean
  ownedOnly: boolean
}

/** `chapters` keeping the files `keep` accepts, without the chapters left empty; when that would
 *  leave nothing, all of them, so a filter never blanks the review. */
function keepingFiles(chapters: Chapter[], keep: (path: string, level: string) => boolean) {
  const kept = chapters
    .map((c) => ({ ...c, files: c.files.filter((f) => keep(f.path, f.riskScore.level)) }))
    .filter((c) => c.files.length > 0)
  return kept.length > 0 ? kept : chapters
}

/** The PR as the reviewer chose to see it: only the files they own, and in focus mode only the
 *  medium and high risk ones. */
export function visiblePr(pr: PrReviewDetail, filters: PrFilters): PrReviewDetail {
  let { chapters } = pr
  if (filters.ownedOnly) {
    const owned = new Set(pr.ownedPaths)
    chapters = keepingFiles(chapters, (path) => owned.has(path))
  }
  if (filters.focusMode) chapters = keepingFiles(chapters, (_path, level) => level !== 'low')
  return { ...pr, chapters }
}
