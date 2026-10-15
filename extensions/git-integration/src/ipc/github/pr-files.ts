import { z } from 'zod'
import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import type { FileDiff } from '../../schemas/git.schema.js'
import { parsePrFileDiff } from '../../github/pr-review-service.js'
import { runGit, type GitRunOptions } from '../../shell/run-git.js'
import { RepoRoot, parseRemoteRepo } from '../repo-root.js'
import { VALIDATION_ERROR, errorEnvelope } from '../register.js'
import { isOverflow, type GithubContext } from './context.js'
import { measureFiles } from './file-metrics.js'

/** One file of a pull request, at the head the caller last saw when it knows it. */
interface PrFile {
  repoRoot: string
  prNumber: number
  path: string
  baseRef?: string
  headSHA?: string
}

/** Files past this size are not sent to the renderer for context expansion. */
const MAX_FILE_CONTENT_BYTES = 2 * 1024 * 1024
// One byte over the limit, so an oversized file overflows the buffer instead of being read whole.
const FILE_CONTENT_OUTPUT: GitRunOptions = { raw: true, maxBuffer: MAX_FILE_CONTENT_BYTES + 1 }

const PrFilePayload = z.object({
  repoRoot: RepoRoot,
  prNumber: z.number().int().positive(),
  path: z.string().min(1),
})

function pullRef(prNumber: number): string {
  return `refs/remotes/pull/${prNumber}/head`
}

function fetchPullRef(repoRoot: string, prNumber: number): Promise<string> {
  return runGit(repoRoot, [
    'fetch',
    '--force',
    'origin',
    `pull/${prNumber}/head:${pullRef(prNumber)}`,
  ])
}

/** No checkout: GitHub's own per-file patch is the diff. */
async function remoteFileDiff(ctx: GithubContext, file: PrFile): Promise<FileDiff> {
  const filesRaw = await ctx.api(file.repoRoot, {
    path: `repos/{owner}/{repo}/pulls/${file.prNumber}/files`,
    paginate: true,
    jq: '[.[] | {filename, patch}]',
  })
  const files = JSON.parse(filesRaw) as Array<{ filename: string; patch?: string }>
  return parsePrFileDiff(files.find((f) => f.filename === file.path)?.patch ?? '', file.path)
}

/** Where the PR branched from its base; fetched once per head the caller names. */
async function mergeBaseOf(ctx: GithubContext, file: PrFile): Promise<string> {
  const cacheKey = `${file.repoRoot}#${file.prNumber}`
  const cached = ctx.prDiffBases.get(cacheKey)
  if (file.headSHA && cached?.headSHA === file.headSHA) return cached.mergeBase
  await fetchPullRef(file.repoRoot, file.prNumber)
  const viewAtRef = () =>
    ctx.github.pullRequests.view(ctx.target(file.repoRoot), file.prNumber, ['baseRefName'])
  const baseRefName = file.baseRef ?? String((await viewAtRef()).baseRefName)
  // A stacked PR's base is another PR's branch, which a plain checkout has no origin/ ref for.
  await runGit(file.repoRoot, ['fetch', 'origin', baseRefName])
  const args = ['merge-base', `origin/${baseRefName}`, pullRef(file.prNumber)]
  const mergeBase = (await runGit(file.repoRoot, args)).trim()
  if (file.headSHA) ctx.prDiffBases.set(cacheKey, { headSHA: file.headSHA, mergeBase })
  return mergeBase
}

async function loadPrFileDiff(ctx: GithubContext, file: PrFile): Promise<{ diff: FileDiff }> {
  if (parseRemoteRepo(file.repoRoot)) return { diff: await remoteFileDiff(ctx, file) }
  const mergeBase = await mergeBaseOf(ctx, file)
  const range = `${mergeBase}...${pullRef(file.prNumber)}`
  const diffRaw = await runGit(file.repoRoot, ['diff', range, '--', file.path])
  return { diff: parsePrFileDiff(diffRaw, file.path) }
}

/** The file at `ref` in the checkout, fetching the PR head when it is not there yet. */
async function localFileAt(file: PrFile, ref: string): Promise<string> {
  const showAtRef = () =>
    runGit(file.repoRoot, ['show', `${ref}:${file.path}`], FILE_CONTENT_OUTPUT)
  try {
    return await showAtRef()
  } catch (e) {
    if (isOverflow(e)) throw e
    await fetchPullRef(file.repoRoot, file.prNumber)
    return showAtRef()
  }
}

async function readPrFileContent(ctx: GithubContext, file: PrFile, ref: string) {
  let content: string
  if (parseRemoteRepo(file.repoRoot)) {
    const encodedPath = file.path.split('/').map(encodeURIComponent).join('/')
    content = await ctx.api(file.repoRoot, {
      path: `repos/{owner}/{repo}/contents/${encodedPath}?ref=${ref}`,
      accept: 'application/vnd.github.raw+json',
      maxBuffer: FILE_CONTENT_OUTPUT.maxBuffer,
    })
  } else {
    content = await localFileAt(file, ref)
  }
  if (Buffer.byteLength(content) > MAX_FILE_CONTENT_BYTES) return { tooLarge: true }
  return { content }
}

export function prFileChannels(ctx: GithubContext): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'github:pr-file-diff',
      schema: PrFilePayload.extend({
        baseRef: z.string().min(1).optional(),
        headSHA: z.string().min(1).optional(),
      }),
      invalid: VALIDATION_ERROR,
      run: (file) => loadPrFileDiff(ctx, file),
      onError: errorEnvelope,
    }),
    defineChannel({
      channel: 'github:pr-file-content',
      schema: PrFilePayload.extend({ ref: z.string().min(1) }),
      invalid: VALIDATION_ERROR,
      run: ({ ref, ...file }) => readPrFileContent(ctx, file, ref),
      onError: (e) => (isOverflow(e) ? { tooLarge: true } : errorEnvelope(e)),
    }),
    defineChannel({
      channel: 'github:files-metrics',
      schema: z.object({ repoRoot: RepoRoot, paths: z.array(z.string().min(1)) }),
      invalid: VALIDATION_ERROR,
      run: async ({ repoRoot, paths }) => ({ metrics: await measureFiles(repoRoot, paths) }),
      onError: errorEnvelope,
    }),
  ]
}
