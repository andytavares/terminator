import { describe, it, expect } from 'vitest'
import { resolveWorkItem } from '../../../../src/renderer/sidebar/work-item'
import type { IssueLink } from '../../../../src/shared/types/index'

const projectLink: IssueLink = {
  projectId: 'p1',
  tracker: 'linear',
  key: 'TAV-231',
  injectContext: true,
  linkedAt: '2026-09-15T00:00:00.000Z',
}

describe('resolveWorkItem', () => {
  it("prefers the session's own link over its project's", () => {
    expect(resolveWorkItem({ tracker: 'jira', key: 'NW-88' }, projectLink)).toEqual({
      source: 'session',
      ref: { tracker: 'jira', key: 'NW-88' },
    })
  })

  it("falls back to the project's link", () => {
    expect(resolveWorkItem(null, projectLink)).toEqual({
      source: 'project',
      ref: { tracker: 'linear', key: 'TAV-231' },
    })
  })

  it('is null when neither exists', () => {
    expect(resolveWorkItem(null, null)).toBeNull()
  })
})
