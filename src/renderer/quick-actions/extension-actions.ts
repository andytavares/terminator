import type { QuickAction, QuickActionGroup, ActionContext } from './types'

export interface RegisteredCommand {
  key: string
  extensionId: string
  id: string
  label: string
  description?: string
  shortcut?: string
  category?: string
  mnemonic?: string
  requires?: 'repo' | 'session'
}

export interface DeclaredCommand {
  extensionId: string
  id: string
  label: string
  mnemonic?: string
  shortcut?: string
  description?: string
  requires?: 'repo' | 'session'
}

export interface RendererCommand {
  id: string
  label: string
  description?: string
  shortcut?: string
  action(): void
}

const NO_REPO = 'No repository focused'
const NO_TERMINAL = 'No terminal focused'

function requiresReason(
  requires: 'repo' | 'session' | undefined,
  ctx: ActionContext
): string | undefined {
  if (requires === 'repo') return ctx.repoRoot ? undefined : NO_REPO
  if (requires === 'session') return ctx.sessionId ? undefined : NO_TERMINAL
  return undefined
}

function groupFor(extensionId: string, groups: QuickActionGroup[]): string {
  return groups.find((g) => g.owner === extensionId)?.id ?? 'top'
}

/** The commands extensions offer: registered at run time, declared in manifests, and the renderer's own. */
export interface ExtensionCommands {
  registered: RegisteredCommand[]
  declared: DeclaredCommand[]
  renderer?: RendererCommand[]
}

/** How a registered command runs: in this context, through `execute`. */
export interface CommandInvocation {
  ctx: ActionContext
  execute: (key: string, ctx: ActionContext) => void
}

function commandAction(
  cmd: RegisteredCommand | DeclaredCommand,
  groups: QuickActionGroup[]
): Omit<QuickAction, 'run'> {
  return {
    id: `ext:${cmd.extensionId}.command.${cmd.id}`,
    label: cmd.label,
    group: groupFor(cmd.extensionId, groups),
    mnemonic: cmd.mnemonic,
    shortcut: cmd.shortcut,
    description: cmd.description,
  }
}

function rendererAction(cmd: RendererCommand): QuickAction {
  return {
    id: `renderer:${cmd.id}`,
    label: cmd.label,
    group: 'top',
    shortcut: cmd.shortcut,
    description: cmd.description,
    run: cmd.action,
  }
}

export function buildExtensionActions(
  { registered, declared, renderer = [] }: ExtensionCommands,
  groups: QuickActionGroup[],
  { ctx, execute }: CommandInvocation
): QuickAction[] {
  const registeredIds = new Set(registered.map((c) => `${c.extensionId}:${c.id}`))
  const live = registered.map((cmd) => ({
    ...commandAction(cmd, groups),
    disabledReason: requiresReason(cmd.requires, ctx),
    run: () => execute(cmd.key, ctx),
  }))
  const missing = declared
    .filter((cmd) => !registeredIds.has(`${cmd.extensionId}:${cmd.id}`))
    .map((cmd) => ({
      ...commandAction(cmd, groups),
      disabledReason: 'Extension did not register this command',
      run: () => {},
    }))
  return [...live, ...missing, ...renderer.map(rendererAction)]
}
