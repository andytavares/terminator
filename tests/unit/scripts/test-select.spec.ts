import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  ALWAYS_ALL,
  RUNTIME_READS,
  changedInCheckout,
  githubOutputs,
  isAllRequested,
  printArguments,
  selectTests,
  vitestTools,
} from '../../../scripts/test-select.mjs'
import { matchesAny } from '../../../scripts/e2e-select.mjs'
import { makeTempDir } from '../../support/temp-dir'

const REPO_ROOT = resolve(__dirname, '../../..')

const unitSpecs = [
  'extensions/foundry/tests/profile/hints.spec.ts',
  'extensions/foundry/tests/profile/resolve.spec.ts',
  'extensions/foundry/tests/ipc/profile-channels.spec.ts',
  'extensions/foundry/tests/recipe/resolve.spec.ts',
  'tests/unit/scripts/ci-plan.spec.ts',
  'tests/unit/main/store.spec.ts',
]
const e2eSpecs = ['terminal.spec.ts', 'workspace.spec.ts', 'extension-smoke.spec.ts']

/** What vitest would answer: `related` maps a source path to the specs that import it. */
function toolsOf(related: Record<string, string[]> = {}) {
  return {
    unitSpecs: async () => unitSpecs,
    e2eSpecs: () => e2eSpecs,
    relatedSpecs: async (file: string) => related[file] ?? [],
    scanners: async () => [] as string[],
  }
}

const choose = (changed: string[], options: Record<string, unknown> = {}, related = {}) =>
  selectTests({ changed, base: 'abc123', ...options }, toolsOf(related))

describe('what a diff selects', () => {
  it('selects the profile specs when a Foundry hint file changes', async () => {
    const result = await choose(['extensions/foundry/hints/node.yaml'])
    expect(result.mode).toBe('selected')
    expect(result.unit).toEqual(
      expect.arrayContaining([
        'extensions/foundry/tests/profile/hints.spec.ts',
        'extensions/foundry/tests/profile/resolve.spec.ts',
        'extensions/foundry/tests/ipc/profile-channels.spec.ts',
      ])
    )
    expect(result.unit).not.toContain('tests/unit/main/store.spec.ts')
  })

  it('selects the specs that import a changed source file', async () => {
    const result = await choose(['src/main/store.ts'], {}, { 'src/main/store.ts': [unitSpecs[5]] })
    expect(result).toMatchObject({ mode: 'selected', unit: [unitSpecs[5]] })
  })
})

describe('what makes everything run', () => {
  it.each(['tests/setup.ts', 'package-lock.json', 'tests/support/bounds.ts', 'vitest.config.ts'])(
    'runs everything when %s changes',
    async (path) => {
      const result = await choose([path])
      expect(result).toMatchObject({ mode: 'all', unit: [] })
      expect(result.reason).toContain(path)
    }
  )

  it('runs everything when asked with --all, TEST_ALL=1 or on a push to main', async () => {
    for (const asked of [{ allRequested: true }, { isMainPush: true }]) {
      expect(await choose(['docs/a.md'], asked)).toMatchObject({ mode: 'all' })
    }
    expect(isAllRequested(['--all'], {})).toBe(true)
    expect(isAllRequested([], { TEST_ALL: '1' })).toBe(true)
    expect(isAllRequested([], { TEST_ALL: '' })).toBe(false)
  })
})

describe('what makes nothing, or only what is unknown, run', () => {
  it('selects nothing for a docs-only diff', async () => {
    const result = await choose(['docs/adr/123-x.md', 'specs/054/plan.md', 'README.md'])
    expect(result).toMatchObject({ mode: 'none', unit: [], e2e: [] })
  })

  it('runs everything for a source file no spec imports and no map claims', async () => {
    const result = await choose(['src/main/ghost.ts'])
    expect(result.mode).toBe('all')
    expect(result.reason).toContain('src/main/ghost.ts')
  })

  it('always runs a changed spec file', async () => {
    const result = await choose(['tests/unit/main/store.spec.ts'])
    expect(result).toMatchObject({ mode: 'selected', unit: ['tests/unit/main/store.spec.ts'] })
  })

  it('selects the e2e specs the impact map names, with the unit selection', async () => {
    const result = await choose(
      ['extensions/foundry/src/index.ts'],
      {},
      { 'extensions/foundry/src/index.ts': [unitSpecs[0]] }
    )
    expect(result.e2e).toEqual(expect.arrayContaining(['extension-smoke.spec.ts']))
  })
})

describe('what a selection hands to vitest', () => {
  it('prints nothing extra when everything runs, so vitest runs everything', () => {
    expect(printArguments({ mode: 'all', unit: [], base: 'abc' })).toBe('')
  })

  it('prints the spec files and limits coverage to the changed files', () => {
    expect(
      printArguments({ mode: 'selected', unit: ['a.spec.ts', 'b.spec.ts'], base: 'abc' })
    ).toBe('a.spec.ts b.spec.ts --coverage.changed=abc')
  })

  it('prints a filter that matches no spec when nothing is selected', () => {
    const printed = printArguments({ mode: 'none', unit: [], base: 'abc' })
    expect(printed).toContain('--passWithNoTests')
  })

  it('uses one shard for fewer than 100 specs and four otherwise', () => {
    const few = githubOutputs({ mode: 'selected', unit: ['a'], e2e: [], e2eMode: 'none' })
    const many = githubOutputs({
      mode: 'selected',
      unit: Array.from({ length: 100 }, (_, i) => `s${i}`),
      e2e: [],
      e2eMode: 'none',
    })
    const all = githubOutputs({ mode: 'all', unit: [], e2e: [], e2eMode: 'all' })
    expect(few).toContain('shards=[1]\n')
    expect(many).toContain('shards=[1,2,3,4]\n')
    expect(all).toContain('shards=[1,2,3,4]\n')
    expect(few).toContain('run_e2e=false')
    expect(all).toContain('run_unit=true')
  })
})

describe('the files a checkout has changed', () => {
  it('counts commits, uncommitted edits and new files alike, so `npm test` sees work in progress', () => {
    const repo = makeTempDir('test-select-changed-')
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
    git('init', '-q')
    writeFileSync(join(repo, 'edited.ts'), 'one')
    git('add', '.')
    git('commit', '-qm', 'base')
    const base = git('rev-parse', 'HEAD')
    writeFileSync(join(repo, 'committed.ts'), 'two')
    git('add', 'committed.ts')
    git('commit', '-qm', 'next')
    writeFileSync(join(repo, 'edited.ts'), 'changed')
    writeFileSync(join(repo, 'untracked.spec.ts'), 'new')

    expect(changedInCheckout(base, repo).sort()).toEqual([
      'committed.ts',
      'edited.ts',
      'untracked.spec.ts',
    ])
  })
})

describe('the selection against the real repository', () => {
  it('finds the specs that import a source file, through vitest itself', async () => {
    const tools = await vitestTools()
    const related = await tools.relatedSpecs('extensions/foundry/src/profile/hints.ts')
    expect(related).toContain('extensions/foundry/tests/profile/hints.spec.ts')
    expect(await tools.relatedSpecs('src/not-a-file-anyone-imports.ts')).toEqual([])
    await tools.close()
  })

  it('selects the profile specs for a hint file with the real spec list', async () => {
    const tools = await vitestTools()
    const result = await selectTests(
      { changed: ['extensions/foundry/hints/node.yaml'], base: 'abc' },
      tools
    )
    await tools.close()
    expect(result.unit).toContain('extensions/foundry/tests/profile/hints.spec.ts')
  })
})

/** The data files a repository file read points at, found by scanning source, not by a list. */
const SOURCE_FILE = /^(src|extensions\/[^/]+\/src|packages\/[^/]+\/src)\/.*\.tsx?$/
const READS_FILES = /\b(readFileSync|readFile|readdirSync|readdir)\s*\(/
const DATA_FILE = /\.(ya?ml|json|jsonl|html|css|sh|txt|toml)$/
// Words in those files that are not names of files kept in this repository.
const NOT_REPOSITORY_FILES = new Set([
  ...['src', 'tests', 'docs', 'specs', 'scripts', 'dist', 'out'],
  ...['extensions', 'packages', 'extension-sdk', 'extension-ui'],
])
// Settings of the repositories Terminator works in, and tool configuration no source file loads.
const NOT_READ_BY_THE_APP = /^\.|(^|\/)(package|tsconfig[^/]*)\.json$/

function tracked(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
}

function literalsOf(text: string): string[] {
  return [...text.matchAll(/(['"`])([^'"`\n$]{2,80})\1/g)].flatMap((match) => match[2].split('/'))
}

/** Every repository data file whose name or directory a source file that reads files spells. */
function dataFilesReadBy(files: string[]): Map<string, string> {
  const data = files.filter(
    (file) =>
      DATA_FILE.test(file) && !/^(docs|specs)\//.test(file) && !NOT_READ_BY_THE_APP.test(file)
  )
  const readers = new Map<string, string>()
  for (const file of files.filter((f) => SOURCE_FILE.test(f))) {
    const text = readFileSync(resolve(REPO_ROOT, file), 'utf8')
    if (!READS_FILES.test(text)) continue
    for (const word of literalsOf(text)) {
      if (NOT_REPOSITORY_FILES.has(word)) continue
      for (const path of data) {
        if (path.split('/').includes(word)) readers.set(path, `${file} spells "${word}"`)
      }
    }
  }
  return readers
}

describe('RUNTIME_READS lists every data file the source reads', () => {
  it('claims every repository data file a source file reads with fs', () => {
    const claimedBy = [...RUNTIME_READS.flatMap((rule) => rule.globs), ...ALWAYS_ALL]
    const unlisted = [...dataFilesReadBy(tracked())]
      .filter(([path]) => !matchesAny(path, claimedBy))
      .map(([path, why]) => `${path} (${why})`)
    expect(unlisted).toEqual([])
  })

  it('finds a read in the real source, so the scan is not empty', () => {
    expect([...dataFilesReadBy(tracked()).keys()]).toContain('extensions/foundry/hints/node.yaml')
  })
})
