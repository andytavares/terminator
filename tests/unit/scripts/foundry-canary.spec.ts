import { describe, expect, it } from 'vitest'
import {
  canaryRequired,
  isCanaryBranch,
  leftovers,
  linearKey,
  canaryPackageVersions,
  remoteCanaryBranches,
  verdict,
} from '../../../scripts/foundry-canary.mjs'

const lock = (acp: string, code: string) =>
  JSON.stringify({
    packages: {
      'node_modules/@agentclientprotocol/claude-agent-acp': { version: acp },
      'node_modules/@anthropic-ai/claude-code': { version: code },
    },
  })

const unchanged = lock('1.0.0', '2.0.0')
const needs = (changed: string[], after = unchanged) =>
  canaryRequired({ changed, lockBefore: unchanged, lockAfter: after })

describe('canaryRequired: paths', () => {
  it.each([
    'extensions/foundry/src/runtime/supervised-runner.ts',
    'src/main/agents/acp/agent-service.ts',
    'extensions/foundry/src/line/integrate.ts',
    'extensions/foundry/src/line/worktree.ts',
    'extensions/foundry/src/line/commit.ts',
    'extensions/foundry/src/trackers/issues-port.ts',
    'extensions/foundry/recipes/direct.yaml',
    'extensions/foundry/src/forge/intake-turn.ts',
    'extensions/foundry/src/line/node-session.ts',
  ])('requires it for %s', (path) => expect(needs([path])).toBe(true))

  it('does not require it for other files', () => {
    expect(
      needs(['extensions/foundry/src/line/execute-run.ts', 'docs/x.md', 'package-lock.json'])
    ).toBe(false)
  })
})

describe('canaryRequired: lock', () => {
  it('requires it when the lock changes the Claude adapter or Claude Code version', () => {
    expect(needs(['package-lock.json'], lock('1.0.1', '2.0.0'))).toBe(true)
    expect(needs(['package-lock.json'], lock('1.0.0', '2.1.0'))).toBe(true)
  })

  it('reads no versions from a lock without the packages', () => {
    expect(canaryPackageVersions('{}')).toEqual([undefined, undefined])
  })
})

describe('leftovers', () => {
  it('finds a canary branch on the remote from ls-remote output', () => {
    const out = 'abc123\trefs/heads/canary/ord-1\ndef456\trefs/heads/main\n'
    expect(remoteCanaryBranches(out)).toEqual(['canary/ord-1'])
  })
})

describe('leftovers: what a run leaves', () => {
  it('names every pull request, branch, order folder, worktree and ticket left', () => {
    const found = leftovers({
      pullRequests: [{ number: 7, headRefName: 'canary/ord-1' }],
      remoteBranches: ['canary/ord-1'],
      localBranches: ['canary/ord-1', 'main'],
      orderFolders: ['/r/.foundry/orders/ORD-1'],
      worktrees: ['/r/.foundry/orders/ORD-1/worktrees/terminator'],
      tickets: ['TAV-9'],
    })
    expect(found).toHaveLength(6)
    expect(found.join('\n')).toContain('pull request #7')
  })

  it('finds nothing on a clean repository', () => {
    expect(
      leftovers({
        pullRequests: [],
        remoteBranches: [],
        localBranches: ['main'],
        orderFolders: [],
        worktrees: [],
        tickets: [],
      })
    ).toEqual([])
  })

  it('tells canary branches from others', () => {
    expect(isCanaryBranch('canary/ord-1')).toBe(true)
    expect(isCanaryBranch('feature/canary/x')).toBe(false)
  })
})

describe('verdict', () => {
  it('passes only when nothing failed, nothing is left and the app log holds no error', () => {
    expect(verdict({ failure: null, left: [], logErrors: [] })).toEqual([])
  })

  it('fails on anything left, an error in the app log or a failed stage', () => {
    expect(verdict({ failure: null, left: ['branch canary/x'], logErrors: [] })).toEqual([
      'left behind: branch canary/x',
    ])
    expect(
      verdict({
        failure: null,
        left: [],
        logErrors: ['2026-10-29T10:00:00.000Z ERROR [main] boom'],
      })
    ).toHaveLength(1)
    expect(verdict({ failure: 'run did not finish', left: [], logErrors: [] })).toEqual([
      'run did not finish',
    ])
  })
})

describe('linearKey', () => {
  it('takes the key from LINEAR_API_KEY, trimmed', () => {
    expect(linearKey({ LINEAR_API_KEY: ' lin_api_123 \n' })).toBe('lin_api_123')
  })

  it('says what to set when the key is missing or blank', () => {
    expect(() => linearKey({})).toThrow('Set LINEAR_API_KEY')
    expect(() => linearKey({ LINEAR_API_KEY: '  ' })).toThrow('Set LINEAR_API_KEY')
  })
})
