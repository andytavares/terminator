import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { registerGitExtensionHandlers, type GitSettings } from '../../src/ipc/git.ipc'
import { bindWorkspaceRoots } from '../../src/ipc/repo-root'
import { channelRegistry } from './support/channels'
import { bindRealShell } from './support/shell'
import { GIT_FREE_ENV, runGitIn } from './support/git-repo'

// The Git view's settings, read by the channels it calls, against real git.
// `--signoff` adds a Signed-off-by trailer naming the committer
// (https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---signoff).

/** A new repository with `count` untracked files and a.txt staged. */
function repoWithFiles(count: number): string {
  const repo = mkdtempSync(join(tmpdir(), 'git-settings-'))
  runGitIn(repo, ['init', '-q', '-b', 'main'])
  runGitIn(repo, ['config', 'user.email', 'e@x.dev'])
  runGitIn(repo, ['config', 'user.name', 'E'])
  for (let i = 0; i < count; i++) writeFileSync(join(repo, `f${i}.txt`), `${i}\n`)
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  runGitIn(repo, ['add', 'a.txt'])
  return repo
}

function channelsWith(settings: GitSettings) {
  const registry = channelRegistry()
  registerGitExtensionHandlers(registry.register, settings)
  return registry.invoke
}

const DEFAULTS: GitSettings = { signOff: () => false, maxDisplayedFiles: () => 500 }

/** A fresh repository with 12 untracked files and a.txt staged, bound as a workspace root. */
function useTempRepo(): { path: string } {
  const repo = { path: '' }
  beforeEach(() => {
    bindRealShell(GIT_FREE_ENV)
    repo.path = repoWithFiles(12)
    bindWorkspaceRoots(() => [repo.path])
  })
  afterEach(() => rmSync(repo.path, { recursive: true, force: true }))
  return repo
}

describe('"Add sign-off to commits", through git:commit', () => {
  const repo = useTempRepo()

  it('signs a commit off when the setting is on', async () => {
    const invoke = channelsWith({ ...DEFAULTS, signOff: () => true })

    await invoke('git:commit', { repoRoot: repo.path, message: 'add a' })

    expect(runGitIn(repo.path, ['log', '-1', '--format=%B'])).toBe(
      'add a\n\nSigned-off-by: E <e@x.dev>'
    )
  })

  it('leaves the message as written when the setting is off', async () => {
    const invoke = channelsWith(DEFAULTS)

    await invoke('git:commit', { repoRoot: repo.path, message: 'add a' })

    expect(runGitIn(repo.path, ['log', '-1', '--format=%B'])).toBe('add a')
  })
})

type Status = { files: unknown[]; truncated: boolean }

describe('"Max displayed changed files", through git:status', () => {
  const repo = useTempRepo()

  it('lists no more changed files than the setting allows, and says there are more', async () => {
    const invoke = channelsWith({ ...DEFAULTS, maxDisplayedFiles: () => 10 })

    const status = (await invoke('git:status', { path: repo.path })) as Status

    expect(status.files).toHaveLength(10)
    expect(status.truncated).toBe(true)
  })

  it('lists every changed file when they fit under the setting', async () => {
    const invoke = channelsWith({ ...DEFAULTS, maxDisplayedFiles: () => 20 })

    const status = (await invoke('git:status', { path: repo.path })) as Status

    expect(status.files).toHaveLength(13)
    expect(status.truncated).toBe(false)
  })
})
