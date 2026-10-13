/** Uncommitted change volume for one working tree, staged and unstaged. */
export interface ChangeStats {
  added: number
  removed: number
  files: number
}
