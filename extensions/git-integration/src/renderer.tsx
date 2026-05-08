// Extension renderer entry point — self-registers into the core extension registry.
// This file is discovered automatically via Vite glob import in src/renderer/extensions/loader.ts
// The core app never imports this file directly.

import 'highlight.js/styles/atom-one-dark.css'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { GitSidebarPanel } from './components/GitSidebarPanel'
import { GitFullView } from './components/GitFullView'

const registry = useExtensionRegistry.getState()

registry.registerSidebarPanel({
  id: 'git-changes',
  label: 'Git Changes',
  component: GitSidebarPanel,
})

registry.registerProjectTab({
  id: 'git',
  label: 'Git',
  component: GitFullView,
})
