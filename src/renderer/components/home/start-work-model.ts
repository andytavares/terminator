import { useEffect, useMemo, useState } from 'react'
import { defaultBranchFirst, freeBranches } from '../sidebar/create-project'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import {
  askBranchName,
  groupTickets,
  defaultWorkspaceId,
  type SuggestionReason,
  type TicketGroup,
} from './start-work'
import type { IssueSummary, Workspace } from '../../../shared/types/index'

// What the Start work launcher shows: the lists on its left and the facts on its right.

export type LauncherTab = 'tickets' | 'prompt' | 'branch' | 'across' | 'scratch'

export type LauncherRow =
  | { kind: 'ticket'; issue: IssueSummary }
  | { kind: 'prompt'; text: string }
  | { kind: 'branch'; name: string; hasWorktree: boolean }

/** Every open ticket assigned to the person, read once when the launcher opens. */
export function useMyTickets(): IssueSummary[] {
  const [issues, setIssues] = useState<IssueSummary[]>([])
  useEffect(() => {
    let current = true
    void useIntegrationsStore
      .getState()
      .listMine()
      .then((result) => current && setIssues(result.issues))
    return () => {
      current = false
    }
  }, [])
  return issues
}

export interface RepoGit {
  /** The repo's default branch, which a new worktree starts from. */
  base: string | null
  worktreeBranches: string[]
  freeBranchNames: string[]
}

export const NO_GIT: RepoGit = { base: null, worktreeBranches: [], freeBranchNames: [] }

/** The repo's branches and worktrees, read again when the repo changes. */
export function useRepoGit(workspace: Workspace | null): RepoGit {
  const [git, setGit] = useState<RepoGit>(NO_GIT)
  const folderPath = workspace?.folderPath
  useEffect(() => {
    if (folderPath === undefined) return
    let current = true
    void readRepoGit(folderPath).then((read) => current && setGit(read))
    return () => {
      current = false
    }
  }, [folderPath])
  return git
}

async function readRepoGit(folderPath: string): Promise<RepoGit> {
  const repo = await window.electronAPI.git.isRepo(folderPath)
  // No answer shows no branches, as a plain folder does; the launcher reads again each time it opens.
  if ('error' in repo || !repo.isRepo || !repo.root) return NO_GIT
  const [{ branches }, { worktrees }] = await Promise.all([
    window.electronAPI.git.listBranches(repo.root),
    window.electronAPI.git.listWorktrees(repo.root),
  ])
  const local = branches.filter((b) => !b.isRemote)
  return {
    base: defaultBranchFirst(local)[0]?.name ?? null,
    worktreeBranches: worktrees.filter((w) => !w.isMain).map((w) => w.branch),
    freeBranchNames: freeBranches(local, worktrees).map((b) => b.name),
  }
}

/** A pause in typing this long starts asking the agent for a branch name. */
const NAMING_PAUSE_MS = 800

/** The branch the agent names for `prompt`, asked for once typing pauses; null until it answers. */
export function useAgentBranchName(prompt: string, enabled: boolean): string | null {
  const [named, setNamed] = useState<{ prompt: string; branch: string } | null>(null)
  useEffect(() => {
    if (!enabled || prompt === '') return
    let current = true
    const timer = setTimeout(() => {
      void askBranchName(prompt).then(
        (branch) => current && branch !== null && setNamed({ prompt, branch })
      )
    }, NAMING_PAUSE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [prompt, enabled])
  return enabled && named?.prompt === prompt ? named.branch : null
}

export interface RowSource {
  tab: LauncherTab
  query: string
  issues: IssueSummary[]
  git: RepoGit
}

const promptRow = (text: string): LauncherRow => ({ kind: 'prompt', text })

/** The rows the arrow keys move through, top to bottom, as the left side draws them. */
export function useRows(source: RowSource): { groups: TicketGroup[]; rows: LauncherRow[] } {
  const { tab, query, issues, git } = source
  return useMemo(() => {
    const text = query.trim()
    if (tab === 'tickets') {
      const groups = groupTickets(issues, query)
      const tickets = groups.flatMap((g) =>
        g.issues.map((issue) => ({ kind: 'ticket' as const, issue }))
      )
      return { groups, rows: text === '' ? tickets : [...tickets, promptRow(text)] }
    }
    if (tab === 'branch') return { groups: [], rows: branchChoices(git, text) }
    return { groups: [], rows: [] }
  }, [tab, query, issues, git])
}

function branchChoices(git: RepoGit, text: string): LauncherRow[] {
  const matches = (name: string): boolean => name.toLowerCase().includes(text.toLowerCase())
  return [
    ...git.worktreeBranches
      .filter(matches)
      .map((name) => ({ kind: 'branch' as const, name, hasWorktree: true })),
    ...git.freeBranchNames
      .filter(matches)
      .map((name) => ({ kind: 'branch' as const, name, hasWorktree: false })),
  ]
}

/** The picker's choice of no workspace: a global scheduled run, offered on the Prompt tab only. */
export const GLOBAL_CHOICE = 'global'

export type ChosenRepo = {
  workspace: Workspace | null
  reason: 'picked' | SuggestionReason
  /** True when the person picked Global: the work belongs to no workspace. */
  global: boolean
}

/** The repo the work goes to: the person's pick, else the best guess for the selected ticket. */
export function useChosenRepo(
  selected: LauncherRow | undefined,
  pickedId: string | null
): ChosenRepo {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  if (pickedId === GLOBAL_CHOICE) return { workspace: null, reason: 'picked', global: true }
  const issue = selected?.kind === 'ticket' ? selected.issue : null
  const suggestion = defaultWorkspaceId(issue)
  const id = pickedId ?? suggestion.id
  const reason = pickedId === null ? suggestion.reason : 'picked'
  return { workspace: workspaces.find((w) => w.id === id) ?? null, reason, global: false }
}
