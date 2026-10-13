import { z } from 'zod'
import { join } from 'path'
import { existsSync } from 'fs'
import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { runGit } from '../../shell/run-git.js'
import { findTestLocations, symbolsForBlock } from '../../review/test-locations.js'
import { RepoRoot } from '../repo-root.js'
import { VALIDATION_ERROR, errorEnvelope } from '../register.js'
import { catchError, PullRequestPayload, RepoRootPayload, type GithubContext } from './context.js'

interface CompareResponse {
  ahead_by?: number
  files?: Array<{ filename: string; status: string; patch?: string }>
}

const PrCreatePayload = z.object({
  repoRoot: RepoRoot,
  title: z.string().min(1),
  body: z.string(),
  base: z.string().min(1),
  head: z.string().min(1),
  draft: z.boolean(),
})

const ComparePayload = z.object({
  repoRoot: RepoRoot,
  fromSha: z.string().min(1),
  toSha: z.string().min(1),
})

const TestsForBlockPayload = z.object({
  repoRoot: RepoRoot,
  headSHA: z.string().min(1),
  path: z.string().min(1),
  code: z.string(),
  hunkHeader: z.string().optional(),
})

/** What changed between two heads of a PR (S1). */
async function compareHeads(ctx: GithubContext, payload: z.infer<typeof ComparePayload>) {
  const { owner, repo } = await ctx.ownerAndName(payload.repoRoot)
  const raw = await ctx.api(payload.repoRoot, {
    path: `repos/${owner}/${repo}/compare/${payload.fromSha}...${payload.toSha}`,
  })
  const data = JSON.parse(raw) as CompareResponse
  const files = (data.files ?? []).map((f) => ({
    path: f.filename,
    status: f.status,
    patch: f.patch ?? '',
  }))
  return { rewritten: false, commits: data.ahead_by ?? 0, files }
}

/** A compare GitHub cannot make means the old head is gone: the history was rewritten. */
function compareError(e: unknown) {
  const msg = String(e)
  const gone = ['404', 'No common ancestor', 'Not Found'].some((marker) => msg.includes(marker))
  if (gone) return { rewritten: true, commits: 0, files: [] }
  return catchError(e)
}

/** Clones a repository into `folder` for diff-only review of an uncloned PR. */
async function cloneRepo(ctx: GithubContext, repo: string, folder: string) {
  if (!existsSync(folder)) return { error: 'FOLDER_NOT_FOUND' }
  const name = repo.split('/')[1] ?? repo
  await ctx.github.repositories.clone(ctx.target(folder), repo, name)
  return { repoRoot: join(folder, name) }
}

const PR_STATUS_FIELDS = [
  'number',
  'title',
  'body',
  'url',
  'state',
  'isDraft',
  'baseRefName',
  'headRefName',
]

/** The open pull request from the checkout's branch, which Open PR shows instead of opening a second. */
async function openPullRequestForBranch(ctx: GithubContext, repoRoot: string) {
  const branch = (await runGit(repoRoot, ['branch', '--show-current'])).trim()
  if (!branch) return { pr: null }
  const pr = await ctx.github.pullRequests.view(ctx.target(repoRoot), branch, PR_STATUS_FIELDS)
  return { pr: pr.state === 'OPEN' ? { ...pr, state: 'open' } : null }
}

// gh fails when the branch has no pull request; the dialog then opens one.
function prStatusChannel(ctx: GithubContext): ChannelSpec {
  return defineChannel({
    channel: 'git:pr-status',
    schema: RepoRootPayload,
    invalid: VALIDATION_ERROR,
    run: ({ repoRoot }) => openPullRequestForBranch(ctx, repoRoot),
    onError: () => ({ pr: null }),
  })
}

function prCreateChannel(ctx: GithubContext): ChannelSpec {
  return defineChannel({
    channel: 'github:pr-create',
    schema: PrCreatePayload,
    invalid: VALIDATION_ERROR,
    run: ({ repoRoot, ...pullRequest }) =>
      ctx.github.pullRequests.create(ctx.target(repoRoot), pullRequest),
    onError: (e) => ({ error: e instanceof Error ? e.message : String(e) }),
  })
}

function markReadyChannel(ctx: GithubContext): ChannelSpec {
  return defineChannel({
    channel: 'github:pr-mark-ready',
    schema: PullRequestPayload,
    invalid: VALIDATION_ERROR,
    run: async ({ repoRoot, prNumber }) => {
      await ctx.github.pullRequests.markReady(ctx.target(repoRoot), prNumber)
      return { ok: true }
    },
    onError: catchError,
  })
}

function updateBranchChannel(ctx: GithubContext): ChannelSpec {
  return defineChannel({
    channel: 'github:pr-update-branch',
    schema: PullRequestPayload,
    invalid: VALIDATION_ERROR,
    run: async ({ repoRoot, prNumber }) => {
      await ctx.github.pullRequests.updateBranch(ctx.target(repoRoot), prNumber)
      return { ok: true }
    },
    onError: catchError,
  })
}

function pullRequestVerbs(ctx: GithubContext): ChannelSpec[] {
  return [
    prStatusChannel(ctx),
    prCreateChannel(ctx),
    markReadyChannel(ctx),
    updateBranchChannel(ctx),
  ]
}

function currentUserChannel(ctx: GithubContext): ChannelSpec {
  return defineChannel({
    channel: 'github:current-user',
    schema: RepoRootPayload,
    invalid: VALIDATION_ERROR,
    run: async ({ repoRoot }) => ({ login: await ctx.viewer(repoRoot) }),
    onError: errorEnvelope,
  })
}

function compareChannel(ctx: GithubContext): ChannelSpec {
  return defineChannel({
    channel: 'github:pr-compare',
    schema: ComparePayload,
    invalid: VALIDATION_ERROR,
    run: (payload) => compareHeads(ctx, payload),
    onError: compareError,
  })
}

function testsForBlockChannel(): ChannelSpec {
  return defineChannel({
    channel: 'github:tests-for-block',
    schema: TestsForBlockPayload,
    invalid: VALIDATION_ERROR,
    run: async (block) => {
      const symbols = await symbolsForBlock(block.path, block.code, block.hunkHeader)
      const { repoRoot, headSHA } = block
      const locations = await findTestLocations({ repoRoot, headSHA }, symbols, runGit)
      return { symbols, locations }
    },
  })
}

function cloneRepoChannel(ctx: GithubContext): ChannelSpec {
  return defineChannel({
    channel: 'github:clone-repo',
    schema: z.object({ repo: z.string().min(1), folder: z.string().min(1) }),
    invalid: VALIDATION_ERROR,
    run: ({ repo, folder }) => cloneRepo(ctx, repo, folder),
    onError: catchError,
  })
}

function lookupChannels(ctx: GithubContext): ChannelSpec[] {
  return [
    currentUserChannel(ctx),
    compareChannel(ctx),
    testsForBlockChannel(),
    cloneRepoChannel(ctx),
  ]
}

export function prActionChannels(ctx: GithubContext): ChannelSpec[] {
  return [...pullRequestVerbs(ctx), ...lookupChannels(ctx)]
}
