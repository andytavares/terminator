/**
 * The stacking contract.
 *
 * Replaces 14 unmanaged `z-index` values (1, 2, 9, 10, 20, 30, 40, 50, 100, 200,
 * 999, 1000, 2000, 9999) spread across the extension stylesheets, where the
 * winner was whoever picked the larger number.
 *
 * Ordering is the contract. The numbers are an implementation detail and no
 * caller writes one — components take their layer from context, stylesheets
 * take it from the published `--tm-layer-*` custom properties.
 */

export const LAYER_NAMES = ['panel', 'overlay', 'modal', 'toast'] as const

export type LayerName = (typeof LAYER_NAMES)[number]

/**
 * Spaced by 100 so a nested surface can be lifted above its parent without
 * colliding with the layer above it — see `nestedLayerValue`.
 */
export const LAYERS: Readonly<Record<LayerName, number>> = Object.freeze({
  panel: 100,
  overlay: 200,
  modal: 300,
  // Above modals on purpose: a confirmation raised by an action taken inside a
  // dialog has to be readable without dismissing the dialog first.
  toast: 400,
})

/** The gap between adjacent layers; the ceiling on how far nesting may lift. */
const LAYER_STEP = 100

/** How much each level of nesting lifts a surface above the one containing it. */
const NEST_STEP = 10

export function layerValue(name: LayerName): number {
  return LAYERS[name]
}

/**
 * The value a surface takes when it is opened *from* another surface.
 *
 * The case naive ordering gets wrong is a picker opened inside a dialog:
 * `overlay` is numerically below `modal`, so a picker taking its own bare layer
 * renders behind the dialog that opened it. A nested surface is therefore
 * positioned relative to its container rather than to its own layer — unless
 * its own layer is already higher, which is what keeps a toast on top however
 * deeply the thing that raised it was nested.
 *
 * Pure: takes the container's resolved value as a parameter rather than reading
 * it from anywhere.
 */
export function nestedLayerValue(name: LayerName, containerValue: number | null): number {
  const own = LAYERS[name]
  if (containerValue === null) return own
  if (own > containerValue) return own
  // Stay inside the parent's band so nesting can never climb into the layer above.
  const lifted = containerValue + NEST_STEP
  const ceiling = containerValue + LAYER_STEP - 1
  return Math.min(lifted, ceiling)
}

/** The custom property a stylesheet references for a layer. */
export function layerCssVar(name: LayerName): string {
  return `--tm-layer-${name}`
}

/** The whole scale as CSS declarations, for the core app's token block. */
export function layerCssDeclarations(): string {
  return LAYER_NAMES.map((name) => `${layerCssVar(name)}: ${LAYERS[name]};`).join('\n  ')
}
