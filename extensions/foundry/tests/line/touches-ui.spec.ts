import { describe, it, expect } from 'vitest'
import { touchesUi } from '../../src/line/execution-final.js'
import { draftOrder } from '../../src/order/draft.js'
import { builderUnit } from '../helpers/order-parts.js'
import type { WorkOrder } from '../../src/order/schema.js'

// "Foundry asks for pictures" of a change a person looks at: by the repository's
// interface globs, or by the architect's word on a unit.

function orderWith(interfaceGlobs: string[], touchesInterface?: boolean): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  const environment = {
    ...base.context.environment,
    paths: { ...base.context.environment.paths, interface: interfaceGlobs },
  }
  const units = [builderUnit('U-1', { touchesInterface })]
  return { ...base, context: { ...base.context, environment }, plan: { ...base.plan, units } }
}

describe('touchesUi', () => {
  it('is true for a .swift change when the apple interface glob lists it', () => {
    expect(touchesUi(orderWith(['**/*.swift']), ['Sources/App/Home.swift'])).toBe(true)
  })

  it('is false for the same change when no glob lists it', () => {
    expect(touchesUi(orderWith([]), ['Sources/App/Home.swift'])).toBe(false)
  })

  it('is true when a unit says it touches the interface, with no path matching', () => {
    expect(touchesUi(orderWith([], true), ['src/handler.rs'])).toBe(true)
  })

  it('is false when the unit says it does not and nothing matches', () => {
    expect(touchesUi(orderWith(['**/*.tsx'], false), ['src/handler.rs'])).toBe(false)
  })
})
