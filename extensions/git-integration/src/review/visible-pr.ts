import type { Chapter, PrReviewDetail } from '../schemas/pr-review.schema.js'

export interface PrFilters {
  ownedOnly: boolean
}

/** `chapters` keeping the files `keep` accepts, without the chapters left empty; when that would
 *  leave nothing, all of them, so a filter never blanks the review. */
function keepingFiles(chapters: Chapter[], keep: (path: string) => boolean) {
  const kept = chapters
    .map((c) => ({ ...c, files: c.files.filter((f) => keep(f.path)) }))
    .filter((c) => c.files.length > 0)
  return kept.length > 0 ? kept : chapters
}

/** The PR as the reviewer chose to see it: only the files they own, when they ask for that. */
export function visiblePr(pr: PrReviewDetail, filters: PrFilters): PrReviewDetail {
  if (!filters.ownedOnly) return pr
  const owned = new Set(pr.ownedPaths)
  return { ...pr, chapters: keepingFiles(pr.chapters, (path) => owned.has(path)) }
}
