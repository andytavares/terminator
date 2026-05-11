// Extension renderer entry point — discovered automatically via Vite glob import.
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { SpecKitPilotView } from './components/SpecKitPilotView'

const registry = useExtensionRegistry.getState()

registry.registerProjectTab({
  id: 'speckit-pilot',
  label: 'SpecKit',
  component: SpecKitPilotView,
})
