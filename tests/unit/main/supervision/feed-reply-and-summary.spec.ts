import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createFeedLog } from '../../../../src/main/supervision/feed/feed-log.js'
import { createFeedReply } from '../../../../src/main/supervision/feed/feed-reply.js'
import {
  detectMilestones,
  describeMilestone,
  summariseMilestone,
} from '../../../../src/main/supervision/feed/milestone-summary.js'
import { createCodeHostClient } from '../../../../src/main/codehost/codehost-client.js'
import type { SessionEvent } from '../../../../src/main/supervision/events/session-event.js'

let dir: string
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'feed-reply-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function harness() {
  const log = createFeedLog(join(dir, 'feed.jsonl'))
  const sendToSession = vi.fn().mockResolvedValue(undefined)
  const replier = createFeedReply({ log, sendToSession, now: () => 9_000 })
  return { log, sendToSession, replier }
}

describe('feed reply (FR-093)', () => {
  it('delivers the reply to the originating session', async () => {
    const { log, sendToSession, replier } = harness()
    const entry = log.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'Ran tests' })
    await expect(replier.reply(entry.id, 'try the other approach')).resolves.toMatchObject({
      ok: true,
    })
    expect(sendToSession).toHaveBeenCalledWith('s1', 'try the other approach')
  })

  it('records the reply so the feed holds both halves of the conversation', async () => {
    const { log, replier } = harness()
    const entry = log.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'Ran tests' })
    await replier.reply(entry.id, 'try again')
    expect(log.list().at(-1)?.summary).toContain('You replied: try again')
  })

  it('refuses to reply to a console entry — nobody is listening', async () => {
    const { log, sendToSession, replier } = harness()
    const entry = log.post({
      at: 1_000,
      sessionId: 's1',
      author: 'console',
      summary: 'Terminator: no tool activity',
    })
    const result = await replier.reply(entry.id, 'hello?')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('written by Terminator')
    expect(sendToSession).not.toHaveBeenCalled()
  })

  it('refuses an empty reply', async () => {
    const { log, replier } = harness()
    const entry = log.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'x' })
    await expect(replier.reply(entry.id, '   ')).resolves.toMatchObject({ ok: false })
  })

  it('reports an unknown entry rather than throwing', async () => {
    const { replier } = harness()
    await expect(replier.reply('nope', 'hi')).resolves.toMatchObject({ ok: false })
  })

  it('reports a session that has since ended', async () => {
    const log = createFeedLog(join(dir, 'feed.jsonl'))
    const replier = createFeedReply({
      log,
      sendToSession: vi.fn().mockRejectedValue(new Error('session has ended')),
      now: () => 9_000,
    })
    const entry = log.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'x' })
    await expect(replier.reply(entry.id, 'hi')).resolves.toMatchObject({
      ok: false,
      reason: 'session has ended',
    })
  })
})

const tool = (at: number, toolName = 'Read', targetPath?: string): SessionEvent => ({
  kind: 'tool_started',
  sessionId: 's1',
  toolName,
  callId: `c${at}`,
  isShell: false,
  targetPath,
  at,
})

describe('milestone detection (FR-091)', () => {
  it('marks the start of a session', () => {
    const milestones = detectMilestones([
      { kind: 'session_started', sessionId: 's1', transcriptPath: '/t', cwd: '/r', at: 1_000 },
    ])
    expect(milestones.map((m) => m.kind)).toEqual(['started'])
  })

  it('marks being unblocked after the operator answered', () => {
    const milestones = detectMilestones([
      {
        kind: 'permission_resolved',
        sessionId: 's1',
        requestId: 'r1',
        decision: 'allow',
        at: 2_000,
      },
    ])
    expect(milestones.map((m) => m.kind)).toEqual(['unblocked'])
  })

  it('marks a chunk of sustained work, so a long absence is not two lines', () => {
    const events = Array.from({ length: 12 }, (_, i) => tool(1_000 + i))
    expect(detectMilestones(events).map((m) => m.kind)).toEqual(['progressed'])
  })

  it('does not mark every tool call as a milestone', () => {
    expect(detectMilestones([tool(1_000), tool(1_001)])).toEqual([])
  })

  it('marks finishing and failing distinctly', () => {
    expect(
      detectMilestones([
        { kind: 'session_ended', sessionId: 's1', outcome: 'success', at: 3_000 },
      ])[0].kind
    ).toBe('finished')
    expect(
      detectMilestones([{ kind: 'session_ended', sessionId: 's1', outcome: 'error', at: 3_000 }])[0]
        .kind
    ).toBe('failed')
  })

  it('carries the tools and files involved for the summariser to describe', () => {
    const events = [
      ...Array.from({ length: 11 }, (_, i) => tool(1_000 + i, 'Edit', 'src/a.ts')),
      tool(1_100, 'Bash'),
    ]
    const [milestone] = detectMilestones(events)
    expect(milestone.toolNames.sort()).toEqual(['Bash', 'Edit'])
    expect(milestone.filesTouched).toEqual(['src/a.ts'])
  })

  it('is deterministic, so summaries can be memoised against it', () => {
    const events = [tool(1), tool(2)]
    expect(detectMilestones(events)).toEqual(detectMilestones(events))
  })
})

describe('milestone summaries', () => {
  const milestone = {
    sessionId: 's1',
    kind: 'progressed' as const,
    at: 1_000,
    toolNames: ['Edit'],
    filesTouched: ['a.ts', 'b.ts'],
  }

  it('writes a serviceable sentence with no model call at all', () => {
    expect(describeMilestone(milestone)).toBe('Worked across 2 files using Edit.')
  })

  it('uses a supplied summariser when there is one', async () => {
    await expect(
      summariseMilestone(milestone, { summarise: async () => 'Refactored the session store.' })
    ).resolves.toBe('Refactored the session store.')
  })

  it('falls back to the deterministic text when the summariser fails', async () => {
    // A summariser that is down costs prose, not the record.
    await expect(
      summariseMilestone(milestone, {
        summarise: async () => {
          throw new Error('model unavailable')
        },
      })
    ).resolves.toBe(describeMilestone(milestone))
  })

  it('falls back when the summariser returns nothing useful', async () => {
    await expect(summariseMilestone(milestone, { summarise: async () => '   ' })).resolves.toBe(
      describeMilestone(milestone)
    )
  })
})

describe('code-host client (FR-056)', () => {
  const ok = (stdout: string) => vi.fn().mockResolvedValue({ ok: true, stdout, stderr: '' })

  it('reads an existing pull request for a branch', async () => {
    const client = createCodeHostClient(
      ok(JSON.stringify({ number: 7, url: 'https://x/7', state: 'OPEN', title: 'Add ULID' }))
    )
    await expect(client.pullRequestFor('/repo', 'feat/x')).resolves.toMatchObject({
      number: 7,
      state: 'OPEN',
    })
  })

  it('reports no pull request as null rather than an error', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ ok: false, stdout: '', stderr: 'no pull requests found' })
    await expect(createCodeHostClient(run).pullRequestFor('/repo', 'feat/x')).resolves.toBeNull()
  })

  it('merges a branch', async () => {
    const run = ok('')
    await expect(createCodeHostClient(run).merge('/repo', 'feat/x')).resolves.toMatchObject({
      ok: true,
    })
    expect(run).toHaveBeenCalledWith('gh', ['pr', 'merge', 'feat/x', '--squash'], '/repo')
  })

  it('reports why a merge failed rather than swallowing it', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'not mergeable' })
    await expect(createCodeHostClient(run).merge('/repo', 'feat/x')).resolves.toMatchObject({
      ok: false,
      reason: 'not mergeable',
    })
  })

  it('reports the host unavailable when gh is not authenticated', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'not logged in' })
    await expect(createCodeHostClient(run).isAvailable('/repo')).resolves.toBe(false)
  })

  it('reports the host available when gh is authenticated', async () => {
    await expect(createCodeHostClient(ok('')).isAvailable('/repo')).resolves.toBe(true)
  })

  it('still resolves check state through the same client', async () => {
    const client = createCodeHostClient(ok(JSON.stringify([{ state: 'SUCCESS' }])))
    await expect(client.checkState('/repo', 'feat/x')).resolves.toBe('passing')
  })

  it('never throws when gh is missing entirely', async () => {
    const run = vi.fn().mockRejectedValue(new Error('ENOENT'))
    const client = createCodeHostClient(run)
    await expect(client.isAvailable('/repo')).resolves.toBe(false)
    await expect(client.pullRequestFor('/repo', 'b')).resolves.toBeNull()
    await expect(client.merge('/repo', 'b')).resolves.toMatchObject({ ok: false })
    await expect(client.checkState('/repo', 'b')).resolves.toBe('unavailable')
  })
})

describe('the real command runner', () => {
  it('reports success and captures stdout', async () => {
    const { runCommand } = await import('../../../../src/main/codehost/codehost-client.js')
    const result = await runCommand('echo', ['hello-from-gh'], process.cwd())
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('hello-from-gh')
  })

  it('reports a non-zero exit rather than throwing', async () => {
    const { runCommand } = await import('../../../../src/main/codehost/codehost-client.js')
    const result = await runCommand('sh', ['-c', 'echo boom >&2; exit 4'], process.cwd())
    expect(result.ok).toBe(false)
    expect(result.stderr).toContain('boom')
  })

  it('reports a missing binary as a failure, never an exception', async () => {
    const { runCommand } = await import('../../../../src/main/codehost/codehost-client.js')
    const result = await runCommand('definitely-not-a-binary-xyz', [], process.cwd())
    expect(result.ok).toBe(false)
  })

  it('passes arguments as an array, so a path with spaces is not a shell injection', async () => {
    const { runCommand } = await import('../../../../src/main/codehost/codehost-client.js')
    const result = await runCommand('echo', ['a b; rm -rf /'], process.cwd())
    expect(result.stdout.trim()).toBe('a b; rm -rf /')
  })
})

describe('creating a pull request', () => {
  it('creates then reads the pull request back', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, stdout: '', stderr: '' })
      .mockResolvedValueOnce({
        ok: true,
        stdout: JSON.stringify({ number: 9, url: 'https://x/9', state: 'OPEN', title: 'T' }),
        stderr: '',
      })
    const client = createCodeHostClient(run)
    await expect(client.createPullRequest('/repo', 'feat/x', 'T')).resolves.toMatchObject({
      number: 9,
    })
  })

  it('returns null when creation fails, rather than pretending it worked', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'already exists' })
    await expect(
      createCodeHostClient(run).createPullRequest('/repo', 'feat/x', 'T')
    ).resolves.toBeNull()
  })

  it('returns null when gh cannot be run at all', async () => {
    const run = vi.fn().mockRejectedValue(new Error('ENOENT'))
    await expect(
      createCodeHostClient(run).createPullRequest('/repo', 'feat/x', 'T')
    ).resolves.toBeNull()
  })

  it('returns null for unparseable pull-request output', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, stdout: 'not json', stderr: '' })
    await expect(createCodeHostClient(run).pullRequestFor('/repo', 'b')).resolves.toBeNull()
  })

  it('returns null when the output has no pull-request number', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, stdout: '{"url":"x"}', stderr: '' })
    await expect(createCodeHostClient(run).pullRequestFor('/repo', 'b')).resolves.toBeNull()
  })
})

describe('code-host client field defaults', () => {
  const ok = (stdout: string) => vi.fn().mockResolvedValue({ ok: true, stdout, stderr: '' })

  it('fills in missing pull-request fields rather than rendering undefined', async () => {
    // gh has omitted fields across versions; a partial payload must still yield
    // a usable object rather than blanks in the UI.
    const client = createCodeHostClient(ok(JSON.stringify({ number: 3 })))
    await expect(client.pullRequestFor('/repo', 'b')).resolves.toEqual({
      number: 3,
      url: '',
      state: 'OPEN',
      title: '',
    })
  })

  it('reports a merge failure with no stderr using a stated fallback', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, stdout: '', stderr: '   ' })
    await expect(createCodeHostClient(run).merge('/repo', 'b')).resolves.toMatchObject({
      ok: false,
      reason: 'gh pr merge exited non-zero',
    })
  })

  it('stringifies a non-Error rejection rather than losing it', async () => {
    const run = vi.fn().mockRejectedValue('gh vanished')
    await expect(createCodeHostClient(run).merge('/repo', 'b')).resolves.toMatchObject({
      ok: false,
      reason: 'gh vanished',
    })
  })
})
