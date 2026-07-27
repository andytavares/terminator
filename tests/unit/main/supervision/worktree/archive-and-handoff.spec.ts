import { describe, it, expect, vi } from 'vitest'
import { mayArchive } from '../../../../../src/main/supervision/worktree/archive.js'
import { openInEditor } from '../../../../../src/main/supervision/worktree/editor-handoff.js'

describe('archive guard (FR-036)', () => {
  it.each(['ready', 'failed', 'merged'] as const)('allows archiving a %s session', (state) => {
    expect(mayArchive(state)).toMatchObject({ allowed: true })
  })

  it.each(['starting', 'working', 'needs_input', 'stalled'] as const)(
    'refuses to archive a %s session',
    (state) => {
      const decision = mayArchive(state)
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toContain(state)
    }
  )

  it('refuses to archive an unknown session', () => {
    // We do not know whether the agent is still working, and guessing wrong
    // destroys the worktree under it.
    expect(mayArchive('unknown')).toMatchObject({ allowed: false })
  })
})

describe('editor handoff (FR-044)', () => {
  const ok = () => vi.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' })

  it('opens the worktree with the configured editor', async () => {
    const run = ok()
    await expect(
      openInEditor({ editorCommand: 'code', worktreePath: '/wt/s1', run })
    ).resolves.toMatchObject({ ok: true })
    expect(run).toHaveBeenCalledWith('code', ['/wt/s1'], '/wt/s1')
  })

  it('supports an editor command with flags', async () => {
    const run = ok()
    await openInEditor({ editorCommand: 'code --new-window', worktreePath: '/wt/s1', run })
    expect(run).toHaveBeenCalledWith('code', ['--new-window', '/wt/s1'], '/wt/s1')
  })

  it('passes the path as an argument rather than through a shell', async () => {
    // A worktree path with a space or a metacharacter must not become command
    // injection.
    const run = ok()
    await openInEditor({ editorCommand: 'code', worktreePath: '/wt/a b; rm -rf /', run })
    expect(run).toHaveBeenCalledWith('code', ['/wt/a b; rm -rf /'], '/wt/a b; rm -rf /')
  })

  it('states that no editor is configured rather than failing silently', async () => {
    const result = await openInEditor({ editorCommand: null, worktreePath: '/wt/s1', run: ok() })
    expect(result).toMatchObject({ ok: false })
    expect(result.reason).toContain('no external editor')
  })

  it('treats a blank editor command as unconfigured', async () => {
    await expect(
      openInEditor({ editorCommand: '   ', worktreePath: '/wt/s1', run: ok() })
    ).resolves.toMatchObject({ ok: false })
  })

  it('reports the editor stderr when it exits non-zero', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'command not found' })
    const result = await openInEditor({ editorCommand: 'nope', worktreePath: '/wt/s1', run })
    expect(result).toMatchObject({ ok: false, reason: 'command not found' })
  })

  it('reports a thrown error rather than propagating it', async () => {
    const run = vi.fn().mockRejectedValue(new Error('ENOENT'))
    await expect(
      openInEditor({ editorCommand: 'code', worktreePath: '/wt/s1', run })
    ).resolves.toMatchObject({ ok: false, reason: 'ENOENT' })
  })
})
