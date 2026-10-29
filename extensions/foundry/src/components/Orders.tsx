import React, { useCallback, useEffect, useRef, useState } from 'react'
import { RecordShown } from '../renderer/RecordShown.js'
import { ArrowLeft, Plus, CheckCircle2, AlertCircle, Loader } from 'lucide-react'
import { Button, ConfirmButton, SegmentedControl } from '@terminator/extension-ui'
import { GateAnswers } from './GateCard.js'
import { OrderLinks } from './OrderLinks.js'
import { DocumentChip } from './DocumentChip.js'
import { ciLabel } from '../line/ci-label.js'
import { useFoundryQuery, ANY_RECORD } from '../renderer/foundry-query.js'
import { Forge } from './Forge.js'
import { Floor } from './Floor.js'
import type { Standing } from '../order/standing.js'
import { statusInWords } from '../order/render.js'
import type { OrderStatus } from '../order/schema.js'
import { gradeInWords } from '../runtime/review/risk-grade.js'
import type { RiskGrade } from '../runtime/review/risk-grade.js'
import { foundryInvoke, refusalOf } from '../renderer/foundry-invoke.js'
import type { FoundryApi } from '../ipc/foundry-api.js'

// The way into the Forge: what orders exist, and a way to seed another.
//
// Deliberately thin. The list is a door, not a board — everything that needs a
// decision is meant to reach the operator through the inbox, not by being
// noticed on a screen they have to remember to visit.

interface Ticket {
  readonly tracker: string
  readonly key: string
  readonly title: string
  readonly status: string
}

interface Team {
  readonly id: string
  readonly key: string
  readonly name: string
}

type OrderRow = FoundryApi['foundry:order.list']['answer']['orders'][number]

type TicketsRead = FoundryApi['foundry:issues.mine']['answer']

async function readOrderRows(): Promise<OrderRow[]> {
  const r = await foundryInvoke('foundry:order.list')
  return r.orders ?? []
}

async function readTickets(search: string): Promise<TicketsRead> {
  return await foundryInvoke('foundry:issues.mine', { term: search })
}

export interface OrdersProps {
  readonly repoRoot: string | null
  /**
   * Bumped by the "New work order…" quick action. Every change — not the
   * value itself — means "put the cursor in the idea box", which is why it is
   * a counter rather than a boolean: two requests in a row must focus twice.
   */
  readonly focusIdeaSignal?: number
  /**
   * Open this order on mount — how the Factory view hands an order still
   * being shaped back to this surface, since that half of an order has no
   * hall of its own to draw.
   */
  readonly openOrderId?: string | null
}

export function Orders({ repoRoot, focusIdeaSignal, openOrderId }: OrdersProps): React.JSX.Element {
  const [open, setOpen] = useOpenOrder(openOrderId)
  const [from, setFrom] = useFrom(focusIdeaSignal)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [started, setStarted] = useState<string | null>(null)
  const { rows, refresh, answering, answer } = useOrderRows(setProblem)
  const tickets = useTickets(from, setProblem)
  const ideaInputRef = useIdeaFocus(focusIdeaSignal, from)
  const shared: Shared = { repoRoot, busy, setBusy, setProblem, setOpen, refresh }
  const seeding = useSeeding(shared)

  const list = { rows, answering, onOpen: setOpen, onAnswer: answer }
  return (
    <>
      <RecordShown feature="orders" />
      {open !== null ? (
        <OpenOrder {...{ open, rows, started, setStarted, shared }} />
      ) : (
        <OrderIndex {...{ from, setFrom, seeding, tickets, ideaInputRef, shared, problem, list }} />
      )}
    </>
  )
}

interface OrderIndexProps extends SeedFormProps {
  readonly problem: string | null
  readonly list: OrderListProps
}

/** No order open: the way to start one, what it said, and the orders there are. */
function OrderIndex({ problem, list, ...form }: OrderIndexProps) {
  const { from, seeding, tickets, shared } = form
  return (
    <div className="fdry-shell">
      <SeedForm {...form} />
      {seeding.offer !== null ? (
        <TicketOffer offer={seeding.offer} seeding={seeding} busy={shared.busy} />
      ) : null}
      {problem !== null ? <p className="fdry-problem">{problem}</p> : null}
      {from === 'tracker' ? (
        <TicketList tickets={tickets} busy={shared.busy} onSeed={seeding.seedFromTicket} />
      ) : null}
      <OrderList {...list} />
    </div>
  )
}

/** What every part of the surface shares: where orders go, whether it is busy, and how to say so. */
interface Shared {
  readonly repoRoot: string | null
  readonly busy: boolean
  readonly setBusy: (busy: boolean) => void
  readonly setProblem: (problem: string | null) => void
  readonly setOpen: (orderId: string | null) => void
  readonly refresh: () => Promise<void>
}

/** The order open, if one is; a new `openOrderId` opens that one. */
function useOpenOrder(openOrderId: string | null | undefined) {
  const [open, setOpen] = useState<string | null>(openOrderId ?? null)
  const [seenOpenOrderId, setSeenOpenOrderId] = useState(openOrderId)
  if (openOrderId !== seenOpenOrderId) {
    setSeenOpenOrderId(openOrderId)
    if (openOrderId) setOpen(openOrderId)
  }
  return [open, setOpen] as const
}

// Where a new order starts from: something typed, or a tracker ticket. A new focus
// request turns it back to an idea.
function useFrom(focusIdeaSignal: number | undefined) {
  const [seenFocusSignal, setSeenFocusSignal] = useState(0)
  const [from, setFrom] = useState<'typed' | 'tracker'>('typed')
  if (focusIdeaSignal && focusIdeaSignal !== seenFocusSignal) {
    setSeenFocusSignal(focusIdeaSignal)
    setFrom('typed')
  }
  return [from, setFrom] as const
}

const NO_ROWS: OrderRow[] = []

/** The orders, kept current, and answering a row's gate from where it stands. */
function useOrderRows(setProblem: (problem: string | null) => void) {
  // The counts on these rows go stale the moment a question is answered in
  // another window or a run raises one, and this list is where the tab's
  // badge sends you — so it is read again when Foundry says any of that changed.
  const { data, refetch } = useFoundryQuery(
    { key: ['order-rows'], kinds: ANY_RECORD },
    readOrderRows
  )
  const refresh = useCallback(async (): Promise<void> => {
    await refetch()
  }, [refetch])
  // The same channel the inbox answers with: the row is not a second queue, it
  // is the gate that holds this order put where you are already looking.
  const [answering, setAnswering] = useState<string | null>(null)
  const answer = useCallback(
    async (gateId: string, option: string) => {
      setAnswering(gateId)
      try {
        const r = await foundryInvoke('foundry:inbox.decide', { gateId, option })
        setProblem(refusalOf(r))
        await refresh()
      } finally {
        setAnswering(null)
      }
    },
    [refresh, setProblem]
  )
  return { rows: data ?? NO_ROWS, refresh, answering, answer }
}

/** Your tickets, listed; refreshed when the picker opens and on search, not per keystroke. */
function useTickets(from: 'typed' | 'tracker', setProblem: (problem: string | null) => void) {
  const [term, setTerm] = useState('')
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [connected, setConnected] = useState<string[] | null>(null)
  const showTickets = useCallback(
    (r: TicketsRead): void => {
      if ('error' in r) {
        setProblem(r.error)
        return
      }
      setConnected((r.connected ?? []).map((c) => c.tracker))
      setTickets(r.issues ?? [])
    },
    [setProblem]
  )
  const loadTickets = useCallback(
    (search: string) => readTickets(search).then(showTickets),
    [showTickets]
  )
  useEffect(() => {
    if (from === 'tracker' && tickets === null) void readTickets('').then(showTickets)
  }, [from, tickets, showTickets])
  return { term, setTerm, tickets, connected, loadTickets }
}

// The idea box, focused when the quick action asks; 0 means never asked, so a mount
// steals no focus. Switching `from` swaps the input, so the focus waits for that
// render rather than firing on the same pass.
function useIdeaFocus(focusIdeaSignal: number | undefined, from: 'typed' | 'tracker') {
  const ideaInputRef = useRef<HTMLInputElement | null>(null)
  const handledFocusSignal = useRef(0)
  useEffect(() => {
    if (!focusIdeaSignal || focusIdeaSignal === handledFocusSignal.current) return
    if (from !== 'typed') return
    handledFocusSignal.current = focusIdeaSignal
    ideaInputRef.current?.focus()
  }, [focusIdeaSignal, from])
  return ideaInputRef
}

type OrderSource = FoundryApi['foundry:order.create']['payload']['source']

function createOrderAt(repoRoot: string, source: OrderSource) {
  return foundryInvoke('foundry:order.create', { source, repoPaths: [repoRoot] })
}

/** The order a create answered with, or the one that already existed for the ticket. */
function openedId(answer: object): string | null {
  const opened = 'order' in answer ? answer.order : 'existing' in answer ? answer.existing : null
  return opened && typeof opened === 'object' && 'id' in opened && typeof opened.id === 'string'
    ? opened.id
    : null
}

/** Marks the surface busy and clears what it last said while `work` runs. */
async function whileBusy(
  { setBusy, setProblem }: Shared,
  work: () => Promise<void>
): Promise<void> {
  setBusy(true)
  setProblem(null)
  try {
    await work()
  } finally {
    setBusy(false)
  }
}

/** Seeding an order: from the idea typed, from a ticket made for it, or from a ticket picked. */
function useSeeding(shared: Shared) {
  const { repoRoot, setProblem, setOpen, refresh } = shared
  const [idea, setIdea] = useState('')
  // A ticket offered for the idea before it becomes an order (spec 061).
  const [offer, setOffer] = useState<{ teams: Team[] } | null>(null)
  const [teamId, setTeamId] = useState('')
  const createOrder = useCallback(
    async (source: OrderSource) => {
      if (repoRoot === null) return
      const r = await createOrderAt(repoRoot, source)
      if ('error' in r) {
        setProblem(r.error)
        return
      }
      setIdea('')
      await refresh()
      setOpen(openedId(r))
    },
    [repoRoot, refresh, setProblem, setOpen]
  )
  const seed = useSeed({ shared, idea, createOrder, setOffer, setTeamId })
  const answerOffer = useAnswerOffer({ shared, idea, teamId, createOrder, setOffer })
  const seedFromTicket = useSeedFromTicket(shared)
  return { idea, setIdea, offer, teamId, setTeamId, seed, answerOffer, seedFromTicket }
}

/** What the seeding steps share beyond the surface: the idea, and the order they create. */
interface SeedSteps {
  readonly shared: Shared
  readonly idea: string
  readonly createOrder: (source: OrderSource) => Promise<void>
  readonly setOffer: (offer: { teams: Team[] } | null) => void
}

function useSeed({
  shared,
  idea,
  createOrder,
  setOffer,
  setTeamId,
}: SeedSteps & { readonly setTeamId: (id: string) => void }) {
  const ready = idea.trim() !== ''
  return useCallback(async () => {
    if (!ready || shared.repoRoot === null) return
    await whileBusy(shared, async () => {
      // Asked before the order exists, because its project and branch are
      // named after the ticket. No offer means no question.
      const r = await foundryInvoke('foundry:ticket.offer')
      if (r.offer) {
        setOffer(r.offer)
        setTeamId(r.offer.teams[0]?.id ?? '')
        return
      }
      await createOrder({ kind: 'typed', text: idea })
    })
  }, [idea, ready, shared, createOrder, setOffer, setTeamId])
}

function useAnswerOffer({
  shared,
  idea,
  teamId,
  createOrder,
  setOffer,
}: SeedSteps & { readonly teamId: string }) {
  return useCallback(
    (withTicket: boolean) =>
      whileBusy(shared, async () => {
        if (!withTicket) {
          setOffer(null)
          await createOrder({ kind: 'typed', text: idea })
          return
        }
        const r = await createTicket(idea, teamId)
        if ('error' in r) {
          shared.setProblem(r.error)
          return
        }
        setOffer(null)
        await createOrder({ kind: 'tracker', tracker: 'linear', key: r.key })
      }),
    [idea, teamId, createOrder, shared, setOffer]
  )
}

function createTicket(idea: string, teamId: string) {
  return foundryInvoke('foundry:ticket.create', { idea, teamId })
}

function useSeedFromTicket(shared: Shared) {
  return useCallback(
    async (ticket: Ticket) => {
      const { repoRoot, setProblem, setOpen, refresh } = shared
      if (repoRoot === null) return
      await whileBusy(shared, async () => {
        const r = await createOrderAt(repoRoot, {
          kind: 'tracker',
          tracker: 'linear',
          key: ticket.key,
        })
        if ('error' in r) {
          setProblem(r.error)
          return
        }
        await refresh()
        // An order already made from this ticket is an answer, not a failure.
        setOpen(openedId(r))
      })
    },
    [shared]
  )
}

interface OpenOrderProps {
  readonly open: string
  readonly rows: readonly OrderRow[]
  readonly started: string | null
  readonly setStarted: (orderId: string) => void
  readonly shared: Shared
}

function OpenOrder({ open, rows, started, setStarted, shared }: OpenOrderProps) {
  const row = rows.find((r) => r.id === open)
  // `started` is what the Forge reports the moment a run begins, so the
  // surface swaps without waiting for the list to be refetched.
  const running = row?.status === 'running' || started === open
  const hasRun = running || row?.status === 'shipped'
  return (
    /* An open order is a frame, not a page: the way back at the top, the
       order in the middle scrolling inside it, the controls that end it at
       the foot. They used to be the last thing in one 1510px scroll — under
       a rail that came out twice the height of the document — and finding
       them meant scrolling past 714px of empty column. */
    <div className="fdry-shell is-open">
      <Button
        size="sm"
        icon={ArrowLeft}
        className="fdry-back"
        onClick={() => {
          shared.setOpen(null)
          void shared.refresh()
        }}
      >
        All orders
      </Button>
      {/* An order that has a run, shipped or not, is watched on the Floor, where its
          open gates are answered; one that is still
          being agreed is worked on in the Forge. */}
      {hasRun ? <Floor orderId={open} /> : <OrderForge {...{ open, row, setStarted, shared }} />}
      <OrderControls open={open} running={running} shared={shared} />
    </div>
  )
}

function OrderForge({
  open,
  row,
  setStarted,
  shared,
}: Pick<OpenOrderProps, 'open' | 'setStarted' | 'shared'> & {
  readonly row: OrderRow | undefined
}) {
  return (
    <Forge
      orderId={open}
      standing={row?.standing}
      onStarted={(id) => {
        setStarted(id)
        void shared.refresh()
      }}
    />
  )
}

// Getting rid of the order, placed under everything that describes it, not above the
// title the operator has not read yet.
interface OrderControlsProps {
  readonly open: string
  readonly running: boolean
  readonly shared: Shared
}

function OrderControls({ open, running, shared }: OrderControlsProps) {
  const end = useEndOrder(open, shared)
  return (
    <div className="fdry-order-controls">
      {/* Discard, because an order made by mistake had no way out: the
          `cancelled` status has been in the schema from the start and
          nothing ever set it, so the list only ever grew. Marked, not
          deleted — the records are the point. A running order is refused by
          the channel and says why. */}
      {running ? null : (
        <Button
          variant="ghost"
          size="sm"
          className="fdry-discard"
          disabled={shared.busy}
          onClick={() => void end(discard)}
        >
          Discard this order
        </Button>
      )}
      {/* The other answer, and the one `cancelled` never was: an order
          that is hidden still owns a worktree, a branch and a directory.
          Offered whatever the status, because a running order is exactly
          the one that has those things — its agents are stopped first. */}
      <DeleteOrder open={open} busy={shared.busy} onConfirm={() => void end(remove)} />
    </div>
  )
}

function DeleteOrder({
  open,
  busy,
  onConfirm,
}: {
  readonly open: string
  readonly busy: boolean
  readonly onConfirm: () => void
}) {
  return (
    <ConfirmButton
      label="Delete this order"
      confirmLabel="Delete it and everything it made"
      className="fdry-discard"
      warning={`This removes ${open} entirely — its records and ledger, its run graph and gates, its checkout and its branch. Nothing about it can be read back afterwards.`}
      disabled={busy}
      onConfirm={onConfirm}
    />
  )
}

/** Ends the open order one way or another; the trouble it reports, or null when it went. */
type Ending = (orderId: string) => Promise<string | null>

const discard: Ending = async (orderId) => {
  const r = await foundryInvoke('foundry:order.cancel', { id: orderId })
  return 'error' in r ? r.error : null
}

const remove: Ending = async (orderId) => {
  const r = await foundryInvoke('foundry:order.delete', { id: orderId })
  // A partial teardown is said out loud rather than reported
  // as success: a branch git would not delete is a branch
  // still there, and the operator is the one who can act on it.
  if (r.error !== undefined) return r.error
  return r.failed?.length ? r.failed.join('; ') : null
}

function useEndOrder(open: string, { setBusy, setProblem, setOpen, refresh }: Shared) {
  return async (ending: Ending): Promise<void> => {
    setBusy(true)
    try {
      const trouble = await ending(open)
      if (trouble !== null) {
        setProblem(trouble)
        return
      }
      setOpen(null)
      await refresh()
    } finally {
      setBusy(false)
    }
  }
}

interface SeedFormProps {
  readonly from: 'typed' | 'tracker'
  readonly setFrom: (from: 'typed' | 'tracker') => void
  readonly seeding: ReturnType<typeof useSeeding>
  readonly tickets: ReturnType<typeof useTickets>
  readonly ideaInputRef: React.MutableRefObject<HTMLInputElement | null>
  readonly shared: Shared
}

function SeedForm({ from, setFrom, seeding, tickets, ideaInputRef, shared }: SeedFormProps) {
  const unavailable = shared.busy || shared.repoRoot === null
  return (
    <form
      className="fdry-seed"
      onSubmit={(event) => {
        event.preventDefault()
        void seeding.seed()
      }}
    >
      <SegmentedControl
        label="Start from"
        className="fdry-seed-from"
        options={[
          { value: 'typed', label: 'Idea', disabled: unavailable },
          { value: 'tracker', label: 'Ticket', disabled: unavailable },
        ]}
        value={from}
        onChange={setFrom}
      />
      {from === 'typed' ? (
        <IdeaFields seeding={seeding} ideaInputRef={ideaInputRef} unavailable={unavailable} />
      ) : (
        <TicketSearch tickets={tickets} unavailable={unavailable} />
      )}
    </form>
  )
}

function IdeaFields({
  seeding,
  ideaInputRef,
  unavailable,
}: Pick<SeedFormProps, 'seeding' | 'ideaInputRef'> & { readonly unavailable: boolean }) {
  const ready = seeding.idea.trim() !== ''
  return (
    <>
      <input
        ref={ideaInputRef}
        aria-label="Describe what you want built or fixed"
        placeholder="Describe what you want built or fixed…"
        value={seeding.idea}
        disabled={unavailable}
        onChange={(event) => seeding.setIdea(event.target.value)}
      />
      <Button type="submit" variant="primary" icon={Plus} disabled={unavailable || !ready}>
        New order
      </Button>
    </>
  )
}

function TicketSearch({
  tickets,
  unavailable,
}: Pick<SeedFormProps, 'tickets'> & { readonly unavailable: boolean }) {
  return (
    <>
      <input
        aria-label="Search your tickets"
        placeholder="Search your tickets…"
        value={tickets.term}
        disabled={unavailable}
        onChange={(event) => tickets.setTerm(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void tickets.loadTickets(tickets.term)
          }
        }}
      />
      <Button
        variant="primary"
        icon={Plus}
        disabled={unavailable}
        onClick={() => void tickets.loadTickets(tickets.term)}
      >
        Find
      </Button>
    </>
  )
}

function TicketOffer({
  offer,
  seeding,
  busy,
}: {
  readonly offer: { teams: Team[] }
  readonly seeding: ReturnType<typeof useSeeding>
  readonly busy: boolean
}) {
  return (
    <div className="fdry-ticket-offer" role="group" aria-label="Create a Linear ticket">
      <p>
        Create a Linear ticket for this? The order&rsquo;s branch and project will be named after
        it.
      </p>
      {offer.teams.length > 1 ? (
        <TeamPicker teams={offer.teams} seeding={seeding} busy={busy} />
      ) : null}
      <Button variant="primary" disabled={busy} onClick={() => void seeding.answerOffer(true)}>
        Create ticket
      </Button>
      <Button disabled={busy} onClick={() => void seeding.answerOffer(false)}>
        No ticket
      </Button>
    </div>
  )
}

function TeamPicker({
  teams,
  seeding,
  busy,
}: {
  readonly teams: Team[]
  readonly seeding: ReturnType<typeof useSeeding>
  readonly busy: boolean
}) {
  return (
    <select
      aria-label="Linear team"
      value={seeding.teamId}
      disabled={busy}
      onChange={(event) => seeding.setTeamId(event.target.value)}
    >
      {teams.map((team) => (
        <option key={team.id} value={team.id}>
          {team.name}
        </option>
      ))}
    </select>
  )
}

function TicketList({
  tickets: { connected, tickets },
  busy,
  onSeed,
}: {
  readonly tickets: ReturnType<typeof useTickets>
  readonly busy: boolean
  readonly onSeed: (ticket: Ticket) => Promise<void>
}) {
  if (connected !== null && connected.length === 0) return <NoTracker />
  if (tickets === null) return <p className="fdry-note">Reading your tickets…</p>
  if (tickets.length === 0)
    return <p className="fdry-note">No tickets matched. Try a different search.</p>
  return (
    <>
      <h2 className="fdry-list-h">
        Tickets<span className="fdry-cnt">{tickets.length}</span>
      </h2>
      <ul className="fdry-tickets">
        {tickets.map((ticket) => (
          <li key={`${ticket.tracker}-${ticket.key}`}>
            <TicketButton ticket={ticket} busy={busy} onSeed={onSeed} />
          </li>
        ))}
      </ul>
    </>
  )
}

function NoTracker() {
  return (
    <p className="fdry-note">
      No tracker is connected. Connect Linear in the application&rsquo;s settings and your tickets
      will be listed here.
    </p>
  )
}

function TicketButton({
  ticket,
  busy,
  onSeed,
}: {
  readonly ticket: Ticket
  readonly busy: boolean
  readonly onSeed: (ticket: Ticket) => Promise<void>
}) {
  return (
    <button type="button" disabled={busy} onClick={() => void onSeed(ticket)}>
      <span className="fdry-ticket-key">{ticket.key}</span>
      <span className="fdry-ticket-title">{ticket.title}</span>
      {ticket.status === '' ? null : <span className="fdry-ticket-status">{ticket.status}</span>}
    </button>
  )
}

interface OrderListProps {
  readonly rows: readonly OrderRow[]
  readonly answering: string | null
  readonly onOpen: (orderId: string) => void
  readonly onAnswer: (gateId: string, option: string) => Promise<void>
}

function OrderList({ rows, answering, onOpen, onAnswer }: OrderListProps) {
  if (rows.length === 0) {
    return (
      <p className="fdry-note">
        No orders yet. Describe something above, or give it a ticket, and Foundry will read the
        repository before it asks you anything.
      </p>
    )
  }
  return (
    <>
      <h2 className="fdry-list-h">
        Orders<span className="fdry-cnt">{rows.length}</span>
      </h2>
      <ul className="fdry-orders">
        {rows.map((row) => (
          <li key={row.id}>
            <button type="button" className="fdry-order-open" onClick={() => onOpen(row.id)}>
              <OrderMark standing={row.standing} />
              <OrderMain row={row} />
              <OrderState row={row} />
            </button>
            <OrderExtras row={row} answering={answering} onAnswer={onAnswer} />
          </li>
        ))}
      </ul>
    </>
  )
}

function OrderMark({ standing }: { readonly standing: Standing | undefined }) {
  return (
    <span className="fdry-order-mark" aria-hidden="true">
      {standing?.turn === 'you' ? (
        <AlertCircle />
      ) : standing?.kind === 'done' ? (
        <CheckCircle2 />
      ) : (
        <Loader />
      )}
    </span>
  )
}

function OrderMain({ row }: { readonly row: OrderRow }) {
  return (
    <span className="fdry-order-main">
      <b>{row.title}</b>
      <small>
        {row.id} ·{' '}
        {/* The pill on the right says where the order stands; only a
          row from an older shape, with no standing, needs it here. */}
        {row.standing === undefined ? `${statusInWords(row.status as OrderStatus)} · ` : ''}
        {gradeInWords(row.risk as RiskGrade)}
        {row.source.key !== null ? ` · ${row.source.tracker} ${row.source.key}` : ''}
      </small>
    </span>
  )
}

// Where the order stands, from the one derivation every surface reads, not a
// draft-time compile count that called every running order "ready to hand off".
// While CI works the pill says so, as the Floor does, and spins.
function OrderState({ row }: { readonly row: OrderRow }) {
  const { ci, standing } = row
  if (ci != null && (ci.status === 'watching' || ci.status === 'reworking')) {
    return (
      <span role="status" className="fdry-order-state is-ci">
        <Loader className="fdry-spin" aria-hidden="true" />
        {ciLabel(ci)}
        {ci.checks.total === 0 ? '' : ` · ${ci.checks.done} of ${ci.checks.total} checks done`}
      </span>
    )
  }
  if (standing === undefined) return null
  return (
    <span className={`fdry-order-state${standing.turn === 'you' ? ' is-waiting' : ''}`}>
      {standing.label}
    </span>
  )
}

function hasLinks(row: OrderRow): boolean {
  return (row.pulls?.length ?? 0) > 0 || row.source.url != null || row.document != null
}

/** A row's links, and the answers to its open gate, when it has either. */
function OrderExtras({
  row,
  answering,
  onAnswer,
}: { readonly row: OrderRow } & Pick<OrderListProps, 'answering' | 'onAnswer'>) {
  const gate = row.gate
  if (!hasLinks(row) && gate == null) return null
  return (
    <div className="fdry-order-extras">
      <span className="fdry-order-links">
        {row.document == null ? null : <DocumentChip document={row.document} />}
        <OrderLinks
          pulls={row.pulls}
          source={
            row.source.key !== null && row.source.url != null
              ? { key: row.source.key, url: row.source.url }
              : null
          }
        />
      </span>
      {gate == null ? null : (
        <GateAnswers
          gate={{ options: gate.options.slice(0, 2), breach: gate.breach }}
          busy={answering === gate.id}
          onDecide={(option) => void onAnswer(gate.id, option)}
        />
      )}
    </div>
  )
}
