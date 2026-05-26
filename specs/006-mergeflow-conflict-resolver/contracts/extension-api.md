# Contract: MergeFlow Extension API Surface

**Version**: 1.0.0  
**Date**: 2026-05-25  
**Branch**: `006-mergeflow-conflict-resolver`

This document describes the renderer-side API module that wraps all MergeFlow IPC calls. Components import from this module — they never call `window.electronAPI.extensionBridge.invoke(...)` directly.

---

## API Module

**File**: `extensions/git-integration/src/api/merge-flow.ts`

```typescript
export const mergeFlowAPI = {
  listConflicts(repoRoot: string): Promise<ConflictSession | { error: string }>
  getConflictBlocks(repoRoot: string, filePath: string): Promise<{ blocks: ConflictBlock[] } | { error: string }>
  resolveConflict(repoRoot: string, blockId: string, resolvedText: string, strategy: ResolutionStrategy): Promise<{ success: true } | { error: string }>
  undoResolve(repoRoot: string, blockId: string, originalConflictText: string): Promise<{ success: true } | { error: string }>
  mergeCommit(repoRoot: string, resolvedFilePaths: string[], commitMessage: string): Promise<{ commitHash: string } | { error: string }>
  requestAiSuggestion(params: AiSuggestionRequest): Promise<AISuggestion | { error: string }>
  restoreSession(repoRoot: string): Promise<{ session: ConflictSession | null }>
  persistSession(repoRoot: string, session: ConflictSession): Promise<{ success: true } | { error: string }>
  clearSession(repoRoot: string): Promise<{ success: true }>
}
```

---

## Zustand Store

**File**: `extensions/git-integration/src/stores/merge-flow.store.ts`

Public interface (used by React components):

```typescript
interface MergeFlowStore {
  // State
  session: ConflictSession | null
  activeFileIndex: number
  activeBlockIndex: number
  pendingAiSuggestion: AISuggestion | null
  isKeepBothOpen: boolean
  isAiPanelOpen: boolean
  isLoading: boolean
  error: string | null

  // Session lifecycle
  startSession(session: ConflictSession): void
  clearSession(): void

  // Navigation
  setActiveFile(index: number): void
  setActiveBlock(index: number): void
  goToNextBlock(): void
  goToPrevBlock(): void

  // Resolution
  confirmDecision(blockId: string, resolution: ConflictResolution): void
  undoLastDecision(): ResolutionDecision | null

  // UI modals
  openKeepBoth(): void
  closeKeepBoth(): void
  openAiPanel(suggestion: AISuggestion | null): void
  closeAiPanel(): void

  // Derived (selectors — implemented as zustand computed or selector fns)
  // totalConflicts, totalResolved, isComplete, canUndo, activeFile, activeBlock
}
```

---

## Component Tree

```
GitFullView
└── MergeFlowView              # Root: owns session init and routing
    ├── ConflictHub            # Screen 1 — file list
    ├── ConflictResolver       # Screens 2–3 — single conflict
    │   ├── ConflictHeader     # Progress dots, breadcrumb, undo button
    │   ├── ConflictPanel      # Left: yours / Right: theirs
    │   ├── ResultPreviewStrip # Bottom live preview
    │   ├── ActionBar          # Keep mine / Keep theirs / Keep both / Edit / AI
    │   ├── KeepBothModal      # Screen 4 — overlaid modal
    │   ├── AiSuggestionPanel  # Screen 5 — right-side panel
    │   └── ManualEditor       # Edit-manually mode (replaces ConflictPanel)
    └── CompletionScreen       # Screen 6 — stats + commit
```

---

## Keyboard Shortcut Map

Registered in `ConflictResolver` component. Active only when resolver is mounted and no modal/panel is open.

| Key                | Action                                |
| ------------------ | ------------------------------------- |
| `M`                | Select "Keep mine"                    |
| `T`                | Select "Keep theirs"                  |
| `B`                | Open "Keep both" modal                |
| `E`                | Open manual editor                    |
| `Enter`            | Confirm current selection and advance |
| `ArrowLeft`        | Go to previous conflict               |
| `ArrowRight`       | Go to next conflict                   |
| `Cmd+Z` / `Ctrl+Z` | Undo last confirmed decision          |
| `Cmd+Shift+A`      | Open AI suggestion panel              |
| `Esc`              | Close AI panel or Keep Both modal     |

---

## Entry Point Integration

`GitFullView.tsx` gains a conditional branch:

```typescript
if (status?.hasConflicts && view === 'merge-flow') {
  return <MergeFlowView repoRoot={repoRoot} />
}
```

`GitSidebarPanel.tsx` gains a "Resolve conflicts →" button when `status.hasConflicts === true`, which sets `view = 'merge-flow'` in the git store (new `view` field).
