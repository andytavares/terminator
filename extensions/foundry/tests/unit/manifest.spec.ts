import { describe, it, expect } from 'vitest'
import manifest from '../../manifest.json'

describe('foundry manifest', () => {
  it('declares the Foundry quick-actions group with mnemonic f', () => {
    expect(manifest.contributes.quickActions).toEqual({
      group: { mnemonic: 'f', label: 'Foundry' },
    })
  })
})
