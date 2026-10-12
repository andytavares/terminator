import type { PrChangedFile } from '../../schemas/pr-review.schema'

type RowState = 'viewed' | 'changed' | 'new' | 'default'

/** How a file's row reads in a file list: changed since the last look, new, viewed or neither. */
export function rowState(
  file: PrChangedFile,
  viewedFiles: Set<string>,
  changedSince: Set<string>,
  newSinceLook: Set<string>
): RowState {
  if (changedSince.has(file.path)) return 'changed'
  if (newSinceLook.has(file.path)) return 'new'
  if (viewedFiles.has(file.path)) return 'viewed'
  return 'default'
}
