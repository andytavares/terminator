import { describe, it, expect } from 'vitest'
import {
  LAYERS,
  LAYER_NAMES,
  layerCssDeclarations,
  layerCssVar,
  layerValue,
} from '../../../../packages/extension-ui/src/layers'

// The scale replaces 14 unmanaged z-index values (1 … 9999) spread across the
// extension stylesheets, where stacking was decided by whoever picked the larger
// number. Ordering is the contract; the numbers are an implementation detail.

describe('layer scale', () => {
  it('orders panel below overlay below modal below toast', () => {
    expect(LAYERS.panel).toBeLessThan(LAYERS.overlay)
    expect(LAYERS.overlay).toBeLessThan(LAYERS.modal)
    // A save confirmation raised from inside a dialog is readable without closing it.
    expect(LAYERS.modal).toBeLessThan(LAYERS.toast)
  })

  it('resolves a layer by name', () => {
    for (const name of LAYER_NAMES) {
      expect(layerValue(name)).toBe(LAYERS[name])
    }
  })
})

describe('layer scale — the nesting rule', () => {
  it('names every layer as a --tm-layer-* custom property', () => {
    for (const name of LAYER_NAMES) {
      expect(layerCssVar(name)).toBe(`--tm-layer-${name}`)
    }
  })

  it('emits a declaration for every layer', () => {
    const css = layerCssDeclarations()
    for (const name of LAYER_NAMES) {
      expect(css).toContain(`--tm-layer-${name}: ${LAYERS[name]};`)
    }
  })

  // The declarations are pasted into the core token block, so they must match
  // what the module says the scale is — not a second copy that can drift.
  it('emits exactly one declaration per layer and nothing else', () => {
    expect(layerCssDeclarations().split('\n')).toHaveLength(LAYER_NAMES.length)
  })
})
