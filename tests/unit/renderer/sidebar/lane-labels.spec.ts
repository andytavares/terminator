import { describe, it, expect } from 'vitest'
import { laneLabels } from '../../../../src/renderer/sidebar/lane-labels'

const lane = (repoRoot: string, branch: string, repoName: string) => ({
  repoRoot,
  branch,
  repoName,
})

describe('laneLabels', () => {
  it('names a lane by its repo, adding the branch only where the repo repeats', () => {
    expect(
      laneLabels([
        lane('/code/api', 'rate-limits', 'api'),
        lane('/code/web', 'rate-limits', 'web'),
        lane('/code/web', 'usage-page', 'web'),
      ])
    ).toEqual(['api', 'web · rate-limits', 'web · usage-page'])
  })
})
