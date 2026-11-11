import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { blastRadius } from '../../src/review/blast-radius'
import type { ParsedPrFile } from '../../src/review/parsed-file'
import { bindRealShell } from '../unit/support/shell'
import { GIT_FREE_ENV, runGitIn } from '../unit/support/git-repo'

// The PR changes the body of parseToken (line 2 of src/token.ts). formatToken, in the same file,
// is unchanged and must not be reported.
const TOKEN_TS = `export function parseToken(raw: string): string {
  return raw.trim().toLowerCase()
}

export function formatToken(token: string): string {
  return token.toUpperCase()
}
`

const FILES: Record<string, string> = {
  'src/token.ts': TOKEN_TS,
  'src/login.ts': `import { parseToken } from './token'\nexport const login = (raw: string) => parseToken(raw)\n`,
  'src/refresh.ts': `import { parseToken } from './token'\nexport function refresh(raw: string) {\n  return parseToken(raw)\n}\n`,
  'tools/token.py': `def parseToken(raw):\n    return raw.strip()\n`,
  'docs/tokens.md': `# Tokens\n\nCall parseToken before you store a token.\n`,
}

const TOKEN_TS_DIFF: ParsedPrFile = {
  path: 'src/token.ts',
  additions: 1,
  deletions: 1,
  diff: {
    path: 'src/token.ts',
    isBinary: false,
    truncated: false,
    hunks: [
      {
        header: '@@ -1,3 +1,3 @@',
        lines: [
          {
            type: 'context',
            content: 'export function parseToken(raw: string): string {',
            oldLineNumber: 1,
            newLineNumber: 1,
          },
          { type: 'remove', content: '  return raw.trim()', oldLineNumber: 2, newLineNumber: null },
          {
            type: 'add',
            content: '  return raw.trim().toLowerCase()',
            oldLineNumber: null,
            newLineNumber: 2,
          },
          { type: 'context', content: '}', oldLineNumber: 3, newLineNumber: 3 },
        ],
      },
    ],
  },
}

/** A new repository with FILES committed; answers its path and the commit's sha. */
function repoWithFiles(): { repo: string; headSha: string } {
  const repo = mkdtempSync(join(tmpdir(), 'blast-radius-'))
  runGitIn(repo, ['init', '-q', '-b', 'main'])
  runGitIn(repo, ['config', 'user.email', 'e@x.dev'])
  runGitIn(repo, ['config', 'user.name', 'E'])
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(join(repo, dirname(path)), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  runGitIn(repo, ['add', '.'])
  runGitIn(repo, ['commit', '-q', '-m', 'tokens'])
  return { repo, headSha: runGitIn(repo, ['rev-parse', 'HEAD']) }
}

describe('blastRadius()', () => {
  let clone: { repo: string; headSha: string }

  beforeEach(() => {
    bindRealShell(GIT_FREE_ENV)
    clone = repoWithFiles()
  })
  afterEach(() => rmSync(clone.repo, { recursive: true, force: true }))

  it('counts the files that use a changed definition and the other files that define its name', async () => {
    const results = await blastRadius(clone.repo, clone.headSha, [TOKEN_TS_DIFF])

    expect(results).toEqual([
      { name: 'parseToken', path: 'src/token.ts', usedIn: 3, alsoDefinedIn: 1 },
    ])
  })

  it('answers a second call for the same clone and sha from its cache, without git', async () => {
    const first = await blastRadius(clone.repo, clone.headSha, [TOKEN_TS_DIFF])
    rmSync(clone.repo, { recursive: true, force: true })

    const second = await blastRadius(clone.repo, clone.headSha, [TOKEN_TS_DIFF])

    expect(first).toEqual([
      { name: 'parseToken', path: 'src/token.ts', usedIn: 3, alsoDefinedIn: 1 },
    ])
    expect(second).toEqual(first)
  })

  it('answers no results when the head sha is not in the clone', async () => {
    const missingSha = '0123456789abcdef0123456789abcdef01234567'

    expect(await blastRadius(clone.repo, missingSha, [TOKEN_TS_DIFF])).toEqual([])
  })
})
