import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { EXTENSION_BASE_CSS } from '../../../packages/extension-ui/src/extension-base-css'
import { LAYERS, LAYER_NAMES } from '../../../packages/extension-ui/src/layers'
import { extensionBaseCss } from '../../e2e/extension-base-css'

// An extension view is a separate document and does not load the core
// stylesheet. Anything an extension's CSS references has to be injected here or
// it resolves to nothing — which is how 38 freshly-migrated z-index values
// would have silently stopped stacking.

describe('EXTENSION_BASE_CSS', () => {
  // The Chromium-rendered e2e specs rebuild it from files; a sheet missing
  // there (controls.css once was) makes them measure what no user sees.
  it('is what the e2e specs rebuild from the stylesheet files', () => {
    expect(extensionBaseCss(resolve(__dirname, '../../..'))).toBe(EXTENSION_BASE_CSS)
  })

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
