type RunGit = (cwd: string, args: string[]) => Promise<string>

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const TEST_PATHSPECS = ['*.spec.*', '*.test.*', '*_test.*', 'test_*', '**/__tests__/**', 'tests/**']

/**
 * Which of `symbols` any test file in the checkout mentions, in one grep.
 * A repo with no checkout (a `gh:` root) has nothing to grep.
 */
export async function findTestReferencesInRepo(
  repoRoot: string,
  symbols: string[],
  runGit: RunGit
): Promise<Set<string>> {
  const names = symbols.filter((s) => IDENTIFIER.test(s))
  if (names.length === 0 || repoRoot.startsWith('gh:')) return new Set()
  try {
    const out = await runGit(repoRoot, [
      'grep',
      '-h',
      '-o',
      '-w',
      '-E',
      names.join('|'),
      '--',
      ...TEST_PATHSPECS,
    ])
    return new Set(out.split('\n').filter((w) => names.includes(w)))
  } catch {
    // git grep exits 1 when nothing matches.
    return new Set()
  }
}
