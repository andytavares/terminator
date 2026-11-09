import { describe, it, expect } from 'vitest'
import {
  LAYERS,
  LAYER_NAMES,
  layerCssDeclarations,
  layerCssVar,
  layerValue,
} from '../../src/layers'

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

  // The declarations are pasted into the core token block, so they must match
  // what the module says the scale is — not a second copy that can drift.
  it('emits exactly one declaration per layer, with its value from the scale', () => {
    expect(layerCssDeclarations().split('\n  ')).toEqual([
      `--tm-layer-panel: ${LAYERS.panel};`,
      `--tm-layer-overlay: ${LAYERS.overlay};`,
      `--tm-layer-modal: ${LAYERS.modal};`,
      `--tm-layer-toast: ${LAYERS.toast};`,
    ])
  })
})
