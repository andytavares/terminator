// Foundry renderer entry — discovered automatically via Vite glob import.
import React from 'react'
import { Bot } from 'lucide-react'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { FoundryPanel } from './components/FoundryPanel'
import { RunConsole } from './components/RunConsole'
import { HistoryView } from './components/HistoryView'

const registry = useExtensionRegistry.getState()

// Register Foundry as a project tab (shows in the tab bar alongside Terminal, PR Review, etc.)
registry.registerProjectTab({
  id: 'foundry',
  label: 'Foundry',
  component: FoundryPanel,
})

// Register run console auxiliary window view
registry.registerWindowView('foundry-run', RunConsole)

// Register standalone History global tab — component must match GlobalTabRegistration shape (no props)
function FoundryHistoryTab() {
  return React.createElement(HistoryView, {
    repoRoot: null,
    onNewRun: () => {
      registry.setActiveProjectTab('foundry')
      // Signal FoundryPanel to open new-run dialog
      window.dispatchEvent(new CustomEvent('foundry:navigate', { detail: 'new-run' }))
    },
  })
}

registry.registerGlobalTab({
  id: 'foundry-history',
  label: 'Foundry History',
  icon: React.createElement(Bot, { size: 16 }),
  component: FoundryHistoryTab,
})

// ⌘⇧A — open Foundry tab
registry.registerKeyboardShortcut({
  accelerator: 'CmdOrCtrl+Shift+A',
  description: 'Open Foundry panel',
  action() {
    registry.setActiveProjectTab('foundry')
  },
})

// ⌘⇧R — open new-run dialog in Foundry
registry.registerKeyboardShortcut({
  accelerator: 'CmdOrCtrl+Shift+R',
  description: 'Start new Foundry run',
  action() {
    registry.setActiveProjectTab('foundry')
    window.dispatchEvent(new CustomEvent('foundry:navigate', { detail: 'new-run' }))
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
    window.dispatchEvent(new CustomEvent('foundry:navigate', { detail: 'new-run' }))
  },
})

registry.registerCommand({
  id: 'foundry:open-history',
  label: 'Open Foundry History',
  category: 'Foundry',
  action() {
    registry.setActiveProjectTab('foundry')
    window.dispatchEvent(new CustomEvent('foundry:navigate', { detail: 'history' }))
  },
})

registry.registerCommand({
  id: 'foundry:open-settings',
  label: 'Open Foundry Settings',
  category: 'Foundry',
  action() {
    registry.setActiveProjectTab('foundry')
    window.dispatchEvent(new CustomEvent('foundry:navigate', { detail: 'settings' }))
  },
})

registry.registerCommand({
  id: 'foundry:setup-harness',
  label: 'Set Up Foundry Harness',
  category: 'Foundry',
  action() {
    registry.setActiveProjectTab('foundry')
    window.dispatchEvent(new CustomEvent('foundry:navigate', { detail: 'setup-wizard' }))
  },
})
