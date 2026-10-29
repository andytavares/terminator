import type { FeatureDeclaration, FeatureKind, Via } from '../../shared/schemas/usage.schema.js'

interface RecordOptions {
  failed?: boolean
  activeMs?: number
  declare?: { label: string; kind: FeatureKind; source: string }
}

/** Counts one use. Fire and forget: a lost count never gets in the way of the feature. */
export function recordUse(feature: string, via: Via = 'click', options?: RecordOptions): void {
  void window.electronAPI.usage.recordUse({ feature, via, ...options })
}

export function declareFeatures(features: FeatureDeclaration[]): void {
  void window.electronAPI.usage.declare({ features })
}
