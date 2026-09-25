import React, { useEffect, useState } from 'react'
import { Settings, ArrowLeft, List, Factory } from 'lucide-react'
import { Inbox } from '../components/Inbox.js'
import { Orders } from '../components/Orders.js'
import { Ledger } from '../components/Ledger.js'
import { SettingsView } from '../components/SettingsView.js'
import { FactorySite } from '../components/factory/FactorySite.js'
import { FactoryHall } from '../components/factory/FactoryHall.js'
import type { FactoryOrderRow } from '../components/factory/FactorySite.js'

// Three surfaces, and a way into settings.
//
// The inbox is home because it is the one surface the operator is required to
// visit: everything a rule raises reaches them there, ranked by how much work
// it unblocks. The Forge is where an idea becomes an agreed order, and where
// an order that is already running is watched. The Ledger is the record, and
// the only place the factory ever argues back — on request.
//
// What used to be here — a board, a card drawer, a phase rail, a new-card
// dialog and a ticket importer — went with the pipeline underneath it. A board
// is a place to notice things; an inbox is a place things come to.

type Surface = 'inbox' | 'forge' | 'ledger'

const SURFACES: readonly { id: Surface; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'forge', label: 'Forge' },
  { id: 'ledger', label: 'Ledger' },
]

/** What is waiting for the operator, per surface. */
interface Attention {
  inbox: number
  forge: number
}

/** How often the counts are refetched. Fast enough to notice, cheap to serve. */
const ATTENTION_POLL_MS = 4000

export function App(): JSX.Element {
  const [repoRoot, setRepoRoot] = useState<string | null>(
    new URLSearchParams(window.location.search).get('repoRoot')
  )
  const [surface, setSurface] = useState<Surface>('inbox')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [waiting, setWaiting] = useState<Attention>({ inbox: 0, forge: 0 })
  const [focusIdeaSignal, setFocusIdeaSignal] = useState(0)

  // The Forge's own view: a list of orders, or a hall drawn from the run
  // graph. Per-operator (`terminator.foundry.view`), never per-order — the
  // Inbox, Ledger and Settings are unaffected either way.
  const [factoryView, setFactoryView] = useState<'list' | 'factory'>('list')
  // The hall currently open, or null for the site (the grid of every hall).
  const [factoryOrder, setFactoryOrder] = useState<FactoryOrderRow | null>(null)
  // An order the site handed back to the list because it is still being
  // shaped — that half of an order has no hall of its own to draw.
  const [listOpenOrderId, setListOpenOrderId] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.extensionBridge
      .invoke('foundry:ui.view')
      .then((result: unknown) => {
        const next = (result as { view?: string }).view
        if (next === 'factory') setFactoryView('factory')
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    return window.electronAPI.extensionBridge.on('foundry:ui.view-changed', (data: unknown) => {
      const next = (data as { view?: string }).view
      setFactoryView(next === 'factory' ? 'factory' : 'list')
    })
  }, [])

  const setForgeView = (next: 'list' | 'factory'): void => {
    setFactoryOrder(null)
    setListOpenOrderId(null)
    setFactoryView(next)
    void window.electronAPI.extensionBridge.invoke('foundry:ui.set-view', { view: next })
  }

  // Where an order opened from the site goes: the hall if a line is actually
  // running it, back to the list — open — if it is still being agreed. A
  // gate order the recipe never started has no run graph for a hall to draw.
  const openFromSite = (order: FactoryOrderRow): void => {
    const shaping =
      order.standing?.kind === 'shaping' ||
      (order.standing === undefined && order.status === 'draft')
    if (shaping) {
      setFactoryOrder(null)
      setFactoryView('list')
      setListOpenOrderId(order.id)
    } else {
      setFactoryOrder(order)
    }
  }

  // The "New work order…" quick action's target: bring the Forge into view
  // with the cursor already in the idea box, whether the extension's own view
  // was open when it ran or not.
  const openNewOrder = (): void => {
    setSettingsOpen(false)
    setSurface('forge')
    setFocusIdeaSignal((n) => n + 1)
  }

  useEffect(() => {
    return window.electronAPI.extensionBridge.on('foundry:ui.open-new-order', () => openNewOrder())
  }, [])

  // On first mount, pick up a request that fired before this view existed.
  useEffect(() => {
    window.electronAPI.extensionBridge
      .invoke('foundry:ui.consume-pending-new-order')
      .then((result: unknown) => {
        if ((result as { pending?: boolean }).pending) openNewOrder()
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The counts, on the one piece of chrome that is on screen whatever surface
  // you are looking at. Everything Foundry holds for a person lives behind one
  // of these three tabs, and until this existed a tab said nothing until you
  // clicked it — so an open question or a held tool call was only ever found
  // by somebody who went looking for it on the off chance.
  useEffect(() => {
    let live = true
    const read = async (): Promise<void> => {
      try {
        const next = (await window.electronAPI.extensionBridge.invoke(
          'foundry:attention',
          {}
        )) as Attention
        if (live) setWaiting({ inbox: next.inbox ?? 0, forge: next.forge ?? 0 })
      } catch {
        // The badge is an affordance, not the queue. A failed poll leaves the
        // last count up rather than taking the chrome down with it.
      }
    }
    void read()
    const timer = setInterval(() => void read(), ATTENTION_POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])

  // Orders are per-repository, so a workspace switch resets the surfaces.
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('workspace:changed', (data: unknown) => {
      const d = data as { repoRoot?: string | null }
      setRepoRoot(d.repoRoot ?? null)
      setSettingsOpen(false)
      setFactoryOrder(null)
      setListOpenOrderId(null)
    })
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <header className="sk-appbar">
        <span className="sk-appbar__title">Foundry</span>
        <nav className="fdry-tabs" aria-label="Foundry surfaces">
          {SURFACES.map((tab) => {
            const count =
              tab.id === 'inbox' ? waiting.inbox : tab.id === 'forge' ? waiting.forge : 0
            return (
              <button
                key={tab.id}
                type="button"
                // Settings covers the surfaces, so while it is open none of them
                // is the one showing. Reporting one as pressed told a screen
                // reader "Ledger, pressed" over a settings panel.
                className={!settingsOpen && surface === tab.id ? 'is-on' : ''}
                aria-pressed={!settingsOpen && surface === tab.id}
                // The count is in the accessible name, not only in a badge: a
                // number rendered beside the label is read as a second, unrelated
                // thing, and "Forge 2" tells a screen reader nothing about what
                // the two are.
                aria-label={count > 0 ? `${tab.label}, ${count} waiting on you` : undefined}
                onClick={() => {
                  // Closes settings as well as choosing: without this, clicking a
                  // tab from inside settings changed the surface underneath and
                  // did nothing anybody could see.
                  setSettingsOpen(false)
                  setSurface(tab.id)
                }}
              >
                {tab.label}
                {count > 0 ? (
                  <span className="fdry-tab-count" aria-hidden="true">
                    {count}
                  </span>
                ) : null}
              </button>
            )
          })}
        </nav>
        {!settingsOpen && surface === 'forge' ? (
          <div className="fdry-view-toggle" role="group" aria-label="Forge view">
            <button
              type="button"
              aria-label="List view"
              aria-pressed={factoryView === 'list'}
              className={factoryView === 'list' ? 'is-on' : ''}
              onClick={() => setForgeView('list')}
            >
              <List aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Factory view"
              aria-pressed={factoryView === 'factory'}
              className={factoryView === 'factory' ? 'is-on' : ''}
              onClick={() => setForgeView('factory')}
            >
              <Factory aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <button
          aria-label="Settings"
          className="sk-btn"
          aria-pressed={settingsOpen}
          style={{ marginLeft: 'auto' }}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings aria-hidden="true" />
        </button>
      </header>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {settingsOpen ? (
          <div className="sk-settings-wrap">
            <button aria-label="Back" className="sk-btn" onClick={() => setSettingsOpen(false)}>
              <ArrowLeft aria-hidden="true" /> Back
            </button>
            <SettingsView />
          </div>
        ) : surface === 'inbox' ? (
          <Inbox />
        ) : surface === 'ledger' ? (
          <Ledger />
        ) : factoryView === 'factory' ? (
          factoryOrder === null ? (
            <FactorySite repoRoot={repoRoot} onOpen={openFromSite} />
          ) : (
            <FactoryHall
              orderId={factoryOrder.id}
              onOpenInbox={() => setSurface('inbox')}
              onOpenInList={() => {
                setListOpenOrderId(factoryOrder.id)
                setFactoryOrder(null)
                setFactoryView('list')
              }}
              onBack={() => setFactoryOrder(null)}
            />
          )
        ) : (
          <Orders
            repoRoot={repoRoot}
            focusIdeaSignal={focusIdeaSignal}
            openOrderId={listOpenOrderId}
          />
        )}
      </div>
    </div>
  )
}
