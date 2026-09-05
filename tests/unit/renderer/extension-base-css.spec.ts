import { describe, it, expect } from 'vitest'
import { EXTENSION_BASE_CSS } from '../../../src/main/extensions/extension-view-host'
import { LAYERS, LAYER_NAMES } from '../../../packages/extension-ui/src/layers'

// An extension view is a separate document and does not load the core
// stylesheet. Anything an extension's CSS references has to be injected here or
// it resolves to nothing — which is how 38 freshly-migrated z-index values
// would have silently stopped stacking.

describe('EXTENSION_BASE_CSS', () => {
  it('defines every layer the scale publishes', () => {
    for (const name of LAYER_NAMES) {
      expect(EXTENSION_BASE_CSS).toContain(`--tm-layer-${name}:`)
    }
  })

  it('gives each layer the same value the scale does', () => {
    for (const name of LAYER_NAMES) {
      expect(EXTENSION_BASE_CSS).toContain(`--tm-layer-${name}: ${LAYERS[name]};`)
    }
  })

  it('defines the spacing steps the shared components use', () => {
    for (const step of [1, 2, 3, 4, 5, 6, 8]) {
      expect(EXTENSION_BASE_CSS).toContain(`--tm-space-${step}:`)
    }
  })
})
