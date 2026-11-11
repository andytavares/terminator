import type { Chapter, PrChangedFile } from '../schemas/pr-review.schema.js'

/** How the review screen lays a PR out: one page, one stream with chapter headers, or a page per
 *  chapter. */
export type ReviewBand = 'page' | 'stream' | 'chapters'

/** Fewer changed lines than this fit on one page. */
const STREAM_MIN_CHANGED_LINES = 100
/** More changed lines than this get a page per chapter. */
const STREAM_MAX_CHANGED_LINES = 800

function changedLines(files: Pick<PrChangedFile, 'additions' | 'deletions'>[]): number {
  return files.reduce((sum, f) => sum + f.additions + f.deletions, 0)
}

export function reviewBand(files: Pick<PrChangedFile, 'additions' | 'deletions'>[]): ReviewBand {
  const lines = changedLines(files)
  if (lines < STREAM_MIN_CHANGED_LINES) return 'page'
  if (lines <= STREAM_MAX_CHANGED_LINES) return 'stream'
  return 'chapters'
}

export interface HunkProgress {
  read: number
  total: number
}

/** The read hunk headers per path, and the hunk headers of each file whose diff has loaded. */
export interface HunkSets {
  viewedHunks: Record<string, string[]>
  fileHunks: Record<string, string[]>
}

/** A file's hunks read and hunks in all. Before its diff loads the file's hunks are unknown, so
 *  it counts as its read hunks, and at least one. */
function fileProgress(path: string, sets: HunkSets): HunkProgress {
  const read = sets.viewedHunks[path] ?? []
  const known = sets.fileHunks[path]
  if (!known) return { read: read.length, total: Math.max(read.length, 1) }
  return { read: read.filter((header) => known.includes(header)).length, total: known.length }
}

export function filesHunkProgress(paths: string[], sets: HunkSets): HunkProgress {
  return paths.reduce(
    (sum, path) => {
      const one = fileProgress(path, sets)
      return { read: sum.read + one.read, total: sum.total + one.total }
    },
    { read: 0, total: 0 }
  )
}

export function chapterHunkProgress(chapter: Chapter, sets: HunkSets): HunkProgress {
  return filesHunkProgress(
    chapter.files.map((f) => f.path),
    sets
  )
}

export function percentRead(progress: HunkProgress): number {
  if (progress.total === 0) return 0
  return Math.round((progress.read / progress.total) * 100)
}
