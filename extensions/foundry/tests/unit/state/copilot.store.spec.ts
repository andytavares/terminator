import { describe, it, expect, beforeEach } from 'vitest'
import { createCopilotStore } from '../../../src/state/copilot.store.js'
import type { CopilotMessage, FileChange } from '../../../src/types/foundry.types.js'

function makeMsg(id: string, role: 'user' | 'agent' = 'user'): CopilotMessage {
  return { id, role, content: `message ${id}`, timestamp: new Date().toISOString() }
}

function makeChange(filePath: string): FileChange {
  return { filePath, status: 'modified', linesAdded: 5, linesRemoved: 2, unifiedDiff: '+new\n-old' }
}

describe('copilot store', () => {
  let store: ReturnType<typeof createCopilotStore>

  beforeEach(() => {
    store = createCopilotStore()
  })

  it('initializes with empty messages and no pending files', () => {
    const s = store.getState()
    expect(s.messages).toHaveLength(0)
    expect(s.pendingFiles.size).toBe(0)
    expect(s.isStreaming).toBe(false)
  })

  it('appendMessage adds to messages array', () => {
    store.getState().appendMessage(makeMsg('m1'))
    expect(store.getState().messages).toHaveLength(1)
    expect(store.getState().messages[0].id).toBe('m1')
  })

  it('addFileChange stores file change by path', () => {
    store.getState().addFileChange(makeChange('src/foo.ts'))
    expect(store.getState().pendingFiles.has('src/foo.ts')).toBe(true)
  })

  it('removeFileChange removes specific file', () => {
    store.getState().addFileChange(makeChange('src/foo.ts'))
    store.getState().addFileChange(makeChange('src/bar.ts'))
    store.getState().removeFileChange('src/foo.ts')
    expect(store.getState().pendingFiles.has('src/foo.ts')).toBe(false)
    expect(store.getState().pendingFiles.has('src/bar.ts')).toBe(true)
  })

  it('clearFiles empties pendingFiles', () => {
    store.getState().addFileChange(makeChange('src/foo.ts'))
    store.getState().clearFiles()
    expect(store.getState().pendingFiles.size).toBe(0)
  })

  it('resetConversation clears messages and files', () => {
    store.getState().appendMessage(makeMsg('m1'))
    store.getState().addFileChange(makeChange('src/foo.ts'))
    store.getState().resetConversation()
    expect(store.getState().messages).toHaveLength(0)
    expect(store.getState().pendingFiles.size).toBe(0)
  })

  it('setIsStreaming toggles streaming flag', () => {
    store.getState().setIsStreaming(true)
    expect(store.getState().isStreaming).toBe(true)
    store.getState().setIsStreaming(false)
    expect(store.getState().isStreaming).toBe(false)
  })
})
