import type { FeatureDeclaration } from '../schemas/usage.schema.js'

export const CORE_FEATURES: FeatureDeclaration[] = [
  { id: 'core.home', label: 'Home', kind: 'surface', source: 'core' },
  { id: 'core.overview', label: 'Overview', kind: 'surface', source: 'core' },
  { id: 'core.usage', label: 'Usage', kind: 'surface', source: 'core' },
  { id: 'core.app.launch', label: 'App launch', kind: 'control', source: 'core' },
  { id: 'core.app.active', label: 'App in front', kind: 'control', source: 'core' },
  { id: 'core.app.update', label: 'Update installed', kind: 'control', source: 'core' },
  { id: 'core.app.render-error', label: 'Screen failed to draw', kind: 'control', source: 'core' },
]
