import { describe, it, expect } from 'vitest'
import { HomeFeedSchema } from '../../../src/shared/schemas/home-feed.schema'
import { fullFeed } from '../home/home-feed.fixtures'

describe('HomeFeedSchema', () => {
  it('accepts a full feed', () => {
    expect(HomeFeedSchema.safeParse(fullFeed()).success).toBe(true)
  })

  it('accepts a feed without focus candidates', () => {
    const { focus: _focus, ...feed } = fullFeed()
    expect(HomeFeedSchema.safeParse(feed).success).toBe(true)
  })

  it('rejects an ask of an unknown kind, naming the field', () => {
    const feed = { ...fullFeed(), asks: [{ ...fullFeed().asks[0], kind: 'panic' }] }
    const result = HomeFeedSchema.safeParse(feed)
    expect(result.success).toBe(false)
    expect(!result.success && result.error.issues[0].path).toEqual(['asks', 0, 'kind'])
  })

  it('rejects a facet of an unknown stage', () => {
    const feed = { ...fullFeed(), facets: [{ ...fullFeed().facets[0], stage: 'limbo' }] }
    expect(HomeFeedSchema.safeParse(feed).success).toBe(false)
  })

  it('rejects a work key that is neither a tracker key nor a branch', () => {
    const feed = {
      ...fullFeed(),
      focus: [{ id: 'f', title: 't', workKey: { key: 'x' }, done: false }],
    }
    expect(HomeFeedSchema.safeParse(feed).success).toBe(false)
  })

  it('rejects a feed missing its asks', () => {
    const { asks: _asks, ...feed } = fullFeed()
    expect(HomeFeedSchema.safeParse(feed).success).toBe(false)
  })
})
