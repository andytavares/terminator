import React, { useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import type { IndexedTask, IndexedProject } from '../vault/types'
import { WeeklyReviewStep1GetClear } from './WeeklyReviewStep1GetClear'
import { WeeklyReviewStep2Inbox } from './WeeklyReviewStep2Inbox'
import { WeeklyReviewStep3Projects } from './WeeklyReviewStep3Projects'
import { WeeklyReviewStepStaleTasks } from './WeeklyReviewStepStaleTasks'
import { WeeklyReviewStep5Someday } from './WeeklyReviewStep5Someday'
import { WeeklyReviewStep6Reflect } from './WeeklyReviewStep6Reflect'
import { WeeklyReviewHistory } from './WeeklyReviewHistory'
import { Button, IconButton } from '@terminator/extension-ui'

interface WeeklyReviewPayload {
  inboxItems: IndexedTask[]
  activeProjects: IndexedProject[]
  staleProjects: IndexedProject[]
  somedayProjects: IndexedProject[]
  somedayTasks: IndexedTask[]
  completedLastWeek: IndexedTask[]
  staleTasks: IndexedTask[]
  staleDaysThreshold: number
  lastReviewDate: string | null
}

const TOTAL_STEPS = 6

/**
 * The six steps, named.
 *
 * Position used to be stated four times over — a large numeral, the words
 * "step 1 of 6", six unlabelled dots, and the step's own heading — while what
 * the steps actually are was never shown. Naming them makes the row a map as
 * well as a progress indicator, and one statement of position is enough.
 */
const STEP_NAMES = ['Get clear', 'Inbox', 'Projects', 'Stale', 'Someday', 'Reflect'] as const

const DRAFT_KEY = 'task-vault:weekly-review-draft'

type SetPayload = React.Dispatch<React.SetStateAction<WeeklyReviewPayload | null>>

function readDraftStep(): number {
  const draft = sessionStorage.getItem(DRAFT_KEY)
  if (!draft) return 1
  const parsed = JSON.parse(draft) as { step?: number }
  return parsed.step && parsed.step > 1 ? parsed.step : 1
}

function fetchReviewPayload(): Promise<WeeklyReviewPayload> {
  return window.electronAPI.extensionBridge.invoke(
    'task-vault:projects:weekly-review',
    {}
  ) as Promise<WeeklyReviewPayload>
}

/**
 * Identifies the persisted review every step records its actions against.
 * Resumes the open review rather than forking a second record, which matters
 * because the step is restored from sessionStorage.
 */
function useReviewRecord(): string | null {
  const [reviewId, setReviewId] = useState<string | null>(null)
  useEffect(() => {
    void window.electronAPI.extensionBridge
      .invoke('task-vault:review:start', {})
      .then((result) => {
        const id = (result as { review?: { id: string } })?.review?.id
        if (id) setReviewId(id)
      })
      .catch((err) => console.error('[task-vault] failed to start review', err))
  }, [])
  return reviewId
}

function useReviewData() {
  const [payload, setPayload] = useState<WeeklyReviewPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    fetchReviewPayload()
      .then(setPayload)
      .finally(() => setIsLoading(false))
  }, [])
  return { payload, setPayload, isLoading }
}

/**
 * Refreshes the inbox before mounting Step 2 so captures from Get Clear appear
 * immediately: Step 2 reads its items only at mount time. A failure is non-fatal,
 * since Step 2 then shows items from the initial load.
 */
function refreshInbox(setPayload: SetPayload): Promise<void> {
  return fetchReviewPayload()
    .then((fresh) => {
      setPayload((prev) => (prev ? { ...prev, inboxItems: fresh.inboxItems } : fresh))
    })
    .catch(() => {})
}

/** The current step, restored from the draft, with Cmd/Ctrl+arrow navigation. */
function useSteps(setPayload: SetPayload) {
  const [step, setStep] = useState(readDraftStep)

  function nextStep() {
    if (step >= TOTAL_STEPS) return
    const next = step + 1
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: next }))
    if (step === 1) void refreshInbox(setPayload).finally(() => setStep(next))
    else setStep(next)
  }

  function prevStep() {
    if (step > 1) setStep((s) => s - 1)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowRight') nextStep()
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowLeft') prevStep()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  return { step, nextStep, prevStep }
}

function HistoryScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <div className="weekly-review">
      <div className="weekly-review__header">
        <div className="weekly-review__header-left">
          <div>
            <h2>Past Reviews</h2>
            <span className="weekly-review__stepper">what you decided, week by week</span>
          </div>
        </div>
        <div className="weekly-review__nav">
          <Button variant="ghost" size="sm" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
      <div className="weekly-review__content">
        <WeeklyReviewHistory />
      </div>
    </div>
  )
}

function DoneScreen({ onHistory }: { onHistory: () => void }): React.JSX.Element {
  return (
    <div className="weekly-review weekly-review--done">
      <div className="weekly-review__complete">
        <Check aria-hidden="true" className="weekly-review__complete-icon" />
        <p className="weekly-review__complete-title">Review complete</p>
        <p className="weekly-review__complete-sub">
          Your mind is clear. You&apos;re ready for the week.
        </p>
        <Button onClick={onHistory}>View past reviews</Button>
      </div>
    </div>
  )
}

function stepClass(position: number, step: number): string {
  if (position === step) return 'weekly-review__step weekly-review__step--on'
  if (position < step) return 'weekly-review__step weekly-review__step--done'
  return 'weekly-review__step'
}

function StepTrail({ step }: { step: number }): React.JSX.Element {
  return (
    <nav className="weekly-review__steps" aria-label="Weekly review steps">
      {STEP_NAMES.map((name, i) => (
        <span
          aria-current={i + 1 === step ? 'step' : undefined}
          key={name}
          className={stepClass(i + 1, step)}
        >
          {name}
        </span>
      ))}
    </nav>
  )
}

interface HeaderProps {
  step: number
  onHistory: () => void
  onPrev: () => void
  onNext: () => void
}

function StepNav(props: HeaderProps): React.JSX.Element {
  const { step, onHistory, onPrev, onNext } = props
  return (
    <div className="weekly-review__nav">
      <Button variant="ghost" size="sm" onClick={onHistory}>
        History
      </Button>
      <IconButton
        icon={ChevronLeft}
        label="Previous step"
        size="sm"
        onClick={onPrev}
        disabled={step === 1}
      />
      <IconButton
        icon={ChevronRight}
        label="Next step"
        size="sm"
        onClick={onNext}
        disabled={step === TOTAL_STEPS}
      />
    </div>
  )
}

function ReviewHeader(props: HeaderProps): React.JSX.Element {
  return (
    <div className="weekly-review__header">
      <StepTrail step={props.step} />
      <span className="weekly-review__stepper">
        {props.step} of {TOTAL_STEPS}
      </span>
      <StepNav {...props} />
    </div>
  )
}

interface StepProps {
  step: number
  payload: WeeklyReviewPayload
  reviewId: string | null
  onNext: () => void
  onDone: () => void
}

/** Each step's view, by its number. */
const STEP_VIEWS: Record<number, (props: StepProps) => React.JSX.Element> = {
  1: ({ reviewId, onNext }) => (
    <WeeklyReviewStep1GetClear onComplete={onNext} reviewId={reviewId} />
  ),
  2: ({ payload, reviewId, onNext }) => (
    <WeeklyReviewStep2Inbox
      inboxItems={payload.inboxItems}
      onComplete={onNext}
      reviewId={reviewId}
    />
  ),
  3: ({ payload, reviewId, onNext }) => (
    <WeeklyReviewStep3Projects
      activeProjects={payload.activeProjects}
      onComplete={onNext}
      reviewId={reviewId}
    />
  ),
  4: ({ payload, reviewId, onNext }) => (
    <WeeklyReviewStepStaleTasks
      staleTasks={payload.staleTasks}
      staleDaysThreshold={payload.staleDaysThreshold}
      onComplete={onNext}
      reviewId={reviewId}
    />
  ),
  5: ({ payload, reviewId, onNext }) => (
    <WeeklyReviewStep5Someday
      somedayProjects={payload.somedayProjects}
      somedayTasks={payload.somedayTasks}
      onComplete={onNext}
      reviewId={reviewId}
    />
  ),
  6: ({ reviewId, onDone }) => <WeeklyReviewStep6Reflect onComplete={onDone} reviewId={reviewId} />,
}

interface ActiveProps extends StepProps {
  onHistory: () => void
  onPrev: () => void
}

function ActiveReview(props: ActiveProps): React.JSX.Element {
  const { step, onHistory, onPrev, onNext } = props
  const view = STEP_VIEWS[step]
  return (
    <div className="weekly-review">
      <ReviewHeader step={step} onHistory={onHistory} onPrev={onPrev} onNext={onNext} />
      <div className="weekly-review__content">{view ? view(props) : null}</div>
    </div>
  )
}

export function WeeklyReview(): React.JSX.Element {
  const reviewId = useReviewRecord()
  const { payload, setPayload, isLoading } = useReviewData()
  const { step, nextStep, prevStep } = useSteps(setPayload)
  const [done, setDone] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const openHistory = () => setShowHistory(true)

  function handleDone() {
    sessionStorage.removeItem(DRAFT_KEY)
    setDone(true)
  }

  if (isLoading)
    return <div className="weekly-review weekly-review--loading">Loading review data…</div>
  if (showHistory) return <HistoryScreen onBack={() => setShowHistory(false)} />
  if (done) return <DoneScreen onHistory={openHistory} />
  if (!payload)
    return <div className="weekly-review weekly-review--error">Could not load review data.</div>
  return (
    <ActiveReview
      {...{ step, payload, reviewId, onHistory: openHistory, onPrev: prevStep }}
      onNext={nextStep}
      onDone={handleDone}
    />
  )
}
