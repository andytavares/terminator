import { readFile } from 'fs/promises'
import type {
  ConflictBlock,
  ConflictFile,
  ConflictSession,
  GitAuthor,
} from '../schemas/merge-flow.schema'
import { runGit } from '../shell/run-git.js'

const GIT_TIMEOUT = 10_000
const CONTEXT_LINES = 4

function git(args: string[], cwd: string): Promise<string> {
  return runGit(cwd, args, { timeoutMs: GIT_TIMEOUT })
}

/** A conflict's lines: ours, theirs, the whole marked region, and the lines around it. */
interface ConflictRegion {
  end: number
  ours: string[]
  theirs: string[]
  marked: string[]
  contextBefore: string[]
  contextAfter: string[]
}

/** The conflict opening at `start`, through its `>>>>>>>` line or the end of the file. */
function conflictRegionAt(lines: string[], start: number): ConflictRegion {
  const ours: string[] = []
  const theirs: string[] = []
  const marked = [lines[start]]
  let inOurs = true
  let end = start + 1
  for (; end < lines.length && !lines[end].startsWith('>>>>>>>'); end++) {
    if (lines[end].startsWith('=======')) inOurs = false
    else if (inOurs) ours.push(lines[end])
    else theirs.push(lines[end])
    marked.push(lines[end])
  }
  // include >>>>>>> line
  if (end < lines.length) marked.push(lines[end++])
  const contextBefore = lines.slice(Math.max(0, start - CONTEXT_LINES), start)
  const contextAfter = lines.slice(end, Math.min(lines.length, end + CONTEXT_LINES))
  return { end, ours, theirs, marked, contextBefore, contextAfter }
}

function conflictBlockFrom(filePath: string, index: number, region: ConflictRegion): ConflictBlock {
  return {
    blockId: `${filePath}#${index}`,
    index,
    oursText: region.ours.join('\n'),
    theirsText: region.theirs.join('\n'),
    baseText: '',
    contextBefore: region.contextBefore,
    contextAfter: region.contextAfter,
    originalConflictText: region.marked.join('\n'),
    isResolved: false,
  }
}

/** Parses the conflict blocks of a working-tree file, in the order they appear. */
export function readConflictBlocks(filePath: string, workingTreeContent: string): ConflictBlock[] {
  const lines = workingTreeContent.split('\n')
  const blocks: ConflictBlock[] = []
  let i = 0
  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) {
      i++
      continue
    }
    const region = conflictRegionAt(lines, i)
    blocks.push(conflictBlockFrom(filePath, blocks.length, region))
    i = region.end
  }
  return blocks
}

export async function listConflictedFiles(repoRoot: string): Promise<string[]> {
  const out = await git(['diff', '--name-only', '--diff-filter=U'], repoRoot)
  return out.length === 0 ? [] : out.split('\n').filter(Boolean)
}

async function detectRebase(repoRoot: string): Promise<boolean> {
  try {
    await git(['rev-parse', '-q', '--verify', 'REBASE_HEAD'], repoRoot)
    return true
  } catch {
    return false
  }
}

async function getAuthor(repoRoot: string, ref: string, filePath: string): Promise<GitAuthor> {
  try {
    const raw = await git(['log', '--format=%an|%H|%ai', '-1', ref, '--', filePath], repoRoot)
    const [name, commitHash, timestamp] = raw.split('|')
    if (name && commitHash && timestamp) {
      return { name: name.trim(), commitHash: commitHash.trim(), timestamp: timestamp.trim() }
    }
  } catch {
    // fall through to default
  }
  return { name: 'Unknown', commitHash: 'unknown', timestamp: new Date().toISOString() }
}

async function getCommitSubject(repoRoot: string, ref: string, filePath: string): Promise<string> {
  try {
    return await git(['log', '--format=%s', '-1', ref, '--', filePath], repoRoot)
  } catch {
    return ''
  }
}

async function buildConflictFile(
  repoRoot: string,
  filePath: string,
  isRebase: boolean
): Promise<ConflictFile> {
  const workingTree = await readFile(`${repoRoot}/${filePath}`, 'utf-8').catch(() => '')
  const blocks = readConflictBlocks(filePath, workingTree)
  const mergeRef = isRebase ? 'REBASE_HEAD' : 'MERGE_HEAD'
  const [oursAuthor, theirsAuthor, oursSubject, theirsSubject] = await Promise.all([
    getAuthor(repoRoot, 'HEAD', filePath),
    getAuthor(repoRoot, mergeRef, filePath),
    getCommitSubject(repoRoot, 'HEAD', filePath),
    getCommitSubject(repoRoot, mergeRef, filePath),
  ])
  return {
    filePath,
    conflictCount: blocks.length,
    resolvedCount: 0,
    blocks,
    oursAuthor,
    theirsAuthor,
    conflictDescription: [oursSubject, theirsSubject].filter(Boolean).join('; '),
  }
}

async function getBranchName(repoRoot: string, ref: string): Promise<string> {
  try {
    return await git(['rev-parse', '--abbrev-ref', ref], repoRoot)
  } catch {
    return ''
  }
}

export async function buildConflictSession(repoRoot: string): Promise<ConflictSession> {
  const [filePaths, isRebase] = await Promise.all([
    listConflictedFiles(repoRoot),
    detectRebase(repoRoot),
  ])

  const mergeRef = isRebase ? 'REBASE_HEAD' : 'MERGE_HEAD'

  const [files, oursBranch, theirsBranch] = await Promise.all([
    Promise.all(filePaths.map((fp) => buildConflictFile(repoRoot, fp, isRebase))),
    getBranchName(repoRoot, 'HEAD'),
    getBranchName(repoRoot, mergeRef),
  ])

  files.sort((a, b) => b.conflictCount - a.conflictCount)

  const totalConflicts = files.reduce((sum, f) => sum + f.conflictCount, 0)

  return {
    repoRoot,
    files,
    totalConflicts,
    totalResolved: 0,
    isRebase,
    startedAt: new Date().toISOString(),
    oursBranch: oursBranch || undefined,
    theirsBranch: theirsBranch || undefined,
  }
}
