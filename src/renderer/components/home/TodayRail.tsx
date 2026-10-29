import React, { useState } from 'react'
import { Checkbox } from '@terminator/extension-ui'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { useFocusStore } from '../../home/focus-store'
import { FOCUS_LIMIT, focusDone, localDateKey, type FocusItem } from '../../home/focus'
import { useNow } from '../session/useNow'
import { useWorkThreads } from './useWorkThreads'
import { optionOfCandidate, optionOfThread, type FocusOption } from './focus-options'
import { WeekCard } from './WeekCard'
import type { HomeFocusCandidate } from '../../../shared/schemas/home-feed.schema'
import type { WorkThread } from '../../home/work-threads'
import './InFlight.css'
import './TodayRail.css'

const MINUTE_MS = 60_000

interface FocusListProps {
  items: readonly FocusItem[]
  threads: readonly WorkThread[]
  candidates: readonly HomeFocusCandidate[]
}

function FocusRows({ items, threads, candidates }: FocusListProps): React.JSX.Element {
  const toggleDone = useFocusStore((s) => s.toggleDone)
  return (
    <ul className="desk-focus">
      {items.map((item) => {
        const done = focusDone(item, threads, candidates)
        return (
          <li key={item.id} className={done ? 'desk-focus__done' : undefined}>
            <Checkbox checked={done} label={item.title} onChange={() => toggleDone(item.id)} />
            <span>
              {item.title}
              {item.detail && <small>{item.detail}</small>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Task Vault's items for today that the operator has not picked: shown under the picked focus. */
function CandidateRows({ candidates }: { candidates: readonly HomeFocusCandidate[] }) {
  return (
    <ul className="desk-focus desk-focus--candidates">
      {candidates.map((candidate) => (
        <li key={candidate.id} className={candidate.done ? 'desk-focus__done' : undefined}>
          <Checkbox checked={candidate.done} label={candidate.title} />
          <span>
            {candidate.title}
            {candidate.detail && <small>{candidate.detail}</small>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function FocusEditor({ options, picked }: { options: FocusOption[]; picked: FocusItem[] }) {
  const { pickFocus, removeFocus } = useFocusStore.getState()
  const full = picked.length >= FOCUS_LIMIT
  return (
    <ul className="desk-focus desk-focus--editor" aria-label="Choose today's focus">
      {options.map((option) => {
        const chosen = picked.some((item) => item.id === option.id)
        return (
          <li key={option.id}>
            <Checkbox
              checked={chosen}
              label={option.title}
              onChange={() => (chosen ? removeFocus(option.id) : !full && pickFocus(option))}
            />
            <span>{option.title}</span>
          </li>
        )
      })}
    </ul>
  )
}

function FocusCard(): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const now = useNow(MINUTE_MS)
  const days = useFocusStore((s) => s.days)
  const { threads, allThreads } = useWorkThreads()
  const candidates = useHomeFeedStore((s) => s.focus)
  const picked = days[localDateKey(now)] ?? []
  const unpicked = candidates.filter((c) => !picked.some((item) => item.id === c.id))
  const options = [...threads.map(optionOfThread), ...candidates.map(optionOfCandidate)]
  return (
    <div className="desk-card">
      <div className="desk-sec-h desk-sec-h--tight">
        <h5>Today&apos;s focus</h5>
        <span className="desk-sec-h__right">
          <button type="button" className="desk-link" onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        </span>
      </div>
      {editing ? (
        <FocusEditor options={options} picked={picked} />
      ) : (
        <>
          <FocusRows items={picked} threads={allThreads} candidates={candidates} />
          <CandidateRows candidates={unpicked} />
        </>
      )}
    </div>
  )
}

/** The Desk's right rail: what to finish today, and how the week is going. */
export function TodayRail(): React.JSX.Element {
  return (
    <aside className="desk-rail" aria-label="Today">
      <FocusCard />
      <WeekCard />
    </aside>
  )
}
