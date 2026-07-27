import { describe, it, expect } from 'vitest'
import { decideAutonomy } from '../../../../../src/main/supervision/autonomy/autonomy-ladder.js'

// The ladder is chosen when an agent is assigned, not renegotiated per prompt
// (FR-041). Each level auto-approves a strictly larger set than the one below.

const ctx = { worktreePath: '/wt/s1', allowedHosts: ['github.com'] }

const decide = (level: 'read' | 'edit' | 'build' | 'ship', tool: string, input: unknown = {}) =>
  decideAutonomy(level, tool, input, ctx)

describe('read', () => {
  it.each(['Read', 'Grep', 'Glob'])('auto-approves %s', (tool) => {
    expect(decide('read', tool)).toMatchObject({ allow: true })
  })

  it.each(['Write', 'Edit', 'Bash'])('prompts for %s', (tool) => {
    expect(decide('read', tool)).toBeNull()
  })
})

describe('edit', () => {
  it('auto-approves a write inside the working copy', () => {
    expect(decide('edit', 'Write', { file_path: '/wt/s1/src/x.ts' })).toMatchObject({ allow: true })
  })

  it('prompts for a write outside the working copy', () => {
    // Editing the operator's primary checkout is not what was authorised.
    expect(decide('edit', 'Write', { file_path: '/repo/src/x.ts' })).toBeNull()
  })

  it('prompts for a write with no discernible path', () => {
    expect(decide('edit', 'Write', {})).toBeNull()
  })

  it('still prompts for shell', () => {
    expect(decide('edit', 'Bash', { command: 'ls' })).toBeNull()
  })

  it('still auto-approves reads, since each level is strictly wider', () => {
    expect(decide('edit', 'Read')).toMatchObject({ allow: true })
  })
})

describe('build', () => {
  it.each(['npm ci', 'npm run build', 'npx vitest run', 'pnpm install'])(
    'auto-approves the local command %s',
    (command) => {
      expect(decide('build', 'Bash', { command })).toMatchObject({ allow: true })
    }
  )

  it('prompts for a push', () => {
    expect(decide('build', 'Bash', { command: 'git push origin main' })).toBeNull()
  })

  it('prompts for a command touching a path outside the working copy', () => {
    expect(decide('build', 'Bash', { command: 'rm -rf /etc/hosts' })).toBeNull()
  })

  it('still auto-approves writes inside the working copy', () => {
    expect(decide('build', 'Edit', { file_path: '/wt/s1/a.ts' })).toMatchObject({ allow: true })
  })
})

describe('ship', () => {
  it('auto-approves a push', () => {
    expect(decide('ship', 'Bash', { command: 'git push origin feat/x' })).toMatchObject({
      allow: true,
    })
  })

  it('auto-approves opening a pull request', () => {
    expect(decide('ship', 'Bash', { command: 'gh pr create --fill' })).toMatchObject({
      allow: true,
    })
  })
})

describe('destructive operations always prompt (FR-041)', () => {
  it.each([
    'rm -rf /',
    'git push --force origin main',
    'DROP TABLE users',
    'kubectl delete namespace prod',
  ])('prompts for %s even at ship', (command) => {
    expect(decide('ship', 'Bash', { command })).toBeNull()
  })
})

describe('host allowlist overrides every level (FR-042)', () => {
  it('auto-approves a request to an allowlisted host at ship', () => {
    expect(decide('ship', 'WebFetch', { url: 'https://github.com/x' })).toMatchObject({
      allow: true,
    })
  })

  it.each(['read', 'edit', 'build', 'ship'] as const)(
    'prompts at %s for a host that is not on the allowlist',
    (level) => {
      // The redis-cli -h prod-cache-01 case: no level of autonomy authorises
      // reaching a host nobody declared.
      expect(decide(level, 'Bash', { command: 'redis-cli -h prod-cache-01' })).toBeNull()
    }
  )

  it('prompts for an off-allowlist URL even at ship', () => {
    expect(decide('ship', 'WebFetch', { url: 'https://evil.example.com/x' })).toBeNull()
  })

  it('prompts for every host when the allowlist is empty', () => {
    expect(
      decideAutonomy(
        'ship',
        'WebFetch',
        { url: 'https://github.com' },
        {
          ...ctx,
          allowedHosts: [],
        }
      )
    ).toBeNull()
  })
})
