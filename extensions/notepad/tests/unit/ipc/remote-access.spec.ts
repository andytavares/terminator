import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: {} }))

import { registerCommentsIpcHandlers } from '../../../src/ipc/comments.ipc.js'
import { registerDiagramCommentsIpcHandlers } from '../../../src/ipc/diagram-comments.ipc.js'
import { registerDiagramsIpcHandlers } from '../../../src/ipc/diagrams.ipc.js'
import { registerExportIpcHandlers } from '../../../src/ipc/export.ipc.js'
import { registerFoldersIpcHandlers } from '../../../src/ipc/folders.ipc.js'
import { registerNotesIpcHandlers, registerTagsIpcHandlers } from '../../../src/ipc/notes.ipc.js'
import { registerSearchIpcHandlers } from '../../../src/ipc/search.ipc.js'
import { remoteAccessByChannel } from '../../../../../packages/test-support/src/extension-channels'

const REGISTRARS = [
  registerCommentsIpcHandlers,
  registerDiagramCommentsIpcHandlers,
  registerDiagramsIpcHandlers,
  registerExportIpcHandlers,
  registerFoldersIpcHandlers,
  registerNotesIpcHandlers,
  registerTagsIpcHandlers,
  registerSearchIpcHandlers,
]

describe('notepad remote access', () => {
  it('keeps file import and export, which take a path on the desktop, local', () => {
    const channels = remoteAccessByChannel(REGISTRARS)
    const local = [...channels].filter(([, remote]) => !remote).map(([channel]) => channel)

    expect(local.sort()).toEqual([
      'terminator.notepad:export.pickFolder',
      'terminator.notepad:export.run',
      'terminator.notepad:import.run',
    ])
  })

  it.each([
    'terminator.notepad:notes.list',
    'terminator.notepad:notes.autosave',
    'terminator.notepad:diagrams.get',
    'terminator.notepad:folders.list',
    'terminator.notepad:search.query',
    'terminator.notepad:tags.list',
  ])('lets the remote browser use %s', (channel) => {
    expect(remoteAccessByChannel(REGISTRARS).get(channel)).toBe(true)
  })
})
