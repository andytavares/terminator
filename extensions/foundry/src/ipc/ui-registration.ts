import { noPayload } from '@terminator/extension-sdk'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { z } from 'zod'

import { foundryChannel } from './channel.js'
import { ViewPayload } from './payloads.js'
import type { ForgeChannels } from './forge-channels.js'

import { disposables, reg } from './register.js'
import { inBackground } from '../background.js'

// Core passes a command its arguments only when it declares them (src/main/extensions/api.ts).
const NewOrderArgs = z
  .object({
    tracker: z.string().optional(),
    key: z.string().optional(),
    title: z.string().optional(),
    prompt: z.string().optional(),
    repoRoot: z.string().optional(),
  })
  .optional()
const OpenOrderArgs = z.object({ orderId: z.string().optional() }).optional()

// Auto-expires so a late manual visit to the Forge doesn't surprise the
// operator with an intake that opened itself for no reason they can see.
export type PendingRequest = { kind: 'new' } | { kind: 'order'; orderId: string }
let pendingRequest: PendingRequest | null = null
let pendingTimer: NodeJS.Timeout | null = null

// Anything but 'factory' reads as 'list' — an unset or corrupted setting is
// the same as never having chosen the newer view.
export function viewSetting(api: ExtensionAPI): 'list' | 'factory' {
  return api.settings.get<string>('terminator.foundry.view') === 'factory' ? 'factory' : 'list'
}

/** Which view draws the Forge, and an intake asked for before the view existed. */
export function registerViewChannels(api: ExtensionAPI): void {
  reg(
    api,
    foundryChannel('foundry:ui.view', noPayload, () => ({ view: viewSetting(api) })),
    foundryChannel('foundry:ui.set-view', ViewPayload, (payload) => setView(api, payload)),
    // Renderer calls this on mount to pick up an intake request triggered
    // before the main view existed.
    foundryChannel('foundry:ui.consume-pending-new-order', noPayload, consumePendingNewOrder)
  )
}

export function setView(api: ExtensionAPI, { view }: z.infer<typeof ViewPayload>) {
  api.settings.set('terminator.foundry.view', view)
  api.window.broadcast('foundry:ui.view-changed', { view })
  return { view }
}

export function consumePendingNewOrder(): { pending: PendingRequest | null } {
  const pending = pendingRequest
  clearPendingNewOrder()
  return { pending }
}

function setPending(request: PendingRequest): void {
  clearPendingNewOrder()
  pendingRequest = request
  pendingTimer = setTimeout(clearPendingNewOrder, 5000)
}

/** The palette's fixed commands, and the two that Start work and Home call with arguments. */
export function registerCommands(api: ExtensionAPI, forge: Pick<ForgeChannels, 'create'>): void {
  disposables.push(
    api.commands.register(
      { id: 'new-order', label: 'New work order…', category: 'Foundry', mnemonic: 'n' },
      () => openNewOrder(api)
    ),
    // Start work's "Foundry order": a command with args is no quick action (src/main/extensions/api.ts).
    api.commands.register(
      { id: 'start-order', label: 'Start a work order', category: 'Foundry', args: NewOrderArgs },
      (_context, args?: unknown) => {
        const source = sourceOf(args)
        if (source === null) openNewOrder(api)
        else inBackground(createThenOpen(api, forge, source))
      }
    )
  )
  registerOpenOrder(api)
  registerToggleView(api)
}

// The palette's "Open Foundry", and Home's "Open" on a Foundry item, which names the order.
function registerOpenOrder(api: ExtensionAPI): void {
  disposables.push(
    api.commands.register({ id: 'open-order', label: 'Open Foundry', category: 'Foundry' }, () =>
      api.window.showSelf('main')
    ),
    api.commands.register(
      { id: 'show-order', label: 'Show a work order', category: 'Foundry', args: OpenOrderArgs },
      (_context, args?: unknown) => {
        api.window.showSelf('main')
        const orderId = (args as { orderId?: unknown } | undefined)?.orderId
        if (typeof orderId === 'string') openOrder(api, orderId)
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

interface StartedSource {
  readonly source:
    | { kind: 'tracker'; tracker: 'linear'; key: string }
    | { kind: 'typed'; text: string }
  readonly repoRoot: string
  readonly label: string
}

/** The ticket or prompt Home's Start work launcher passed, when it passed one. */
function sourceOf(args: unknown): StartedSource | null {
  const { tracker, key, prompt, repoRoot } = (args ?? {}) as Record<string, unknown>
  if (typeof repoRoot !== 'string') return null
  if (tracker === 'linear' && typeof key === 'string') {
    return { source: { kind: 'tracker', tracker, key }, repoRoot, label: key }
  }
  if (typeof prompt === 'string' && prompt !== '') {
    return { source: { kind: 'typed', text: prompt }, repoRoot, label: 'that prompt' }
  }
  return null
}

// The same call the Forge's picker makes; the order it opens is the form, prefilled.
async function createThenOpen(
  api: ExtensionAPI,
  forge: Pick<ForgeChannels, 'create'>,
  { source, repoRoot, label }: StartedSource
): Promise<void> {
  const created = (await forge.create({ source, repoPaths: [repoRoot] })) as {
    order?: { id: string }
    existing?: { id: string }
    error?: string
  }
  const orderId = created.order?.id ?? created.existing?.id
  if (orderId === undefined) {
    api.notifications.showToast(
      'error',
      created.error ?? `Could not start ${label}.`,
      `start-${label}`
    )
    return
  }
  openOrder(api, orderId)
}

// Broadcast to a running view, and set a pending request for one still loading;
// otherwise a command run before the view mounts is dropped.
function openOrder(api: ExtensionAPI, orderId: string): void {
  api.window.showSelf('main')
  api.window.broadcast('foundry:ui.open-order', { orderId })
  setPending({ kind: 'order', orderId })
}

function openNewOrder(api: ExtensionAPI): void {
  api.window.showSelf('main')
  api.window.broadcast('foundry:ui.open-new-order', {})
  setPending({ kind: 'new' })
}

export function clearPendingNewOrder(): void {
  if (pendingTimer !== null) clearTimeout(pendingTimer)
  pendingTimer = null
  pendingRequest = null
}
