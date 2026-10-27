import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Settings, ArrowLeft, List, Factory } from 'lucide-react'
import { Button, IconButton, Tab, TabList, TabsRoot } from '@terminator/extension-ui'
import { Inbox } from '../components/Inbox.js'
import { useFoundryQuery, ANY_RECORD } from './foundry-query.js'
import type { FactoryOrderRow } from '../components/factory/FactorySite.js'

// The window shows one view under the queue, so each is its own chunk and the
// first script stays under the renderer's chunk budget (vite.renderer.config.ts;
// https://react.dev/reference/react/lazy, https://vite.dev/guide/features#dynamic-import).
const Orders = lazy(() => import('../components/Orders.js').then((m) => ({ default: m.Orders })))
const Ledger = lazy(() => import('../components/Ledger.js').then((m) => ({ default: m.Ledger })))
const SettingsView = lazy(() =>
  import('../components/SettingsView.js').then((m) => ({ default: m.SettingsView }))
)
const FactorySite = lazy(() =>
  import('../components/factory/FactorySite.js').then((m) => ({ default: m.FactorySite }))
)
const FactoryHall = lazy(() =>
  import('../components/factory/FactoryHall.js').then((m) => ({ default: m.FactoryHall }))
)

// Two surfaces, and a way into settings.
//
// The Forge is home: it is where an idea becomes an agreed order, and where an
// order that is already running is watched. Everything a rule raises sits in a
// band across its top, ranked by how much work it unblocks, and the band is
// gone when nothing is waiting — the Inbox used to be a tab of its own, and
// between runs that tab was an empty page you landed on. The Ledger is the
// record, and the only place the factory ever argues back — on request.
//
// What used to be here — a board, a card drawer, a phase rail, a new-card
// dialog and a ticket importer — went with the pipeline underneath it. A board
// is a place to notice things; an inbox is a place things come to.

type Surface = 'forge' | 'ledger'

const SURFACES: readonly { id: Surface; label: string }[] = [
  { id: 'forge', label: 'Forge' },
  { id: 'ledger', label: 'Ledger' },
]

/** What is waiting for the operator, per surface. */
interface Attention {
  inbox: number
  forge: number
}

// The badge is an affordance, not the queue. A failed read leaves the last count up
// rather than taking the chrome down with it.
async function readAttention(): Promise<Attention> {
  return (await window.electronAPI.extensionBridge.invoke('foundry:attention', {})) as Attention
}

type ForgeViewKind = 'list' | 'factory'

/** Which view draws the Forge, the hall open in it, and the order the list was asked to open. */
interface ForgeView {
  readonly view: ForgeViewKind
  readonly hall: FactoryOrderRow | null
  readonly listOpenOrderId: string | null
  /** The operator chose a view: persisted, and nothing stays open across it. */
  readonly choose: (next: ForgeViewKind) => void
  readonly openFromSite: (order: FactoryOrderRow) => void
  /** Shows an order open in the List view, leaving any hall. */
  readonly openInList: (orderId: string) => void
  readonly leaveHall: () => void
  /** Leaves any hall and any order the list had open, keeping the view. */
  readonly reset: () => void
}

// The Forge's view: a list of orders, or a hall drawn from the run graph. Per operator
// (`terminator.foundry.view`), never per order; the Ledger and Settings are unaffected.
function useForgeView(): ForgeView {
  const [view, setView] = useState<ForgeViewKind>('list')
  // The hall currently open, or null for the site (the grid of every hall).
  const [hall, setHall] = useState<FactoryOrderRow | null>(null)
  // An order the site handed back to the list because it is still being
  // shaped — that half of an order has no hall of its own to draw.
  const [listOpenOrderId, setListOpenOrderId] = useState<string | null>(null)
  useSavedForgeView(setView)

  const openInList = (orderId: string): void => {
    setHall(null)
    setView('list')
    setListOpenOrderId(orderId)
  }
  const clearOpened = (): void => {
    setHall(null)
    setListOpenOrderId(null)
  }
  return {
    view,
    hall,
    listOpenOrderId,
    choose: (next) => {
      clearOpened()
      setView(next)
      void window.electronAPI.extensionBridge.invoke('foundry:ui.set-view', { view: next })
    },
    openFromSite: (order) => (isShaping(order) ? openInList(order.id) : setHall(order)),
    openInList,
    leaveHall: () => setHall(null),
    reset: clearOpened,
  }
}

/** The view the operator last chose, and any change to it made elsewhere. */
function useSavedForgeView(setView: (view: ForgeViewKind) => void): void {
  useEffect(() => {
    window.electronAPI.extensionBridge
      .invoke('foundry:ui.view')
      .then((result: unknown) => {
        if ((result as { view?: string }).view === 'factory') setView('factory')
      })
      .catch(() => {})
  }, [setView])

  useEffect(() => {
    return window.electronAPI.extensionBridge.on('foundry:ui.view-changed', (data: unknown) => {
      setView((data as { view?: string }).view === 'factory' ? 'factory' : 'list')
    })
  }, [setView])
}

// Where an order opened from the site goes: the hall if a line is running it, the
// list (opened) while it is being agreed, since such an order has no graph to draw.
function isShaping(order: FactoryOrderRow): boolean {
  return (
    order.standing?.kind === 'shaping' || (order.standing === undefined && order.status === 'draft')
  )
}

// Home's "Open" on an order: show the Forge with that order open in the list.
function useOpenOrderRequests(open: (orderId: string) => void): void {
  const latest = useRef(open)
  useEffect(() => {
    latest.current = open
  })
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('foundry:ui.open-order', (data: unknown) =>
      latest.current((data as { orderId: string }).orderId)
    )
  }, [])
}

// The palette's and a notification's "go to run" for a run with no live terminal: the
// order it names, opened on its Floor.
function usePaletteGotoRequests(open: (orderId: string) => void): void {
  const latest = useRef(open)
  useEffect(() => {
    latest.current = open
  })
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('foundry:palette-goto', (data: unknown) => {
      const { orderId } = data as { orderId?: string }
      if (orderId !== undefined) latest.current(orderId)
    })
  }, [])
}

// The "New work order…" quick action, whether or not this view was open: a request
// now, or one that fired before the view existed, picked up on first mount.
function useNewOrderRequests(open: () => void): void {
  const latest = useRef(open)
  useEffect(() => {
    latest.current = open
  })
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('foundry:ui.open-new-order', () =>
      latest.current()
    )
  }, [])

  useEffect(() => {
    window.electronAPI.extensionBridge
      .invoke('foundry:ui.consume-pending-new-order')
      .then((result: unknown) => {
        if ((result as { pending?: boolean }).pending) latest.current()
      })
      .catch(() => {})
  }, [])
}

// The counts, on the one piece of chrome on screen whatever the surface, so an open
// question or a held tool call is seen without clicking each tab to look.
function useAttention(): Attention {
  const { data } = useFoundryQuery({ key: ['attention'], kinds: ANY_RECORD }, readAttention)
  return { inbox: data?.inbox ?? 0, forge: data?.forge ?? 0 }
}

/** Orders are per-repository, so a workspace switch resets the surfaces. */
function useWorkspaceSwitch(switched: (repoRoot: string | null) => void): void {
  const latest = useRef(switched)
  useEffect(() => {
    latest.current = switched
  })
  useEffect(() => {
    return window.electronAPI.extensionBridge.on('workspace:changed', (data: unknown) => {
      latest.current((data as { repoRoot?: string | null }).repoRoot ?? null)
    })
  }, [])
}

/** What the window shows: the surface, whether settings covers it, and the Forge's own state. */
interface Chrome {
  readonly repoRoot: string | null
  /** The surface on screen, or null while settings covers them all. */
  readonly showing: Surface | null
  readonly focusIdeaSignal: number
  readonly forge: ForgeView
  /** Closes settings as well as choosing the surface. */
  readonly show: (surface: Surface) => void
  readonly openSettings: () => void
  /** Back from settings to the surface that was showing beneath it. */
  readonly closeSettings: () => void
}

type Surfaces = Pick<Chrome, 'showing' | 'show' | 'openSettings' | 'closeSettings'>

/** The surface chosen, and whether settings covers it. */
function useSurfaces(): Surfaces {
  const [surface, setSurface] = useState<Surface>('forge')
  const [settingsOpen, setSettingsOpen] = useState(false)
  return {
    showing: settingsOpen ? null : surface,
    show: (next) => {
      setSettingsOpen(false)
      setSurface(next)
    },
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
  }
}

function useChrome(): Chrome {
  const [repoRoot, setRepoRoot] = useState<string | null>(
    new URLSearchParams(window.location.search).get('repoRoot')
  )
  const [focusIdeaSignal, setFocusIdeaSignal] = useState(0)
  const surfaces = useSurfaces()
  const forge = useForgeView()
  // Bring the Forge into view with the cursor already in the idea box.
  useNewOrderRequests(() => {
    surfaces.show('forge')
    setFocusIdeaSignal((n) => n + 1)
  })
  const openOrder = (orderId: string): void => {
    surfaces.show('forge')
    forge.openInList(orderId)
  }
  useOpenOrderRequests(openOrder)
  usePaletteGotoRequests(openOrder)
  useWorkspaceSwitch((next) => {
    setRepoRoot(next)
    surfaces.closeSettings()
    forge.reset()
  })
  return { ...surfaces, repoRoot, focusIdeaSignal, forge }
}

export function App(): JSX.Element {
  const chrome = useChrome()
  const waiting = useAttention()
  const { showing, forge } = chrome
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <header className="sk-appbar">
        <span className="sk-appbar__title">Foundry</span>
        <SurfaceTabs showing={showing} waiting={waiting} onShow={chrome.show} />
        {showing === 'forge' ? <ForgeViewToggle view={forge.view} onChoose={forge.choose} /> : null}
        <IconButton
          icon={Settings}
          label="Settings"
          className="fdry-settings-open"
          pressed={showing === null}
          onClick={chrome.openSettings}
        />
      </header>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Suspense fallback={null}>
          <ShownSurface chrome={chrome} />
        </Suspense>
      </div>
    </div>
  )
}

function ShownSurface({ chrome }: { chrome: Chrome }): JSX.Element {
  if (chrome.showing === null) return <FoundrySettingsPanel onBack={chrome.closeSettings} />
  if (chrome.showing === 'ledger') return <Ledger />
  return (
    <ForgeSurface
      forge={chrome.forge}
      repoRoot={chrome.repoRoot}
      focusIdeaSignal={chrome.focusIdeaSignal}
    />
  )
}

interface SurfaceTabsProps {
  /** The surface on screen, or null while settings covers them all. */
  readonly showing: Surface | null
  readonly waiting: Attention
  readonly onShow: (surface: Surface) => void
}

function SurfaceTabs({ showing, waiting, onShow }: SurfaceTabsProps): JSX.Element {
  // Settings covers the surfaces, so while it is open none of them is selected.
  return (
    <TabsRoot selectedId={showing ?? ''} onSelect={(id) => onShow(id as Surface)}>
      <TabList label="Foundry surfaces" className="fdry-surface-tabs">
        {SURFACES.map((tab) => (
          // The queue above the Forge and the Forge's own questions are one screen, so one count.
          <SurfaceTab
            key={tab.id}
            tab={tab}
            count={tab.id === 'forge' ? waiting.inbox + waiting.forge : 0}
          />
        ))}
      </TabList>
    </TabsRoot>
  )
}

interface SurfaceTabProps {
  readonly tab: (typeof SURFACES)[number]
  readonly count: number
}

function SurfaceTab({ tab, count }: SurfaceTabProps): JSX.Element {
  // The count is in the accessible name, not only in a badge: "Forge 2" tells a
  // screen reader nothing about what the two are.
  return (
    <Tab
      id={tab.id}
      accessibleName={count > 0 ? `${tab.label}, ${count} waiting on you` : undefined}
    >
      {tab.label}
      {count > 0 ? (
        <span className="fdry-tab-count" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </Tab>
  )
}

function ForgeViewToggle({
  view,
  onChoose,
}: {
  view: ForgeViewKind
  onChoose: (next: ForgeViewKind) => void
}): JSX.Element {
  return (
    <div className="fdry-view-toggle" role="group" aria-label="Forge view">
      <IconButton
        icon={List}
        label="List view"
        pressed={view === 'list'}
        onClick={() => onChoose('list')}
      />
      <IconButton
        icon={Factory}
        label="Factory view"
        pressed={view === 'factory'}
        onClick={() => onChoose('factory')}
      />
    </div>
  )
}

function FoundrySettingsPanel({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <div className="sk-settings-wrap">
      <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
        Back
      </Button>
      <SettingsView />
    </div>
  )
}

interface ForgeSurfaceProps {
  readonly forge: ForgeView
  readonly repoRoot: string | null
  readonly focusIdeaSignal: number
}

/** The queue of what is waiting, over the orders drawn as a list or as halls. */
function ForgeSurface({ forge, repoRoot, focusIdeaSignal }: ForgeSurfaceProps): JSX.Element {
  return (
    <>
      <Inbox onOpenOrder={forge.openInList} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Suspense fallback={null}>
          <OrdersView forge={forge} repoRoot={repoRoot} focusIdeaSignal={focusIdeaSignal} />
        </Suspense>
      </div>
    </>
  )
}

/** The orders, drawn as a list, as the site of every hall, or as one hall. */
function OrdersView({ forge, repoRoot, focusIdeaSignal }: ForgeSurfaceProps): JSX.Element {
  const { hall } = forge
  if (forge.view === 'list') {
    return (
      <Orders
        repoRoot={repoRoot}
        focusIdeaSignal={focusIdeaSignal}
        openOrderId={forge.listOpenOrderId}
      />
    )
  }
  if (hall === null) return <FactorySite repoRoot={repoRoot} onOpen={forge.openFromSite} />
  return (
    <FactoryHall
      orderId={hall.id}
      onOpenInList={() => forge.openInList(hall.id)}
      onBack={forge.leaveHall}
    />
  )
}
