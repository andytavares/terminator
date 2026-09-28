// Where a recipe, role, rule or sensor definition was found.
//
// Split out of `resolve.ts` because that module does the actual filesystem
// walk with `node:fs`/`node:path`, and this type plus its rendering are used
// by renderer components — the Foundry renderer bundle must not reach a Node
// builtin (see tests/renderer/node-free.spec.ts).

export type Rung = 'data-root' | 'repository' | 'built-in'

const RUNG_IN_WORDS: Record<Rung, string> = {
  'data-root': 'your Foundry data folder',
  repository: 'this repository',
  'built-in': 'built into Foundry',
}

/** Where a recipe, role, rule or sensor came from, in words. */
export function rungInWords(rung: Rung): string {
  return RUNG_IN_WORDS[rung]
}
