import { describe, it, expect, beforeEach } from 'vitest'
import { isBrokenOut, useBreakoutStore } from '../../../../src/renderer/stores/breakout.store'
import { partialFake } from '../../../support/fakes'
import { resetStore } from '../../../support/renderer-stores'

const child = partialFake<Window>({})

beforeEach(() => resetStore(useBreakoutStore))

describe('breakout store', () => {
  it('holds a window by session id until it is removed', () => {
    useBreakoutStore.getState().add('ses-1', child)
    expect(isBrokenOut('ses-1')).toBe(true)
    expect(useBreakoutStore.getState().windows.get('ses-1')).toBe(child)
    useBreakoutStore.getState().remove('ses-1')
    expect(isBrokenOut('ses-1')).toBe(false)
  })

  it('replaces the map on every change so subscribers re-render', () => {
    const before = useBreakoutStore.getState().windows
    useBreakoutStore.getState().add('ses-1', child)
    expect(useBreakoutStore.getState().windows).not.toBe(before)
  })

  it('leaves other sessions alone when one is removed', () => {
    useBreakoutStore.getState().add('ses-1', child)
    useBreakoutStore.getState().add('ses-2', child)
    useBreakoutStore.getState().remove('ses-1')
    expect(isBrokenOut('ses-2')).toBe(true)
  })
})
