import React, { useEffect, useMemo } from 'react'
import { Check, ChevronDown, ChevronRight, Clock, Sun } from 'lucide-react'
import { Button, Checkbox, Kbd } from '@terminator/extension-ui'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { useFocusStore } from '../../home/focus-store'
import {
  FOCUS_LIMIT,
  carriedOver,
  focusDone as isFocusDone,
  localDateKey,
  type FocusItem,
} from '../../home/focus'
import {
  carriedOverRows,
  estimatedReviewMinutes,
  planSentence,
  reviewLoadShare,
  yesterdayKey,
  type PlanRow,
} from '../../home/plan-the-day'
import { useNow } from '../session/useNow'
import { useDeskModel } from './useDeskModel'
import { useWorkThreads } from './useWorkThreads'
import { TicketsColumn } from './TicketsColumn'
import './PlanTheDay.css'

type Pick = Omit<FocusItem, 'doneByHand'>

/** The first view of each local day, until Start the day or Skip today is pressed. */
export function PlanTheDay(): JSX.Element | null {
  const now = useNow()
  const dismissedOn = useFocusStore((s) => s.planDismissedOn)
  return dismissedOn === localDateKey(now) ? null : <PlanBand now={now} />
}

interface Plan {
  sentence: string
  carried: PlanRow[]
  today: FocusItem[]
  reviewMinutes: number
}

function usePlan(now: number): Plan {
  const { asks } = useDeskModel()
  const { allThreads } = useWorkThreads()
  const candidates = useHomeFeedStore((s) => s.focus)
  const days = useFocusStore((s) => s.days)
  return useMemo(() => {
    const today = days[localDateKey(now)] ?? []
    const yesterday = days[yesterdayKey(now)] ?? []
    const finished = yesterday.filter((item) => isFocusDone(item, allThreads, candidates))
    const left = carriedOver(yesterday).filter((item) => !finished.includes(item))
    return {
      sentence: planSentence({
        focusTotal: yesterday.length,
        focusDone: finished.length,
        waiting: {
          agents: asks.filter((a) => a.kind === 'finished').length,
          reviews: asks.filter((a) => a.kind === 'review').length,
        },
      }),
      carried: carriedOverRows(left, candidates, today),
      today,
      reviewMinutes: estimatedReviewMinutes(asks),
    }
  }, [asks, candidates, days, now, allThreads])
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

function PlanActions({
  collapsed,
  onClose,
}: {
  collapsed: boolean
  onClose: () => void
}): JSX.Element {
  const togglePlanCollapsed = useFocusStore((s) => s.togglePlanCollapsed)
  return (
    <span className="plan__actions">
      <Button
        variant="ghost"
        icon={collapsed ? ChevronRight : ChevronDown}
        aria-expanded={!collapsed}
        aria-controls="plan-body"
        onClick={togglePlanCollapsed}
      >
        {collapsed ? 'Expand' : 'Collapse'}
      </Button>
      <Button variant="ghost" onClick={onClose}>
        Skip today
      </Button>
      <Button variant="primary" onClick={onClose}>
        Start the day <Kbd>⌘↵</Kbd>
      </Button>
    </span>
  )
}

function PlanHead({
  sentence,
  picked,
  onClose,
}: {
  sentence: string
  picked: number
  onClose: () => void
}): JSX.Element {
  const collapsed = useFocusStore((s) => s.planCollapsed)
  return (
    <div className="plan__head">
      <Sun aria-hidden="true" className="plan__sun" />
      <div>
        <h2>Plan today</h2>
        <p>
          {sentence}
          {collapsed && picked > 0 ? ` · ${picked} of ${FOCUS_LIMIT} focus picked` : ''}
        </p>
      </div>
      <PlanActions collapsed={collapsed} onClose={onClose} />
    </div>
  )
}

function PlanBand({ now }: { now: number }): JSX.Element {
  const plan = usePlan(now)
  const dismissPlan = useFocusStore((s) => s.dismissPlan)
  const collapsed = useFocusStore((s) => s.planCollapsed)
  const close = (): void => dismissPlan(Date.now())
  useStartTheDayShortcut(close)
  return (
    <section className="plan" aria-label="Plan today">
      <PlanHead sentence={plan.sentence} picked={plan.today.length} onClose={close} />
      {!collapsed && (
        <div className="plan__body" id="plan-body">
          <CarriedOverColumn rows={plan.carried} full={plan.today.length >= FOCUS_LIMIT} />
          <TicketsColumn />
          <FocusColumn today={plan.today} reviewMinutes={plan.reviewMinutes} />
        </div>
      )}
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
