// Foundry renderer entry — discovered automatically via Vite glob import.
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { FoundryPanel } from './components/FoundryPanel'
import { RunConsole } from './components/RunConsole'

const registry = useExtensionRegistry.getState()

// Register Foundry as a project tab (shows in the tab bar alongside Terminal, PR Review, etc.)
registry.registerProjectTab({
  id: 'foundry',
  label: 'Foundry',
  component: FoundryPanel,
})

registry.registerWindowView('foundry-run', RunConsole)

// ⌘⇧A — open Foundry tab
registry.registerKeyboardShortcut({
  accelerator: 'CmdOrCtrl+Shift+A',
  description: 'Open Foundry panel',
  action() {
    registry.setActiveProjectTab('foundry')
  },
})

// Command palette entries
registry.registerCommand({
  id: 'foundry:open-panel',
  label: 'Open Foundry Panel',
  category: 'Foundry',
  shortcut: '⌘⇧A',
  action() {
    registry.setActiveProjectTab('foundry')
  },
})

registry.registerCommand({
  id: 'foundry:new-run',
  label: 'Start New Foundry Run',
  category: 'Foundry',
  shortcut: '⌘⇧R',
  action() {
    registry.setActiveProjectTab('foundry')
  },
})
