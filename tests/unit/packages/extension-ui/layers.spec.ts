import { describe, it, expect } from 'vitest'
import {
  LAYERS,
  LAYER_NAMES,
  layerCssDeclarations,
  layerCssVar,
  layerValue,
  nestedLayerValue,
} from '../../../../packages/extension-ui/src/layers'

// The scale replaces 14 unmanaged z-index values (1 … 9999) spread across the
// extension stylesheets, where stacking was decided by whoever picked the larger
// number. Ordering is the contract; the numbers are an implementation detail.

describe('layer scale', () => {
  it('names exactly the four layers the contract publishes', () => {
    expect(LAYER_NAMES).toEqual(['panel', 'overlay', 'modal', 'toast'])
  })

  it('orders panel below overlay below modal below toast', () => {
    expect(LAYERS.panel).toBeLessThan(LAYERS.overlay)
    expect(LAYERS.overlay).toBeLessThan(LAYERS.modal)
    expect(LAYERS.modal).toBeLessThan(LAYERS.toast)
  })

  // A save confirmation raised by an action taken inside a dialog has to be
  // readable without dismissing the dialog first.
  it('puts toasts above modals on purpose', () => {
    expect(LAYERS.toast).toBeGreaterThan(LAYERS.modal)
  })

  it('resolves a layer by name', () => {
    for (const name of LAYER_NAMES) {
      expect(layerValue(name)).toBe(LAYERS[name])
    }
  })

  describe('the nesting rule', () => {
    // The one case naive ordering gets wrong: a picker opened from inside a
    // dialog. `overlay` is numerically below `modal`, so a picker taking the
    // bare overlay value renders behind the dialog that opened it.
    it('renders a picker opened inside a dialog above that dialog', () => {
      const dialog = layerValue('modal')
      const picker = nestedLayerValue('overlay', dialog)
      expect(picker).toBeGreaterThan(dialog)
    })

    it('keeps a confirmation opened from a dialog above its parent', () => {
      const outer = layerValue('modal')
      const inner = nestedLayerValue('modal', outer)
      expect(inner).toBeGreaterThan(outer)
    })

    it('stacks three levels in the order they were opened', () => {
      const panel = layerValue('panel')
      const dialog = nestedLayerValue('modal', panel)
      const picker = nestedLayerValue('overlay', dialog)
      expect(dialog).toBeGreaterThan(panel)
      expect(picker).toBeGreaterThan(dialog)
    })

    it('falls back to the bare layer value when nothing contains it', () => {
      expect(nestedLayerValue('modal', null)).toBe(LAYERS.modal)
    })

    // A toast must clear every layer whatever raised it, so nesting must never
    // drag it below something else.
    it('never resolves a toast below a modal, however deeply nested', () => {
      const deep = nestedLayerValue('modal', nestedLayerValue('modal', layerValue('modal')))
      expect(layerValue('toast')).toBeGreaterThan(deep)
    })
  })

  describe('the CSS surface stylesheets reference', () => {
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
})
