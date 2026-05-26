import React, { useEffect, useState } from 'react'
import { useMergeFlowStore } from '../../stores/merge-flow.store'
import { mergeFlowAPI } from '../../api/merge-flow'
import { useToastStore } from '../../../../../src/renderer/stores/toast.store'
import { ConflictHub } from './ConflictHub'
import { ConflictResolver } from './ConflictResolver'
import { CompletionScreen } from './CompletionScreen'
import './merge-flow.css'

interface Props {
  repoRoot: string
  onExit: () => void
}

export function MergeFlowView({ repoRoot, onExit }: Props) {
  const session = useMergeFlowStore((s) => s.session)
  const isLoading = useMergeFlowStore((s) => s.isLoading)
  const startSession = useMergeFlowStore((s) => s.startSession)
  const setLoading = useMergeFlowStore((s) => s.setLoading)
  const setError = useMergeFlowStore((s) => s.setError)
  const clearSession = useMergeFlowStore((s) => s.clearSession)
  const { addToast } = useToastStore()

  const [activeFileIndex, setActiveFileIndexLocal] = useState<number>(-1)
  const [isComplete, setIsComplete] = useState(false)

  useEffect(() => {
    async function init() {
      setLoading(true)
      try {
        // Try to restore an in-progress session — skip stale empty sessions
        const restored = await mergeFlowAPI.restoreSession(repoRoot)
        if (restored.session && restored.session.totalConflicts > 0) {
          startSession(restored.session)
          if (
            restored.session.totalConflicts > 0 &&
            restored.session.totalResolved >= restored.session.totalConflicts
          ) {
            setIsComplete(true)
          }
          setLoading(false)
          return
        }
        // No valid persisted session — build a fresh one from the actual conflict state
        const result = await mergeFlowAPI.listConflicts(repoRoot)
        if ('error' in result) {
          addToast({ type: 'error', message: `Could not load conflicts: ${result.error}` })
          onExit()
          return
        }
        if (result.files.length === 0) {
          addToast({ type: 'info', message: 'No merge conflicts found.' })
          onExit()
          return
        }
        startSession(result)
        void mergeFlowAPI.persistSession(repoRoot, result)
      } catch (e) {
        setError(String(e))
        addToast({ type: 'error', message: `Could not open conflict resolver: ${String(e)}` })
        onExit()
      } finally {
        setLoading(false)
      }
    }
    void init()
    return () => {
      // Do not clear session on unmount — session persists until commit or abort
    }
  }, [repoRoot])

  async function handleStartOver() {
    if (!session) return
    try {
      const result = await mergeFlowAPI.resetSession(
        repoRoot,
        session.files.map((f) => ({
          filePath: f.filePath,
        }))
      )
      if ('error' in result) {
        addToast({ type: 'error', message: `Could not reset: ${result.error}` })
        return
      }
      clearSession()
      setIsComplete(false)
      setActiveFileIndexLocal(-1)
      // Re-init
      setLoading(true)
      const fresh = await mergeFlowAPI.listConflicts(repoRoot)
      if ('error' in fresh) {
        addToast({ type: 'error', message: `Could not reload conflicts: ${fresh.error}` })
        onExit()
        return
      }
      startSession(fresh)
      void mergeFlowAPI.persistSession(repoRoot, fresh)
    } catch (e) {
      addToast({ type: 'error', message: `Start over failed: ${String(e)}` })
    } finally {
      setLoading(false)
    }
  }

  function handleExit() {
    clearSession()
    onExit()
  }

  if (isLoading) {
    return <div className="merge-flow-view merge-flow-view--loading">Loading conflicts…</div>
  }

  if (!session) {
    return <div className="merge-flow-view merge-flow-view--loading">Loading conflicts…</div>
  }

  if (isComplete) {
    return (
      <div className="merge-flow-view">
        <CompletionScreen
          repoRoot={repoRoot}
          onBack={() => setIsComplete(false)}
          onExit={handleExit}
        />
      </div>
    )
  }

  if (activeFileIndex >= 0 && session.files[activeFileIndex]) {
    return (
      <div className="merge-flow-view">
        <ConflictResolver
          repoRoot={repoRoot}
          onBack={() => setActiveFileIndexLocal(-1)}
          onComplete={() => setIsComplete(true)}
          onStartOver={handleStartOver}
          onExit={handleExit}
        />
      </div>
    )
  }

  return (
    <div className="merge-flow-view">
      <ConflictHub
        onSelectFile={(i) => {
          setActiveFileIndexLocal(i)
        }}
        onStartOver={handleStartOver}
        onExit={handleExit}
      />
    </div>
  )
}
