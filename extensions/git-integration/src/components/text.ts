/** `word` when `count` is one, else its plural (`word` + "s" unless `many` is given). */
export function plural(count: number, word: string, many = `${word}s`): string {
  if (count === 1) return word
  return many
}

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
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
