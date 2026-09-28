import { analyseSnippet, symbolFromHunkHeader } from './symbols.js'

type RunGit = (cwd: string, args: string[]) => Promise<string>

export interface TestLocation {
  path: string
  line: number
  symbol: string
  text: string
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const TEST_PATHSPECS = ['*.spec.*', '*.test.*', '*_test.*', 'test_*', '**/__tests__/**', 'tests/**']
const MAX_LOCATIONS = 50

/** The names a block of code defines, or failing that the function its hunk sits inside. */
export async function symbolsForBlock(
  path: string,
  code: string,
  hunkHeader?: string
): Promise<string[]> {
  const analysis = await analyseSnippet(path, code)
  const names = new Set<string>()
  for (const d of analysis?.definitions ?? []) names.add(d)
  for (const f of analysis?.functions ?? []) names.add(f.name)
  if (names.size === 0 && hunkHeader) {
    const enclosing = symbolFromHunkHeader(hunkHeader)
    if (enclosing) names.add(enclosing)
  }
  return [...names].filter((n) => IDENTIFIER.test(n))
}

function parseGrepLine(line: string, prefix: string, names: string[]): TestLocation | null {
  const rest = prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line
  const match = /^(.+?):(\d+):(.*)$/.exec(rest)
  if (!match) return null
  const text = match[3].trim()
  const symbol = names.find((n) => new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(text))
  if (!symbol) return null
  return { path: match[1], line: Number(match[2]), symbol, text }
}

/**
 * Every line of a test file that mentions one of `symbols`, searched at the
 * PR's head commit so tests added by the PR are found. Falls back to the
 * checkout when that commit has not been fetched.
 */
export async function findTestLocations(
  repoRoot: string,
  headSHA: string,
  symbols: string[],
  runGit: RunGit
): Promise<TestLocation[]> {
  const names = symbols.filter((s) => IDENTIFIER.test(s))
  if (names.length === 0 || repoRoot.startsWith('gh:')) return []
  const grep = (rev: string | null) =>
    runGit(repoRoot, [
      'grep',
      '-n',
      '-w',
      '-E',
      names.join('|'),
      ...(rev ? [rev] : []),
      '--',
      ...TEST_PATHSPECS,
    ])
  let out: string
  let prefix = ''
  try {
    out = await grep(headSHA)
    prefix = `${headSHA}:`
  } catch (e) {
    // git grep exits 1 when nothing matches; anything else means the commit is not here.
    if ((e as { code?: number }).code === 1) return []
    try {
      out = await grep(null)
    } catch {
      return []
    }
  }
  const locations: TestLocation[] = []
  for (const line of out.split('\n')) {
    const loc = parseGrepLine(line, prefix, names)
    if (loc) locations.push(loc)
    if (locations.length === MAX_LOCATIONS) break
  }
  return locations
}
