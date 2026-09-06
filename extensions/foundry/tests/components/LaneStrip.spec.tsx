import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const api = { lanes: vi.fn(), laneMayMerge: vi.fn() }
vi.mock('../../src/types/electron.js', () => ({ getSpeckitAPI: () => api }))

import { LaneStrip } from '../../src/components/LaneStrip.js'
import type { LaneViewJson } from '../../src/types/electron.js'

// A card that touches more than one repository. Merge order is the whole point:
// a consumer that merges before its producer is building against a contract
// that has not landed.

const view = (over: Partial<LaneViewJson['lane']> = {}, rest: Partial<LaneViewJson> = {}) =>
  ({
    lane: {
      ord: 1,
      repo: 'fluent',
      branch: 'feat/session-ulid',
      blocks: [2],
      blocked_by: [],
      ...over,
    },
    collisions: [],
    blockedBy: [],
    ...rest,
  }) as LaneViewJson

beforeEach(() => {
  vi.clearAllMocks()
  api.lanes.mockResolvedValue({ lanes: [] })
  api.laneMayMerge.mockResolvedValue({ allowed: true, reason: null, blockingLane: null })
})

describe('a card with one repository', () => {
  it('renders nothing at all — this is almost every card', async () => {
    const { container } = render(<LaneStrip featureDir="/repo/specs/021-a" />)
    await waitFor(() => expect(api.lanes).toHaveBeenCalledWith({ featureDir: '/repo/specs/021-a' }))
    expect(container.textContent).toBe('')
  })

  it('renders nothing for a single declared lane either', async () => {
    api.lanes.mockResolvedValue({ lanes: [view()] })
    const { container } = render(<LaneStrip featureDir="/repo/specs/021-a" />)
    await waitFor(() => expect(api.lanes).toHaveBeenCalled())
    expect(container.querySelector('.sk-lanes')).toBeNull()
  })
})

describe('a card with several', () => {
  beforeEach(() => {
    api.lanes.mockResolvedValue({
      lanes: [
        view({ role: 'producer' }, { collisions: ['proto/session.proto'] }),
        view(
          { ord: 2, repo: 'cli-flow', branch: 'feat/session-ulid', blocks: [], blocked_by: [1] },
          { collisions: ['proto/session.proto'], blockedBy: [1] }
        ),
      ],
    })
  })

  it('lists them in merge order', async () => {
    render(<LaneStrip featureDir="/repo/specs/021-a" />)
    expect(await screen.findByText('Merge order')).toBeDefined()
    expect(screen.getByText('fluent')).toBeDefined()
    expect(screen.getByText('cli-flow')).toBeDefined()
  })

  it('says which lane waits on which', async () => {
    render(<LaneStrip featureDir="/repo/specs/021-a" />)
    expect(await screen.findByText(/waits on 1/)).toBeDefined()
  })

  it('flags the shared file on every lane that touches it, not just the producer', async () => {
    // The point is to warn each agent before it starts, not after a conflict.
    render(<LaneStrip featureDir="/repo/specs/021-a" />)
    await screen.findByText('Merge order')
    expect(screen.getAllByText(/shares proto\/session.proto/)).toHaveLength(2)
  })

  it('asks the runtime whether a lane may merge rather than deciding here', async () => {
    // A second copy of the rule in the renderer is a second answer.
    render(<LaneStrip featureDir="/repo/specs/021-a" merged={[1]} />)
    await waitFor(() =>
      expect(api.laneMayMerge).toHaveBeenCalledWith({
        featureDir: '/repo/specs/021-a',
        ord: 2,
        merged: [1],
      })
    )
  })

  it('says what is blocking, in the runtime’s own words', async () => {
    api.laneMayMerge.mockImplementation(({ ord }: { ord: number }) =>
      Promise.resolve(
        ord === 2
          ? {
              allowed: false,
              reason: 'lane 1 (fluent) must merge first — they share proto/session.proto',
              blockingLane: 1,
            }
          : { allowed: true, reason: null, blockingLane: null }
      )
    )
    render(<LaneStrip featureDir="/repo/specs/021-a" />)
    expect(await screen.findByText(/lane 1 \(fluent\) must merge first/)).toBeDefined()
  })
})
