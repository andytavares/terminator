import React, { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useMergeFlowStore } from '../../stores/merge-flow.store'
import { mergeFlowAPI } from '../../api/merge-flow'
import { notificationsAPI } from '../../api/notifications'
import { ConflictHub } from './ConflictHub'
import { ConflictResolver } from './ConflictResolver'
import { CompletionScreen } from './CompletionScreen'
import type { ConflictSession } from '../../schemas/merge-flow.schema'
import './merge-flow.css'

interface Props {
  repoRoot: string
  onExit: () => void
}

type FlowStore = ReturnType<typeof useMergeFlowStore.getState>

interface FlowContext {
  repoRoot: string
  onExit: () => void
  store: Pick<FlowStore, 'startSession' | 'setLoading' | 'setError' | 'clearSession'>
  view: { setIsComplete: (complete: boolean) => void; setActiveFile: (index: number) => void }
}

function notifyError(title: string, key: string, message: string): void {
  void notificationsAPI.notify({ type: 'error', title, key, message })
}

/** Restores a stored session that still has conflicts; true when one was restored. */
async function restoreSession(ctx: FlowContext): Promise<boolean> {
  const { session } = await mergeFlowAPI.restoreSession(ctx.repoRoot)
  // A stored session with no conflicts is stale.
  if (!session || !(session.totalConflicts > 0)) return false
  ctx.store.startSession(session)
  if (session.totalResolved >= session.totalConflicts) ctx.view.setIsComplete(true)
  ctx.store.setLoading(false)
  return true
}

/** Starts a session from the repository's conflicts, saved so it can be restored. */
async function startFromConflicts(ctx: FlowContext, failure: { title: string; key: string }) {
  const result = await mergeFlowAPI.listConflicts(ctx.repoRoot)
  if ('error' in result) {
    notifyError(failure.title, failure.key, result.error)
    ctx.onExit()
    return null
  }
  return result
}

function beginSession(ctx: FlowContext, session: ConflictSession): void {
  ctx.store.startSession(session)
  void mergeFlowAPI.persistSession(ctx.repoRoot, session)
}

/** Builds a fresh session; leaves when there are no conflicts or they cannot be read. */
async function startFreshSession(ctx: FlowContext): Promise<void> {
  const failure = { title: 'Could not load conflicts', key: 'loadConflictsFailed' }
  const result = await startFromConflicts(ctx, failure)
  if (!result) return
  if (result.files.length === 0) {
    void notificationsAPI.notify({
      type: 'info',
      title: 'No merge conflicts found.',
      key: 'noConflictsFound',
    })
    ctx.onExit()
    return
  }
  beginSession(ctx, result)
}

async function openSession(ctx: FlowContext): Promise<void> {
  ctx.store.setLoading(true)
  try {
    if (await restoreSession(ctx)) return
    await startFreshSession(ctx)
  } catch (e) {
    ctx.store.setError(String(e))
    notifyError('Could not open conflict resolver', 'openResolverFailed', String(e))
    ctx.onExit()
  } finally {
    ctx.store.setLoading(false)
  }
}

/** Resets every file to its conflicted state and starts again from the hub. */
async function startOver(ctx: FlowContext, session: ConflictSession): Promise<void> {
  try {
    const files = session.files.map((f) => ({ filePath: f.filePath }))
    const result = await mergeFlowAPI.resetSession(ctx.repoRoot, files)
    if ('error' in result) return notifyError('Could not reset', 'resetFailed', result.error)
    ctx.store.clearSession()
    ctx.view.setIsComplete(false)
    ctx.view.setActiveFile(-1)
    ctx.store.setLoading(true)
    const failure = { title: 'Could not reload conflicts', key: 'reloadConflictsFailed' }
    const fresh = await startFromConflicts(ctx, failure)
    if (fresh) beginSession(ctx, fresh)
  } catch (e) {
    notifyError('Start over failed', 'startOverFailed', String(e))
  } finally {
    ctx.store.setLoading(false)
  }
}

function useFlowActions(): FlowContext['store'] {
  return useMergeFlowStore(
    useShallow((s) => ({
      startSession: s.startSession,
      setLoading: s.setLoading,
      setError: s.setError,
      clearSession: s.clearSession,
    }))
  )
}

/**
 * The merge flow's state. The session outlives the view: it is kept until the merge is
 * committed or aborted, and opens once per repository, with the context of the render that
 * opened it.
 */
function useMergeFlow(props: Props) {
  const { repoRoot, onExit } = props
  const session = useMergeFlowStore((s) => s.session)
  const isLoading = useMergeFlowStore((s) => s.isLoading)
  const store = useFlowActions()
  const [activeFileIndex, setActiveFile] = useState<number>(-1)
  const [isComplete, setIsComplete] = useState(false)
  const ctx: FlowContext = { repoRoot, onExit, store, view: { setIsComplete, setActiveFile } }
  useEffect(() => {
    void openSession(ctx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoRoot])
  const handleStartOver = async () => {
    if (session) await startOver(ctx, session)
  }
  const handleExit = () => {
    store.clearSession()
    onExit()
  }
  return {
    session,
    isLoading,
    isComplete,
    setIsComplete,
    activeFileIndex,
    setActiveFile,
    handleStartOver,
    handleExit,
  }
}

type MergeFlow = ReturnType<typeof useMergeFlow>

function FlowScreen({ flow, repoRoot }: { flow: MergeFlow; repoRoot: string }) {
  const { session } = flow
  if (flow.isComplete) {
    return (
      <CompletionScreen
        repoRoot={repoRoot}
        onBack={() => flow.setIsComplete(false)}
        onExit={flow.handleExit}
      />
    )
  }
  if (flow.activeFileIndex >= 0 && session?.files[flow.activeFileIndex]) {
    return (
      <ConflictResolver
        repoRoot={repoRoot}
        onBack={() => flow.setActiveFile(-1)}
        onComplete={() => flow.setIsComplete(true)}
        onStartOver={flow.handleStartOver}
        onExit={flow.handleExit}
      />
    )
  }
  return (
    <ConflictHub
      onSelectFile={flow.setActiveFile}
      onStartOver={flow.handleStartOver}
      onExit={flow.handleExit}
    />
  )
}

export function MergeFlowView(props: Props) {
  const flow = useMergeFlow(props)
  if (flow.isLoading || !flow.session) {
    return <div className="merge-flow-view merge-flow-view--loading">Loading conflicts…</div>
  }
  return (
    <div className="merge-flow-view">
      <FlowScreen flow={flow} repoRoot={props.repoRoot} />
    </div>
  )
}
