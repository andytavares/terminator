import { GitCommandError, runGit } from '../shell/run-git'
import type { ParsedPrFile } from './parsed-file'
import { tagsOf, type SnippetTags } from './symbols'

/** A definition the PR changes, with how many other files use it and define its name. */
export interface BlastRadius {
  name: string
  path: string
  usedIn: number
  alsoDefinedIn: number
}

interface Revision {
  repoRoot: string
  headSha: string
}

interface ChangedDefinition {
  name: string
  path: string
}

/** A file `git grep` found a changed name in; `words` is the fallback when it has no tags. */
interface CandidateFile {
  path: string
  tags: SnippetTags | null
  words: Set<string>
}

const CACHE_LIMIT = 20
const GREP_NAMES_PER_RUN = 200
const SHOW_MAX_BUFFER = 20 * 1024 * 1024
const cache = new Map<string, BlastRadius[]>()

function addedLineNumbers(file: ParsedPrFile): number[] {
  return file.diff.hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.type === 'add' && line.newLineNumber !== null)
    .map((line) => line.newLineNumber as number)
}

function fileAt(at: Revision, path: string): Promise<string> {
  const args = ['show', `${at.headSha}:${path}`]
  return runGit(at.repoRoot, args, { raw: true, maxBuffer: SHOW_MAX_BUFFER })
}

async function changedDefinitions(at: Revision, file: ParsedPrFile): Promise<ChangedDefinition[]> {
  const added = addedLineNumbers(file)
  if (added.length === 0) return []
  const tags = await tagsOf(file.path, await fileAt(at, file.path))
  const names = new Set(
    (tags?.definitions ?? [])
      .filter((d) => added.some((line) => line >= d.startLine && line <= d.endLine))
      .map((d) => d.name)
  )
  return [...names].map((name) => ({ name, path: file.path }))
}

/** `git grep` exits 1 with no stderr when nothing matches. */
async function grepRun(at: Revision, names: string[]): Promise<string> {
  const patterns = names.flatMap((name) => ['-e', name])
  const args = [
    '-c',
    'core.quotepath=false',
    'grep',
    '-l',
    '-w',
    '-F',
    ...patterns,
    at.headSha,
    '--',
  ]
  try {
    return await runGit(at.repoRoot, args, { maxBuffer: SHOW_MAX_BUFFER })
  } catch (error) {
    if (error instanceof GitCommandError && error.stderr === '') return ''
    throw error
  }
}

async function grepFiles(at: Revision, names: string[]): Promise<string[]> {
  const prefix = `${at.headSha}:`
  const paths = new Set<string>()
  for (let start = 0; start < names.length; start += GREP_NAMES_PER_RUN) {
    const output = await grepRun(at, names.slice(start, start + GREP_NAMES_PER_RUN))
    for (const line of output.split('\n')) {
      if (line.startsWith(prefix)) paths.add(line.slice(prefix.length))
    }
  }
  return [...paths]
}

/** A file that cannot be read at the revision (e.g. a submodule path) is left out. */
async function candidateFile(at: Revision, path: string): Promise<CandidateFile | null> {
  const text = await fileAt(at, path).catch(() => null)
  if (text === null) return null
  return { path, tags: await tagsOf(path, text), words: new Set(text.split(/\W+/)) }
}

/** Git processes started at once while reading candidate files. */
const READ_BATCH = 16

async function candidateFiles(at: Revision, paths: string[]): Promise<CandidateFile[]> {
  const files: CandidateFile[] = []
  for (let i = 0; i < paths.length; i += READ_BATCH) {
    const batch = paths.slice(i, i + READ_BATCH)
    const read = await Promise.all(batch.map((path) => candidateFile(at, path)))
    files.push(...read.filter((file): file is CandidateFile => file !== null))
  }
  return files
}

function references(candidate: CandidateFile, name: string): boolean {
  if (!candidate.tags) return candidate.words.has(name)
  return candidate.tags.references.some((reference) => reference.name === name)
}

function radiusOf(definition: ChangedDefinition, candidates: CandidateFile[]): BlastRadius {
  const { name, path } = definition
  const others = candidates.filter((candidate) => candidate.path !== path)
  return {
    name,
    path,
    usedIn: others.filter((candidate) => references(candidate, name)).length,
    alsoDefinedIn: others.filter((candidate) =>
      candidate.tags?.definitions.some((d) => d.name === name)
    ).length,
  }
}

async function scanRevision(at: Revision, files: ParsedPrFile[]): Promise<BlastRadius[]> {
  const definitions = (await Promise.all(files.map((file) => changedDefinitions(at, file)))).flat()
  if (definitions.length === 0) return []
  const names = [...new Set(definitions.map((definition) => definition.name))]
  const paths = await grepFiles(at, names)
  const candidates = await candidateFiles(at, paths)
  return definitions.map((definition) => radiusOf(definition, candidates))
}

function cacheResults(key: string, results: BlastRadius[]): void {
  cache.set(key, results)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
}

/** For each definition the PR's added lines touch: the files at `headSha` that reference its name,
 *  by tags, or by a word match where the file's language has no tags. Never throws. */
export async function blastRadius(
  repoRoot: string,
  headSha: string,
  files: ParsedPrFile[]
): Promise<BlastRadius[]> {
  const key = `${repoRoot}\0${headSha}`
  const cached = cache.get(key)
  if (cached) return cached
  try {
    const results = await scanRevision({ repoRoot, headSha }, files)
    cacheResults(key, results)
    return results
  } catch (err) {
    console.warn('[git-integration] blastRadius: git failed', err)
    return []
  }
}

/** The widest changed definition of `path`, or null when the PR changes none there. */
export function fileBlastRadius(
  results: BlastRadius[],
  path: string
): { usedIn: number; alsoDefinedIn: number } | null {
  const own = results.filter((result) => result.path === path)
  if (own.length === 0) return null
  const widest = own.reduce((best, result) => (result.usedIn > best.usedIn ? result : best))
  return { usedIn: widest.usedIn, alsoDefinedIn: widest.alsoDefinedIn }
}
