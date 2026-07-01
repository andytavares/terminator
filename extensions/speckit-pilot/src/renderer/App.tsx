import React, { useCallback, useEffect, useState } from 'react'
import { Settings, Download, X } from 'lucide-react'
import { BoardView } from '../components/BoardView.js'
import { CardDetail } from '../components/CardDetail.js'
import { CardBriefEditor } from '../components/CardBriefEditor.js'
import { KnowledgeSearch } from '../components/KnowledgeSearch.js'
import { ImportTicketModal } from '../components/ImportTicketModal.js'
import { SettingsView } from '../components/SettingsView.js'
import { getSpeckitAPI } from '../types/electron.js'

type Overlay = 'none' | 'new-card' | 'import' | 'settings'

export function App(): JSX.Element {
  const [repoRoot, setRepoRoot] = useState<string | null>(
    new URLSearchParams(window.location.search).get('repoRoot')
  )
  const [overlay, setOverlay] = useState<Overlay>('none')
  const [openCardDir, setOpenCardDir] = useState<string | null>(null)

  // Workspace switch
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('workspace:changed', (data: unknown) => {
      const d = data as { repoRoot?: string | null }
      setRepoRoot(d.repoRoot ?? null)
      setOpenCardDir(null)
      setOverlay('none')
    })
  }, [])

  // Mirror dispatched worktrees into the workspace project list (unchanged behavior)
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('speckit:dispatch-started', (data: unknown) => {
      const d = data as { branchName?: string; worktreePath?: string }
      if (d.worktreePath && d.branchName) void createWorktreeProject(d.branchName, d.worktreePath)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function createWorktreeProject(branchName: string, worktreePath: string) {
    try {
      if (!repoRoot) return
      const listResult = (await window.electronAPI.workspace.list()) as {
        workspaces: Array<{ id: string; folderPath: string }>
      }
      const workspace = listResult.workspaces.find((w) => w.folderPath === repoRoot)
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
        <span className="sk-appbar__title">SpecKit Pilot</span>
        <div className="sk-appbar__search">
          {repoRoot && <KnowledgeSearch repoRoot={repoRoot} />}
        </div>
        <button className="sk-btn" onClick={() => setOverlay('import')}>
          <Download size={14} /> Import ticket
        </button>
        <button aria-label="Settings" className="sk-btn" onClick={() => setOverlay('settings')}>
          <Settings size={14} />
        </button>
      </header>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {overlay === 'settings' ? (
          <div className="sk-settings-wrap">
            <button className="sk-btn" onClick={() => setOverlay('none')}>
              ← Back to board
            </button>
            <SettingsView />
          </div>
        ) : (
          <BoardView
            repoRoot={workspacePath}
            onOpenCard={(dir) => setOpenCardDir(dir)}
            onNewCard={() => setOverlay('new-card')}
          />
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
        <div className="sk-modal" role="dialog" aria-label="New card">
          <div className="sk-modal__panel">
            <header className="sk-modal__head">
              <h2>New card</h2>
              <button type="button" aria-label="Close" onClick={() => setOverlay('none')}>
                <X size={16} />
              </button>
            </header>
            <CardBriefEditor
              submitLabel="Create card"
              onSubmit={createCard}
              onCancel={() => setOverlay('none')}
            />
          </div>
        </div>
      )}

      {overlay === 'import' && repoRoot && (
        <ImportTicketModal
          repoRoot={repoRoot}
          onClose={() => setOverlay('none')}
          onImported={() => setOverlay('none')}
        />
      )}
    </div>
  )
}
