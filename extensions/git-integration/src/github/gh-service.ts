import type { ExtensionAPI } from '../../../../src/main/extensions/api'
import type { PullRequest } from '../schemas/git.schema'

interface PrCreateInput {
  title: string
  body: string
  base: string
  isDraft: boolean
}

function parseGhPr(raw: unknown): PullRequest {
  const obj = raw as Record<string, unknown>
  return {
    number: Number(obj.number),
    title: String(obj.title ?? ''),
    body: String(obj.body ?? ''),
    url: String(obj.url ?? ''),
    state: mapState(String(obj.state ?? 'OPEN')),
    isDraft: Boolean(obj.isDraft),
    baseRefName: String(obj.baseRefName ?? 'main'),
    headRefName: String(obj.headRefName ?? ''),
  }
}

function mapState(state: string): 'open' | 'closed' | 'merged' {
  switch (state.toUpperCase()) {
    case 'CLOSED':
      return 'closed'
    case 'MERGED':
      return 'merged'
    default:
      return 'open'
  }
}

export class GhService {
  constructor(private readonly api: ExtensionAPI) {}

  async checkAuth(cwd: string): Promise<boolean> {
    try {
      const result = await this.api.shell.exec({
        command: 'gh',
        args: ['auth', 'status'],
        cwd,
      })
      return result.exitCode === 0
    } catch {
      return false
    }
  }

  async getPrForBranch(cwd: string, _branch: string): Promise<PullRequest | null> {
    const result = await this.api.shell.exec({
      command: 'gh',
      args: ['pr', 'view', '--json', 'number,title,body,url,state,isDraft,baseRefName,headRefName'],
      cwd,
    })

    if (result.exitCode !== 0) {
      if (result.stderr.includes('no pull requests found') || result.stderr.includes('not found')) {
        return null
      }
      throw new Error(`gh pr view failed: ${result.stderr}`)
    }

    return parseGhPr(JSON.parse(result.stdout))
  }

  async createPr(cwd: string, input: PrCreateInput): Promise<PullRequest> {
    const args = [
      'pr',
      'create',
      '--title',
      input.title,
      '--body',
      input.body,
      '--base',
      input.base,
      '--json',
      'number,title,body,url,state,isDraft,baseRefName,headRefName',
    ]
    if (input.isDraft) args.push('--draft')

    const result = await this.api.shell.exec({ command: 'gh', args, cwd })

    if (result.exitCode !== 0) {
      throw new Error(`gh pr create failed: ${result.stderr}`)
    }

    return parseGhPr(JSON.parse(result.stdout))
  }
}
