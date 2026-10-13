import { basename, join } from 'path'
import { readFile } from 'fs/promises'
import { runGit } from '../../shell/run-git.js'
import { parseRemoteRepo } from '../repo-root.js'
import { isOverflow } from './context.js'

export interface FileMetrics {
  churn90d: number
  blastRadius: number
  topImporters: string[]
  importerCount: number
  testFilePresent: boolean
  patchCoverage: number | null
}

type CoverageSummary = Record<string, { lines?: { pct?: number } }>

const REMOTE_FILE_METRICS: FileMetrics = {
  churn90d: 0,
  blastRadius: 0,
  topImporters: [],
  importerCount: 0,
  testFilePresent: false,
  patchCoverage: null,
}

const BATCH_MAX_BUFFER = 20 * 1024 * 1024

const TEST_PATH_PATTERNS = [
  /\.(spec|test)\.[^.]+$/, // JS/TS: foo.spec.ts, foo.test.js
  /(?:^|\/)test_[^/]+$/, // Python/Ruby: test_foo.py
  /_test\.[^.]+$/, // Go/Python: foo_test.go, foo_test.py
  /_spec\.[^.]+$/, // Ruby: foo_spec.rb
  /Tests?\.[^.]+$/, // Java/Kotlin/C#: FooTest.java, FooTests.cs
  /Spec\.[^.]+$/, // JVM/C#: FooSpec.kt
]

function matchesTestPattern(path: string): boolean {
  return TEST_PATH_PATTERNS.some((re) => re.test(path))
}

const stemOf = (path: string) => basename(path, `.${basename(path).split('.').pop()}`)

// Matches import/require/from statements only, not plain-text mentions in markdown or comments.
// No extension allowlist: any language with that syntax is found; prose files never match.
const importPatternFor = (path: string) => `(from|require|import).*['"./]` + stemOf(path) + `['"/]`

function emptyImporters(paths: string[]): Map<string, string[]> {
  return new Map(paths.map((path) => [path, []]))
}

/** One `git grep` per path: the fallback when the batched search fails or overflows. */
async function importersPerFile(repoRoot: string, paths: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  for (const path of paths) {
    const args = ['grep', '-rl', '--extended-regexp', importPatternFor(path)]
    const raw = await runGit(repoRoot, args).catch(() => '')
    result.set(
      path,
      raw.split('\n').filter((l) => l && l !== path)
    )
  }
  return result
}

/** Which paths each `file\0line` grep match imports. */
function importersFromGrep(raw: string, paths: string[]): Map<string, string[]> {
  const matchers = paths.map((path) => ({ path, re: new RegExp(importPatternFor(path)) }))
  const found = new Map(paths.map((p) => [p, new Set<string>()]))
  for (const line of raw.split('\n')) {
    const nul = line.indexOf('\0')
    if (nul < 0) continue
    const [file, text] = [line.slice(0, nul), line.slice(nul + 1)]
    for (const { path, re } of matchers) {
      if (file !== path && re.test(text)) found.get(path)!.add(file)
    }
  }
  return new Map(paths.map((path) => [path, [...found.get(path)!]]))
}

/** The files that import each path, from one search for every stem (per-file searches if it overflows). */
async function importersFor(repoRoot: string, paths: string[]): Promise<Map<string, string[]>> {
  if (paths.length === 0) return new Map()
  const stems = [...new Set(paths.map(stemOf))]
  const pattern = `(from|require|import).*['"./](${stems.join('|')})['"/]`
  try {
    const args = ['grep', '-n', '--null', '--extended-regexp', pattern]
    return importersFromGrep(await runGit(repoRoot, args, { maxBuffer: BATCH_MAX_BUFFER }), paths)
  } catch (e) {
    // No match exits 1 with nothing on stdout; any other failure is retried per file.
    if (!isOverflow(e) && (e as { code?: number } | null)?.code === 1) return emptyImporters(paths)
    return importersPerFile(repoRoot, paths)
  }
}

// Whether a test file exists for the path, answered from one listing of every test file.
function hasTestFile(testFiles: string[], path: string): boolean {
  const stem = stemOf(path).replace(/[.+^${}()|[\]\\?]/g, '\\$&')
  const re = new RegExp(`^.*/${stem}.*\\.(spec|test)\\..*$`)
  return testFiles.some((f) => re.test(f))
}

/** A file read at most once, however often it is asked for; null when it cannot be read. */
function readOnce(path: string): () => Promise<string | null> {
  let pending: Promise<string | null> | undefined
  return () =>
    (pending ??= readFile(path, 'utf-8').then(
      (raw) => raw,
      () => null
    ))
}

/** Line coverage from an Istanbul/nyc summary, whose keys are absolute or relative paths. */
function summaryCoverage(raw: string, repoRoot: string, filePath: string): number | null {
  const summary = JSON.parse(raw) as CoverageSummary
  for (const key of [filePath, join(repoRoot, filePath), `./${filePath}`]) {
    if (summary[key]?.lines?.pct != null) return Math.round(summary[key].lines!.pct!)
  }
  const match = Object.entries(summary).find(([k]) => k.endsWith(filePath))
  if (!match) return null
  return Math.round(match[1]?.lines?.pct ?? 0)
}

function lcovCoverage(raw: string, filePath: string): number | null {
  for (const section of raw.split('end_of_record')) {
    if (!section.includes(filePath)) continue
    const linesFound = Number(section.match(/LF:(\d+)/)?.[1] ?? '0')
    const linesHit = Number(section.match(/LH:(\d+)/)?.[1] ?? '0')
    if (linesFound > 0) return Math.round((linesHit / linesFound) * 100)
  }
  return null
}

/** Reads each coverage report at most once, however many paths are looked up. */
function coverageReader(repoRoot: string): (filePath: string) => Promise<number | null> {
  const summaryText = readOnce(join(repoRoot, 'coverage', 'coverage-summary.json'))
  const lcovText = readOnce(join(repoRoot, 'coverage', 'lcov.info'))
  return async (filePath) => {
    try {
      const raw = await summaryText()
      const pct = raw === null ? null : summaryCoverage(raw, repoRoot, filePath)
      if (pct !== null) return pct
    } catch {
      /* parse error — fall through to lcov */
    }
    const raw = await lcovText()
    if (raw === null) return null
    return lcovCoverage(raw, filePath)
  }
}

/** Commits in the last 90 days touching each wanted path, from one `git log`. */
async function churnFor(repoRoot: string, wanted: Set<string>): Promise<Map<string, number>> {
  const args = [
    '-c',
    'core.quotepath=false',
    'log',
    '--no-renames',
    '--name-only',
    '--format=%H',
    '--since=90 days ago',
  ]
  const raw = await runGit(repoRoot, args, { maxBuffer: BATCH_MAX_BUFFER })
  const churn = new Map<string, number>()
  for (const line of raw.split('\n')) {
    const file = line.trim()
    if (file && !/^[0-9a-f]{40}$/.test(file) && wanted.has(file)) {
      churn.set(file, (churn.get(file) ?? 0) + 1)
    }
  }
  return churn
}

/** Every test file in the checkout; none needed when every path is itself a test. */
async function testFileList(repoRoot: string, paths: string[]): Promise<string[]> {
  if (!paths.some((p) => !matchesTestPattern(p))) return []
  const args = ['ls-files', '--', '**/*.spec.*', '**/*.test.*']
  const raw = await runGit(repoRoot, args, { maxBuffer: BATCH_MAX_BUFFER }).catch(() => '')
  return raw.split('\n').filter(Boolean)
}

/** Metrics for every path from three git processes in total, not three per path. */
export async function measureFiles(
  repoRoot: string,
  paths: string[]
): Promise<Record<string, FileMetrics>> {
  if (parseRemoteRepo(repoRoot))
    return Object.fromEntries(paths.map((p) => [p, REMOTE_FILE_METRICS]))
  const [churn, importersByPath, testList] = await Promise.all([
    churnFor(repoRoot, new Set(paths)),
    importersFor(repoRoot, paths),
    testFileList(repoRoot, paths),
  ])
  const coverage = coverageReader(repoRoot)
  const metrics: Record<string, FileMetrics> = {}
  for (const path of paths) {
    const importers = importersByPath.get(path) ?? []
    metrics[path] = {
      churn90d: churn.get(path) ?? 0,
      blastRadius: importers.length,
      topImporters: importers,
      importerCount: importers.length,
      testFilePresent: matchesTestPattern(path) || hasTestFile(testList, path),
      patchCoverage: await coverage(path),
    }
  }
  return metrics
}
