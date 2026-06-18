import React from 'react'
import { FileText } from 'lucide-react'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { NotepadView } from './components/NotepadView'
import { QuickCreateOverlay } from './components/QuickCreateOverlay'
import { useNotesStore } from './stores/notes.store'

const registry = useExtensionRegistry.getState()

registry.registerGlobalTab({
  id: 'notepad',
  label: 'Notes',
  icon: React.createElement(FileText),
  component: NotepadView,
  permanent: true,
})

// Overlay renders inside the main window — visibility controlled by store
registry.registerOverlay(QuickCreateOverlay)

function openQuickCreate() {
  useNotesStore.getState().setShowQuickCreate(true)
}

// In-app keyboard shortcut: Cmd+Shift+N
registry.registerKeyboardShortcut({
  accelerator: 'CmdOrCtrl+Shift+N',
  description: 'New Note',
  action: openQuickCreate,
})

// Cmd+Shift+F: focus note search bar
registry.registerKeyboardShortcut({
  accelerator: 'CmdOrCtrl+Shift+F',
  description: 'Focus note search',
  action: () => {
    const input = document.querySelector<HTMLInputElement>('.notepad-search-input')
    input?.focus()
  },
})

// Cmd+E: toggle editor raw/preview mode
registry.registerKeyboardShortcut({
  accelerator: 'CmdOrCtrl+E',
  description: 'Toggle editor mode',
  action: () => {
    window.dispatchEvent(new CustomEvent('notepad:toggleEditorMode'))
  },
})

// Listen for global shortcut broadcast from main process (Cmd+Shift+N via globalShortcut)
if (typeof window !== 'undefined' && window.electronAPI?.extensionBridge?.on) {
  window.electronAPI.extensionBridge.on('terminator.notepad:ui.openQuickCreate', openQuickCreate)

  // Cmd+Opt+M: toggle comment margin
  window.electronAPI.extensionBridge.on('terminator.notepad:ui.toggleComments', () => {
    window.dispatchEvent(new CustomEvent('notepad:toggleComments'))
  })
}

export {}
