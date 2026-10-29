import { describe, it, expect } from 'vitest'
import { CORE_FEATURES } from '../../../../src/shared/usage/core-features'
import { FeatureDeclarationSchema } from '../../../../src/shared/schemas/usage.schema'

describe('CORE_FEATURES', () => {
  it('holds only declarations the usage store accepts', () => {
    for (const feature of CORE_FEATURES) {
      expect(FeatureDeclarationSchema.safeParse(feature).success).toBe(true)
    }
  })

  it('declares each id once', () => {
    const ids = CORE_FEATURES.map((feature) => feature.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
