import React, { useEffect, useMemo } from 'react'
import { Check, Clock, Moon, Sun } from 'lucide-react'
import { Button, Checkbox, Kbd, StatusDot } from '@terminator/extension-ui'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { useFocusStore } from '../../home/focus-store'
import {
  FOCUS_LIMIT,
  focusDone as isFocusDone,
  localDateKey,
  type FocusItem,
} from '../../home/focus'
import { sinceYouLeft, type SinceEvent } from '../../home/since-you-left'
import {
  carriedOverRows,
  estimatedReviewMinutes,
  eventTone,
  planSentence,
  reviewLoadShare,
  yesterdayKey,
  type PlanRow,
} from '../../home/plan-the-day'
import { useNow } from '../session/useNow'
import { useDeskAsks } from './useDeskAsks'
import { useWorkThreads } from './useWorkThreads'
import './PlanTheDay.css'

type Pick = Omit<FocusItem, 'doneByHand'>

/** Remembers when Home was last looked at, once it goes away, for "Since you left". */
export function useMarkLeftHome(): void {
  useEffect(() => () => useFocusStore.getState().markLeftHome(Date.now()), [])
}

/** The first view of each local day, until Start the day or Skip today is pressed. */
export function PlanTheDay(): JSX.Element | null {
  const now = useNow()
  const dismissedOn = useFocusStore((s) => s.planDismissedOn)
  return dismissedOn === localDateKey(now) ? null : <PlanBand now={now} />
}

interface Plan {
  sentence: string
  carried: PlanRow[]
  events: SinceEvent[]
  today: FocusItem[]
  reviewMinutes: number
}

function usePlan(now: number): Plan {
  const { asks } = useDeskAsks()
  const { allThreads } = useWorkThreads()
  const facets = useHomeFeedStore((s) => s.facets)
  const candidates = useHomeFeedStore((s) => s.focus)
  const { days, lastLeftHomeAt } = useFocusStore()
  return useMemo(() => {
    const today = days[localDateKey(now)] ?? []
    const yesterday = days[yesterdayKey(now)] ?? []
    const events = sinceYouLeft(asks, facets, lastLeftHomeAt)
    const finished = yesterday.filter((item) => isFocusDone(item, allThreads, candidates))
    const left = yesterday.filter((item) => !finished.includes(item))
    return {
      sentence: planSentence({ focusTotal: yesterday.length, focusDone: finished.length, events }),
      carried: carriedOverRows(left, candidates, today),
      events,
      today,
      reviewMinutes: estimatedReviewMinutes(asks),
    }
  }, [asks, facets, candidates, lastLeftHomeAt, days, now, allThreads])
}

function useStartTheDayShortcut(start: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) start()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [start])
}

function PlanBand({ now }: { now: number }): JSX.Element {
  const plan = usePlan(now)
  const dismissPlan = useFocusStore((s) => s.dismissPlan)
  const close = (): void => dismissPlan(Date.now())
  useStartTheDayShortcut(close)
  return (
    <section className="plan" aria-label="Plan today">
      <div className="plan__head">
        <Sun aria-hidden="true" className="plan__sun" />
        <div>
          <h2>Plan today</h2>
          <p>{plan.sentence}</p>
        </div>
        <span className="plan__actions">
          <Button variant="ghost" onClick={close}>
            Skip today
          </Button>
          <Button variant="primary" onClick={close}>
            Start the day <Kbd>⌘↵</Kbd>
          </Button>
        </span>
      </div>
      <div className="plan__body">
        <CarriedOverColumn rows={plan.carried} full={plan.today.length >= FOCUS_LIMIT} />
        <SinceYouLeftColumn events={plan.events} today={plan.today} />
        <FocusColumn today={plan.today} reviewMinutes={plan.reviewMinutes} />
      </div>
    </section>
  )
}

function ColumnTitle({ icon, children }: { icon: JSX.Element; children: string }): JSX.Element {
  return (
    <h3 className="plan__title">
      {icon}
      {children}
    </h3>
  )
}

interface AddProps {
  item: Pick
  disabled: boolean
}

function AddButton({ item, disabled }: AddProps): JSX.Element {
  const pickFocus = useFocusStore((s) => s.pickFocus)
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={disabled}
      aria-label={`Add ${item.title} to today's focus`}
      onClick={() => pickFocus(item)}
    >
      Add
    </Button>
  )
}

function CarriedOverColumn({ rows, full }: { rows: PlanRow[]; full: boolean }): JSX.Element {
  return (
    <div className="plan__column">
      <ColumnTitle icon={<Clock aria-hidden="true" />}>CARRIED OVER</ColumnTitle>
      {rows.length === 0 && <p className="plan__none">Nothing carried over.</p>}
      {rows.map((row) => (
        <div className="plan__row" key={row.id}>
          <Checkbox checked={false} label="Not done" />
          <span>
            {row.title}
            {row.detail && <small>{row.detail}</small>}
          </span>
          <AddButton item={row.item} disabled={full} />
        </div>
      ))}
    </div>
  )
}

function SinceYouLeftColumn(props: { events: SinceEvent[]; today: FocusItem[] }): JSX.Element {
  const full = props.today.length >= FOCUS_LIMIT
  return (
    <div className="plan__column">
      <ColumnTitle icon={<Moon aria-hidden="true" />}>SINCE YOU LEFT</ColumnTitle>
      {props.events.length === 0 && <p className="plan__none">Nothing since you left.</p>}
      {props.events.map((event) => {
        const picked = props.today.some((item) => item.id === event.id)
        return (
          <div className="plan__row" key={event.id}>
            <StatusDot tone={eventTone(event.kind)} />
            <span>{event.text}</span>
            <AddButton item={{ id: event.id, title: event.text }} disabled={full || picked} />
          </div>
        )
      })}
    </div>
  )
}

function FocusColumn(props: { today: FocusItem[]; reviewMinutes: number }): JSX.Element {
  const removeFocus = useFocusStore((s) => s.removeFocus)
  const slots = Array.from({ length: FOCUS_LIMIT }, (_, index) => props.today[index])
  return (
    <div className="plan__column">
      <ColumnTitle
        icon={<Check aria-hidden="true" />}
      >{`TODAY'S FOCUS · PICK UP TO ${FOCUS_LIMIT}`}</ColumnTitle>
      {slots.map((item, index) => (
        <div className="plan__slot" data-filled={item ? '' : undefined} key={item?.id ?? index}>
          <span className="plan__slot-number">{index + 1}</span>
          <span>{item ? item.title : 'Press Add on any item'}</span>
          {item && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${item.title}`}
              onClick={() => removeFocus(item.id)}
            >
              ×
            </Button>
          )}
        </div>
      ))}
      {props.reviewMinutes > 0 && <ReviewLoad minutes={props.reviewMinutes} />}
    </div>
  )
}

function ReviewLoad({ minutes }: { minutes: number }): JSX.Element {
  return (
    <div className="plan__load">
      Estimated review time for your queue: {minutes} min
      <div className="plan__load-track">
        <i style={{ width: `${reviewLoadShare(minutes)}%` }} />
      </div>
    </div>
  )
}
