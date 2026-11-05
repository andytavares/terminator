/** `yes` when `condition` holds, else `no`. Both are evaluated, so keep them cheap and safe. */
export function choose<T>(condition: unknown, yes: T, no: T): T {
  if (condition) return yes
  return no
}

/** "src/app/" and "main.ts" from "src/app/main.ts". */
export function splitPath(filePath: string): { dir: string; name: string } {
  const slash = filePath.lastIndexOf('/')
  if (slash === -1) return { dir: '', name: filePath }
  return { dir: filePath.slice(0, slash + 1), name: filePath.slice(slash + 1) }
}

/** An error's message, or the thrown value as text. */
export function errorMessageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** What the user reads for each error code `git:commit` answers. */
export const COMMIT_ERRORS: Record<string, string> = {
  NOTHING_TO_COMMIT: 'Nothing staged to commit. Stage at least one file first.',
  EMPTY_MESSAGE: 'Commit message cannot be empty.',
  TIMEOUT: 'Commit timed out — a pre-commit hook may have hung.',
  HOOK_FAILED: 'Pre-commit hooks failed.',
}
