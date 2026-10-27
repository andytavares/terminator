import React, { useState } from 'react'
import { ModalShell } from '@terminator/extension-ui'
import '@terminator/extension-ui/styles.css'
import { useExtensionRegistry } from '../../extensions/registry'
import { groupThreads, type ThreadGroup, type WorkThread } from '../../home/work-threads'
import { revealBranch } from '../../terminal/reveal-branch'
import { useWorkThreads } from '../home/useWorkThreads'
import { filterThreads } from '../home/desk-groups'
import { useDeskSelection } from '../home/desk-selection'
import { leadSessionOf } from '../home/thread-actions'
import { StateGlyph } from '../home/StateGlyph'
import { laneLabels } from '../../sidebar/lane-labels'
import { useTaskSwitcher } from './task-switcher.store'
import './TaskSwitcher.css'

/** Opens the task's most recently active terminal; a task with none open is shown on Home. */
function openLane(thread: WorkThread): void {
  const projectId = leadSessionOf(thread)?.projectId
  if (projectId) revealBranch(projectId)
  else openDrawer(thread)
}

/** Home, with the task's drawer open. */
function openDrawer(thread: WorkThread): void {
  useExtensionRegistry.getState().setActiveGlobalTab('core.home')
  useDeskSelection.getState().openThread(thread.key)
}

/** The switcher while it is open; it draws nothing otherwise. */
export function TaskSwitcher(): JSX.Element | null {
  const open = useTaskSwitcher((s) => s.open)
  return open ? <SwitcherDialog /> : null
}

function useChoices(text: string): { groups: ThreadGroup[]; threads: WorkThread[] } {
  const all = useWorkThreads().threads
  const groups = groupThreads(filterThreads(all, { text, count: null, taskState: null }))
  return { groups, threads: groups.flatMap((g) => g.threads) }
}

/** What the typed text narrows to, which choice is on, and what Enter and the arrows do. */
function useSwitcher() {
  const [text, setText] = useState('')
  const [chosen, setChosen] = useState(0)
  const { groups, threads } = useChoices(text)
  const hide = useTaskSwitcher((s) => s.hide)
  const choose = (thread: WorkThread | undefined, detail: boolean): void => {
    if (!thread) return
    hide()
    if (detail) openDrawer(thread)
    else openLane(thread)
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key]
    if (step !== undefined) {
      e.preventDefault()
      setChosen((i) => Math.max(0, Math.min(threads.length - 1, i + step)))
    } else if (e.key === 'Enter') choose(threads[chosen], e.metaKey || e.ctrlKey)
    else if (e.key === 'Escape') hide()
  }
  const type = (value: string): void => {
    setText(value)
    setChosen(0)
  }
  return { text, type, groups, chosenKey: threads[chosen]?.key, choose, onKeyDown, hide }
}

type Switcher = ReturnType<typeof useSwitcher>

function SwitcherField({ switcher }: { switcher: Switcher }): JSX.Element {
  return (
    <input
      autoFocus
      role="combobox"
      aria-expanded
      aria-controls="task-switcher-list"
      aria-label="Switch task"
      className="task-switcher__field"
      placeholder="Switch task…"
      value={switcher.text}
      onChange={(e) => switcher.type(e.target.value)}
      onKeyDown={switcher.onKeyDown}
    />
  )
}

function SwitcherDialog(): JSX.Element {
  const switcher = useSwitcher()
  return (
    <ModalShell
      label="Switch task"
      placement="top"
      className="task-switcher"
      onDismiss={switcher.hide}
    >
      <SwitcherField switcher={switcher} />
      <Choices
        groups={switcher.groups}
        chosenKey={switcher.chosenKey}
        onChoose={(thread) => switcher.choose(thread, false)}
      />
      <div className="task-switcher__hints">
        <span>↵ open</span>
        <span>⌘↵ details</span>
      </div>
    </ModalShell>
  )
}

interface ChoicesProps {
  groups: ThreadGroup[]
  chosenKey: string | undefined
  onChoose: (thread: WorkThread) => void
}

function Choices({ groups, chosenKey, onChoose }: ChoicesProps): JSX.Element {
  return (
    <div id="task-switcher-list" role="listbox" aria-label="Tasks" className="task-switcher__list">
      {groups.length === 0 && <div className="task-switcher__empty">No tasks match</div>}
      {groups.map((group) => (
        <div key={group.id} role="group" aria-label={group.label}>
          <div className="task-switcher__heading">{group.label}</div>
          {group.threads.map((thread) => (
            <Choice
              key={thread.key}
              thread={thread}
              chosen={thread.key === chosenKey}
              onChoose={onChoose}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

interface ChoiceProps {
  thread: WorkThread
  chosen: boolean
  onChoose: (thread: WorkThread) => void
}

function Choice({ thread, chosen, onChoose }: ChoiceProps): JSX.Element {
  return (
    <div
      role="option"
      aria-selected={chosen}
      className={`task-switcher__choice${chosen ? ' task-switcher__choice--chosen' : ''}`}
      onClick={() => onChoose(thread)}
    >
      <StateGlyph state={thread.state} inferred={thread.inferred} />
      <span className="task-switcher__title">{thread.title}</span>
      <span className="task-switcher__lanes">{laneLabels(thread.lanes).join(', ')}</span>
    </div>
  )
}
