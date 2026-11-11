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

/** The read hunk headers per path, the hunk headers of each file whose diff has loaded, and the
 *  files marked viewed. */
export interface HunkSets {
  viewedHunks: Record<string, string[]>
  fileHunks: Record<string, string[]>
  viewedFiles: Set<string>
}

/** Before a file's diff loads, its total is the hunk count of its patch. */
function unloadedProgress(file: PrChangedFile, read: string[]): HunkProgress {
  const total = Math.max(file.hunkCount, read.length, 1)
  return { read: Math.min(read.length, total), total }
}

/** A file's hunks read and hunks in all; a viewed file counts as wholly read. */
function fileProgress(file: PrChangedFile, sets: HunkSets): HunkProgress {
  const read = sets.viewedHunks[file.path] ?? []
  const known = sets.fileHunks[file.path]
  const progress = known
    ? { read: read.filter((header) => known.includes(header)).length, total: known.length }
    : unloadedProgress(file, read)
  return sets.viewedFiles.has(file.path)
    ? { read: progress.total, total: progress.total }
    : progress
}

export function filesHunkProgress(files: PrChangedFile[], sets: HunkSets): HunkProgress {
  return files.reduce(
    (sum, file) => {
      const one = fileProgress(file, sets)
      return { read: sum.read + one.read, total: sum.total + one.total }
    },
    { read: 0, total: 0 }
  )
}

export function chapterHunkProgress(chapter: Chapter, sets: HunkSets): HunkProgress {
  return filesHunkProgress(chapter.files, sets)
}

export function percentRead(progress: HunkProgress): number {
  if (progress.total === 0) return 0
  return Math.round((progress.read / progress.total) * 100)
}

interface Span {
  top: number
  bottom: number
}

/** The file section to make active: the first one reaching below `view.top` (the line under the
 *  sticky header), unless `pinned`, the section the keys moved to, is still on screen; a short
 *  last file never reaches the top. */
export function sectionToActivate(
  view: Span,
  boxes: Array<Span & { path: string }>,
  pinned: string | null
): string | undefined {
  const kept = boxes.find((b) => b.path === pinned && b.top < view.bottom && b.bottom > view.top)
  return (kept ?? boxes.find((b) => b.bottom > view.top))?.path
}
