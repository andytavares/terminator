import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, Plus, Settings } from 'lucide-react'
import { BoardView } from '../components/BoardView.js'
import { CardDetail } from '../components/CardDetail.js'
import { CardBriefEditor } from '../components/CardBriefEditor.js'
import { KnowledgeSearch } from '../components/KnowledgeSearch.js'
import { SettingsView } from '../components/SettingsView.js'
import { Orders } from '../components/Orders.js'
import { Dialog } from '@terminator/extension-ui'
import { getSpeckitAPI } from '../types/electron.js'
import { reconcileAssignedTickets } from '../state/reconcile-tickets.js'

type Overlay = 'none' | 'new-card' | 'settings'

// The Forge is the new way in; the board is what it is replacing. Both are
// reachable while the pipeline underneath is still being retired.
type Surface = 'forge' | 'board'

export function App(): JSX.Element {
  const [repoRoot, setRepoRoot] = useState<string | null>(
    new URLSearchParams(window.location.search).get('repoRoot')
  )
  const [overlay, setOverlay] = useState<Overlay>('none')
  const [surface, setSurface] = useState<Surface>('forge')
  const [openCardDir, setOpenCardDir] = useState<string | null>(null)
  // Keep the latest repoRoot readable from the dispatch-started listener, which
  // is subscribed once — without this it captures a stale (often null) repoRoot
  // and silently skips mirroring the worktree into the sidebar.
  const repoRootRef = useRef<string | null>(repoRoot)
  useEffect(() => {
    repoRootRef.current = repoRoot
  }, [repoRoot])

  // Workspace switch
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('workspace:changed', (data: unknown) => {
      const d = data as { repoRoot?: string | null }
      setRepoRoot(d.repoRoot ?? null)
      setOpenCardDir(null)
      setOverlay('none')
    })
  }, [])

  // Mirror dispatched worktrees into the workspace project list.
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('foundry:dispatch-started', (data: unknown) => {
      const d = data as { branchName?: string; worktreePath?: string }
      if (d.worktreePath && d.branchName) void createWorktreeProject(d.branchName, d.worktreePath)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function createWorktreeProject(branchName: string, worktreePath: string) {
    try {
      const root = repoRootRef.current
      if (!root) return
      const listResult = (await window.electronAPI.workspace.list()) as {
        workspaces: Array<{ id: string; folderPath: string }>
      }
      const workspace = listResult.workspaces.find((w) => w.folderPath === root)
      if (!workspace) return
      await window.electronAPI.project.create({
        workspaceId: workspace.id,
        name: branchName,
        gitBranch: branchName,
        worktreePath,
        isWorktree: true,
      })
    } catch {
      // non-critical
    }
  }

  const workspacePath = repoRoot ?? ''

  // Auto-load assigned tickets onto the board when it opens (and on workspace
  // change). Newly created cards surface via the existing speckit:state-changed
  // broadcast that BoardView subscribes to, so no manual board reload is needed.
  const [importing, setImporting] = useState(false)
  // Tracks the repoRoot currently being reconciled so a re-render (React double-invoke,
  // rapid button clicks) is skipped, while a workspace switch to a *different* repoRoot
  // still gets its own auto-load.
  const reconcilingRef = useRef<string | null>(null)
  const runReconcile = useCallback(async () => {
    if (!repoRoot || reconcilingRef.current === repoRoot) return
    reconcilingRef.current = repoRoot
    setImporting(true)
    try {
      await reconcileAssignedTickets(repoRoot)
    } catch {
      // Backend handlers toast fetch/create failures; nothing to surface here.
    } finally {
      if (reconcilingRef.current === repoRoot) reconcilingRef.current = null
      setImporting(false)
    }
  }, [repoRoot])

  useEffect(() => {
    void runReconcile()
  }, [runReconcile])

  const createCard = useCallback(
    async (brief: {
      title: string
      type: 'feature' | 'bug' | 'chore' | 'spike'
      scope: string
    }) => {
      if (!repoRoot) return
      await getSpeckitAPI().cardCreate({ repoRoot, brief })
      setOverlay('none')
    },
    [repoRoot]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <header className="sk-appbar">
        <span className="sk-appbar__title">Foundry</span>
        <nav className="fdry-tabs" aria-label="Foundry surfaces">
          <button
            type="button"
            className={surface === 'forge' ? 'is-on' : ''}
            aria-pressed={surface === 'forge'}
            onClick={() => setSurface('forge')}
          >
            Forge
          </button>
          <button
            type="button"
            className={surface === 'board' ? 'is-on' : ''}
            aria-pressed={surface === 'board'}
            onClick={() => setSurface('board')}
          >
            Board
          </button>
        </nav>
        <div className="sk-appbar__search">
          {repoRoot && <KnowledgeSearch repoRoot={repoRoot} />}
        </div>
        {/* Moved up from the board's own toolbar, which held this one button and
            cost a full band of chrome to do it. */}
        <button
          type="button"
          className="sk-btn sk-btn--primary"
          onClick={() => setOverlay('new-card')}
        >
          <Plus aria-hidden="true" /> New card
        </button>
        <button
          className="sk-btn"
          onClick={() => void runReconcile()}
          disabled={importing}
          aria-busy={importing}
        >
          {/* Principle XII: no size prop — CSS controls what is drawn. */}
          <Download aria-hidden="true" /> {importing ? 'Importing…' : 'Import ticket'}
        </button>
        <button aria-label="Settings" className="sk-btn" onClick={() => setOverlay('settings')}>
          <Settings aria-hidden="true" />
        </button>
      </header>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {overlay === 'settings' ? (
          <div className="sk-settings-wrap">
            <button className="sk-btn" onClick={() => setOverlay('none')}>
              <ArrowLeft aria-hidden="true" /> Back to board
            </button>
            <SettingsView />
          </div>
        ) : surface === 'forge' ? (
          <Orders repoRoot={repoRoot} />
        ) : (
          <BoardView repoRoot={workspacePath} onOpenCard={(dir) => setOpenCardDir(dir)} />
        )}
      </div>

      {openCardDir && (
        <div className="sk-drawer">
          <CardDetail
            featureDir={openCardDir}
            workspacePath={workspacePath}
            onClose={() => setOpenCardDir(null)}
          />
        </div>
      )}

      {overlay === 'new-card' && (
        <Dialog title="New card" actions={[]} onDismiss={() => setOverlay('none')}>
          {/* CardBriefEditor carries its own submit and cancel, so the dialog
              takes no actions of its own rather than showing a second set. */}
          <CardBriefEditor
            submitLabel="Create card"
            onSubmit={createCard}
            onCancel={() => setOverlay('none')}
          />
        </Dialog>
      )}
    </div>
  )
}
