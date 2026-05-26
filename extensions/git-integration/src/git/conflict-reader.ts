import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'fs/promises'
import type {
  ConflictBlock,
  ConflictFile,
  ConflictSession,
  GitAuthor,
} from '../schemas/merge-flow.schema'

const execFile = promisify(execFileCb)

const GIT_TIMEOUT = 10_000
const CONTEXT_LINES = 4

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd,
    timeout: GIT_TIMEOUT,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  return stdout.trim()
}

/**
 * Parse conflict blocks from raw working-tree file content.
 * Returns a ConflictBlock[] ordered by appearance.
 */
export function readConflictBlocks(
  filePath: string,
  workingTreeContent: string,
  _baseContent: string,
  oursContent: string,
  theirsContent: string
): ConflictBlock[] {
  const lines = workingTreeContent.split('\n')
  const blocks: ConflictBlock[] = []
  let i = 0
  let blockIndex = 0

  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) {
      i++
      continue
    }

    const startLine = i
    const oursLines: string[] = []
    const theirsLines: string[] = []
    let inOurs = true
    const conflictLines: string[] = [lines[i]]

    i++
    while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
      if (lines[i].startsWith('=======')) {
        inOurs = false
        conflictLines.push(lines[i])
      } else if (inOurs) {
        oursLines.push(lines[i])
        conflictLines.push(lines[i])
      } else {
        theirsLines.push(lines[i])
        conflictLines.push(lines[i])
      }
      i++
    }
    // include >>>>>>> line
    if (i < lines.length) {
      conflictLines.push(lines[i])
      i++
    }

    const contextBefore = lines.slice(Math.max(0, startLine - CONTEXT_LINES), startLine)
    const contextAfter = lines.slice(i, Math.min(lines.length, i + CONTEXT_LINES))

    blocks.push({
      blockId: `${filePath}#${blockIndex}`,
      index: blockIndex,
      oursText: oursLines.join('\n'),
      theirsText: theirsLines.join('\n'),
      baseText: '',
      contextBefore,
      contextAfter,
      originalConflictText: conflictLines.join('\n'),
      isResolved: false,
    })

    blockIndex++
  }

  // If caller provided staged index content, use it to populate baseText on each block
  // (best-effort; empty string is valid)
  void oursContent
  void theirsContent

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
  const [baseContent, oursContent, theirsContent] = await Promise.all([
    git(['show', `:1:${filePath}`], repoRoot).catch(() => ''),
    git(['show', `:2:${filePath}`], repoRoot).catch(() => ''),
    git(['show', `:3:${filePath}`], repoRoot).catch(() => ''),
  ])

  const workingTreePath = `${repoRoot}/${filePath}`
  const workingTree = await readFile(workingTreePath, 'utf-8').catch(() => '')

  const blocks = readConflictBlocks(filePath, workingTree, baseContent, oursContent, theirsContent)

  const mergeRef = isRebase ? 'REBASE_HEAD' : 'MERGE_HEAD'

  const [oursAuthor, theirsAuthor, oursSubject, theirsSubject] = await Promise.all([
    getAuthor(repoRoot, 'HEAD', filePath),
    getAuthor(repoRoot, mergeRef, filePath),
    getCommitSubject(repoRoot, 'HEAD', filePath),
    getCommitSubject(repoRoot, mergeRef, filePath),
  ])

  const conflictDescription = [oursSubject, theirsSubject].filter(Boolean).join('; ')

  return {
    filePath,
    conflictCount: blocks.length,
    resolvedCount: 0,
    blocks,
    oursAuthor,
    theirsAuthor,
    conflictDescription,
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
