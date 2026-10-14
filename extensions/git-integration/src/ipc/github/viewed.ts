import { z } from 'zod'
import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { RepoRoot } from '../repo-root.js'
import { VALIDATION_ERROR } from '../register.js'
import { catchError, type GithubContext } from './context.js'

/** A pull request, with its GraphQL node id when the caller already knows it. */
interface PrNode {
  repoRoot: string
  prNumber: number
  nodeId?: string
}

const PR_ID_QUERY =
  'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){id}}}'

const ViewedPayload = z.object({
  repoRoot: RepoRoot,
  prNumber: z.number().int().positive(),
  nodeId: z.string().min(1).optional(),
  viewed: z.boolean(),
})

async function nodeIdOfPullRequest(ctx: GithubContext, pr: PrNode): Promise<string> {
  if (pr.nodeId) return pr.nodeId
  const { owner, repo } = await ctx.ownerAndName(pr.repoRoot)
  const idRaw = await ctx.api(pr.repoRoot, {
    path: 'graphql',
    fields: { query: PR_ID_QUERY, o: owner, r: repo },
    typedFields: { n: pr.prNumber },
  })
  return (JSON.parse(idRaw) as { data: { repository: { pullRequest: { id: string } } } }).data
    .repository.pullRequest.id
}

function viewedMutation(viewed: boolean): string {
  if (viewed) return 'markFileAsViewed'
  return 'unmarkFileAsViewed'
}

/** Marks (or unmarks) paths viewed on GitHub (S1): one request, one aliased mutation per path. */
async function setViewed(
  ctx: GithubContext,
  pr: PrNode,
  change: { paths: string[]; viewed: boolean }
) {
  const { paths, viewed } = change
  const id = await nodeIdOfPullRequest(ctx, pr)
  const mutation = viewedMutation(viewed)
  const variables = paths.map((_, i) => `$p${i}:String!`).join(',')
  const calls = paths
    .map((_, i) => `m${i}:${mutation}(input:{pullRequestId:$id,path:$p${i}}){clientMutationId}`)
    .join(' ')
  await ctx.api(pr.repoRoot, {
    path: 'graphql',
    fields: {
      query: `mutation($id:ID!,${variables}){${calls}}`,
      id,
      ...Object.fromEntries(paths.map((p, i) => [`p${i}`, p])),
    },
  })
  return { ok: true }
}

/** The single-path form, kept as GitHub's own unaliased mutation. */
async function setOneViewed(
  ctx: GithubContext,
  pr: PrNode,
  change: { path: string; viewed: boolean }
) {
  const { path, viewed } = change
  const id = await nodeIdOfPullRequest(ctx, pr)
  const query = `mutation($id:ID!,$p:String!){${viewedMutation(viewed)}(input:{pullRequestId:$id,path:$p}){clientMutationId}}`
  await ctx.api(pr.repoRoot, { path: 'graphql', fields: { query, id, p: path } })
  return { ok: true }
}

export function viewedChannels(ctx: GithubContext): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'github:file-viewed-set',
      schema: ViewedPayload.extend({ path: z.string().min(1) }),
      invalid: VALIDATION_ERROR,
      run: ({ path, viewed, ...pr }) => setOneViewed(ctx, pr, { path, viewed }),
      onError: catchError,
    }),
    defineChannel({
      channel: 'github:files-viewed-set',
      schema: ViewedPayload.extend({ paths: z.array(z.string().min(1)).min(1) }),
      invalid: VALIDATION_ERROR,
      run: ({ paths, viewed, ...pr }) => setViewed(ctx, pr, { paths, viewed }),
      onError: catchError,
    }),
  ]
}
