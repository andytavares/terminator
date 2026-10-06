// Free of Node builtins: the Floor and the hall render it.
/** The pull request number a GitHub address ends in; 0 when it has none. */
export function pullNumber(url: string): number {
  return Number(/\/pull\/(\d+)/.exec(url)?.[1] ?? 0)
}
