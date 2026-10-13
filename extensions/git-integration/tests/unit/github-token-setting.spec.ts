import { describe, it, expect } from 'vitest'
import { dispatchChannel } from '@terminator/extension-sdk'
import { activateCapturingChannels, freshGlobalStorage } from './support/activate'

// "GitHub token" is handed to gh as GH_TOKEN by the core's api.github, which
// takes it as `token` (https://cli.github.com/manual/gh_help_environment).

/** Asks who the signed-in user is, through activation's own channel, with these settings. */
async function askViewer(settings: Record<string, unknown>) {
  const { channels, githubApi } = activateCapturingChannels(
    undefined,
    freshGlobalStorage(),
    settings
  )
  const spec = channels.find((c) => c.spec.channel === 'github:current-user')!.spec
  await dispatchChannel(spec, { repoRoot: 'gh:acme/widgets' })
  return githubApi.mock.calls[0][0] as { token?: string }
}

describe('the "GitHub token" setting', () => {
  it('is the token gh runs with', async () => {
    const call = await askViewer({ 'terminator.git-integration.git.githubToken': 'ghp_e2e' })
    expect(call.token).toBe('ghp_e2e')
  })

  it('leaves gh to its own sign-in when it is empty', async () => {
    const call = await askViewer({ 'terminator.git-integration.git.githubToken': '' })
    expect(call).not.toHaveProperty('token')
  })
})
