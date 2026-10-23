import { noPayload } from '@terminator/extension-sdk'
import type { ExtensionAPI } from '@terminator/extension-sdk'

import { foundryChannel } from './channel.js'
import { ViewPayload } from './payloads.js'
import type { ForgeChannels } from './forge-channels.js'

import { disposables, reg } from './register.js'
import { inBackground } from '../background.js'

// Auto-expires so a late manual visit to the Forge doesn't surprise the
// operator with an intake that opened itself for no reason they can see.
let pendingNewOrder = false
let pendingNewOrderTimer: NodeJS.Timeout | null = null

// Anything but 'factory' reads as 'list' — an unset or corrupted setting is
// the same as never having chosen the newer view.
function viewSetting(api: ExtensionAPI): 'list' | 'factory' {
  return api.settings.get<string>('terminator.foundry.view') === 'factory' ? 'factory' : 'list'
}

/** Which view draws the Forge, and an intake asked for before the view existed. */
export function registerViewChannels(api: ExtensionAPI): void {
  reg(
    api,
    foundryChannel('foundry:ui.view', noPayload, () => ({ view: viewSetting(api) })),
    foundryChannel('foundry:ui.set-view', ViewPayload, ({ view }) => {
      api.settings.set('terminator.foundry.view', view)
      api.window.broadcast('foundry:ui.view-changed', { view })
      return { view }
    }),
    // Renderer calls this on mount to pick up an intake request triggered
    // before the main view existed.
    foundryChannel('foundry:ui.consume-pending-new-order', noPayload, () => {
      const pending = pendingNewOrder
      pendingNewOrder = false
      if (pendingNewOrderTimer !== null) {
        clearTimeout(pendingNewOrderTimer)
        pendingNewOrderTimer = null
      }
      return { pending }
    })
  )
}

/** The palette's fixed commands: a new work order, the view toggle, and opening Foundry from Home. */
export function registerCommands(api: ExtensionAPI, forge: Pick<ForgeChannels, 'create'>): void {
  disposables.push(
    api.commands.register(
      {
        id: 'new-order',
        label: 'New work order…',
        category: 'Foundry',
        mnemonic: 'n',
      },
      (_context, args?: unknown) => {
        const ticket = ticketOf(args)
        if (ticket === null) openNewOrder(api)
        else inBackground(orderFromTicket(api, forge, ticket))
      }
    )
  )

  registerOpenOrder(api)
  registerToggleView(api)
}

// Home's "Open" on a Foundry item: bring Foundry forward and open that order in its list.
function registerOpenOrder(api: ExtensionAPI): void {
  disposables.push(
    api.commands.register(
      { id: 'open-order', label: 'Open Foundry', category: 'Foundry' },
      (_context, args?: unknown) => {
        api.window.showSelf('main')
        const orderId = (args as { orderId?: unknown } | undefined)?.orderId
        if (typeof orderId === 'string') api.window.broadcast('foundry:ui.open-order', { orderId })
      }
    )
  )
}

function registerToggleView(api: ExtensionAPI): void {
  disposables.push(
    api.commands.register(
      {
        id: 'toggle-view',
        label: 'Toggle factory view',
        category: 'Foundry',
        mnemonic: 'v',
      },
      () => {
        const next = viewSetting(api) === 'factory' ? 'list' : 'factory'
        api.settings.set('terminator.foundry.view', next)
        api.window.showSelf('main')
        api.window.broadcast('foundry:ui.view-changed', { view: next })
      }
    )
  )
}

interface TicketArgs {
  readonly tracker: 'linear' | 'jira'
  readonly key: string
  readonly repoRoot: string
}

/** The ticket Home's Start work launcher passed, when it passed one. */
function ticketOf(args: unknown): TicketArgs | null {
  const { tracker, key, repoRoot } = (args ?? {}) as Record<string, unknown>
  const knownTracker = tracker === 'linear' || tracker === 'jira'
  if (!knownTracker || typeof key !== 'string' || typeof repoRoot !== 'string') return null
  return { tracker, key, repoRoot }
}

// The same call the Forge's ticket picker makes; the order it opens is the form, prefilled.
async function orderFromTicket(
  api: ExtensionAPI,
  forge: Pick<ForgeChannels, 'create'>,
  ticket: TicketArgs
): Promise<void> {
  const { tracker, key, repoRoot } = ticket
  const created = (await forge.create({
    source: { kind: 'tracker', tracker, key },
    repoPaths: [repoRoot],
  })) as { order?: { id: string }; existing?: { id: string }; error?: string }
  const orderId = created.order?.id ?? created.existing?.id
  if (orderId === undefined) {
    api.notifications.showToast(
      'error',
      created.error ?? `Could not start ${key}.`,
      `ticket-${key}`
    )
    return
  }
  api.window.showSelf('main')
  api.window.broadcast('foundry:ui.open-order', { orderId })
}

function openNewOrder(api: ExtensionAPI): void {
  api.window.showSelf('main')
  // Broadcast to a running view, and set a pending flag for one not yet created, as
  // Notepad's quick-create does; otherwise a command run before the view is dropped.
  api.window.broadcast('foundry:ui.open-new-order', {})
  pendingNewOrder = true
  if (pendingNewOrderTimer !== null) clearTimeout(pendingNewOrderTimer)
  pendingNewOrderTimer = setTimeout(() => {
    pendingNewOrder = false
    pendingNewOrderTimer = null
  }, 5000)
}

export function clearPendingNewOrder(): void {
  if (pendingNewOrderTimer !== null) clearTimeout(pendingNewOrderTimer)
  pendingNewOrderTimer = null
  pendingNewOrder = false
}
