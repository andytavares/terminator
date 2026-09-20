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
  disabledReason?: string
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

export function buildExtensionActions(
  registered: RegisteredCommand[],
  declared: DeclaredCommand[],
  groups: QuickActionGroup[],
  ctx: ActionContext,
  execute: (key: string, ctx: ActionContext) => void,
  rendererCommands: RendererCommand[] = []
): QuickAction[] {
  const actions: QuickAction[] = []
  const registeredIds = new Set(registered.map((c) => `${c.extensionId}:${c.id}`))

  for (const cmd of registered) {
    actions.push({
      id: `ext:${cmd.extensionId}.command.${cmd.id}`,
      label: cmd.label,
      group: groupFor(cmd.extensionId, groups),
      mnemonic: cmd.mnemonic,
      shortcut: cmd.shortcut,
      description: cmd.description,
      disabledReason: cmd.disabledReason ?? requiresReason(cmd.requires, ctx),
      run: () => execute(cmd.key, ctx),
    })
  }

  for (const cmd of declared) {
    if (registeredIds.has(`${cmd.extensionId}:${cmd.id}`)) continue
    actions.push({
      id: `ext:${cmd.extensionId}.command.${cmd.id}`,
      label: cmd.label,
      group: groupFor(cmd.extensionId, groups),
      mnemonic: cmd.mnemonic,
      shortcut: cmd.shortcut,
      description: cmd.description,
      disabledReason: 'Extension did not register this command',
      run: () => {},
    })
  }

  for (const cmd of rendererCommands) {
    actions.push({
      id: `renderer:${cmd.id}`,
      label: cmd.label,
      group: 'top',
      shortcut: cmd.shortcut,
      description: cmd.description,
      run: cmd.action,
    })
  }

  return actions
}
