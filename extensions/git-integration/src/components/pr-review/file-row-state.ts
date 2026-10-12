import type { PrChangedFile } from '../../schemas/pr-review.schema'

type RowState = 'viewed' | 'changed' | 'new' | 'default'

/** The review's file sets a row's state is read from. */
interface FileMarks {
  viewedFiles: Set<string>
  changedSince: Set<string>
  newSinceLook: Set<string>
}

/** How a file's row reads in a file list: changed since the last look, new, viewed or neither. */
export function rowState(file: PrChangedFile, marks: FileMarks): RowState {
  if (marks.changedSince.has(file.path)) return 'changed'
  if (marks.newSinceLook.has(file.path)) return 'new'
  if (marks.viewedFiles.has(file.path)) return 'viewed'
  return 'default'
}
