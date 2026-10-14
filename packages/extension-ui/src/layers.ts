/**
 * The stacking contract.
 *
 * Replaces 14 unmanaged `z-index` values (1, 2, 9, 10, 20, 30, 40, 50, 100, 200,
 * 999, 1000, 2000, 9999) spread across the extension stylesheets, where the
 * winner was whoever picked the larger number.
 *
 * Ordering is the contract. The numbers are an implementation detail and no
 * caller writes one: stylesheets take them from the published `--tm-layer-*`
 * custom properties. A modal shell is not on this scale: the browser paints a
 * native modal dialog above every z-index, in the top layer (ADR 110).
 */

export const LAYER_NAMES = ['panel', 'overlay', 'modal', 'toast'] as const

export type LayerName = (typeof LAYER_NAMES)[number]

export const LAYERS: Readonly<Record<LayerName, number>> = Object.freeze({
  panel: 100,
  overlay: 200,
  // For a surface drawn over a view that is not a modal shell, such as a dropdown.
  modal: 300,
  // Above the rest on purpose: a message must be readable over whatever raised it.
  toast: 400,
})

export function layerValue(name: LayerName): number {
  return LAYERS[name]
}

/** The custom property a stylesheet references for a layer. */
export function layerCssVar(name: LayerName): string {
  return `--tm-layer-${name}`
}

/** The whole scale as CSS declarations, for the core app's token block. */
export function layerCssDeclarations(): string {
  return LAYER_NAMES.map((name) => `${layerCssVar(name)}: ${LAYERS[name]};`).join('\n  ')
}
