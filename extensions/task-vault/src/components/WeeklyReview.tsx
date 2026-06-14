import React, { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { IndexedTask, IndexedProject } from '../vault/types'
import { WeeklyReviewStep1GetClear } from './WeeklyReviewStep1GetClear'
import { WeeklyReviewStep2Inbox } from './WeeklyReviewStep2Inbox'
import { WeeklyReviewStep3Projects } from './WeeklyReviewStep3Projects'
import { WeeklyReviewStep5Someday } from './WeeklyReviewStep5Someday'
import { WeeklyReviewStep6Reflect } from './WeeklyReviewStep6Reflect'

interface WeeklyReviewPayload {
  inboxItems: IndexedTask[]
  activeProjects: IndexedProject[]
  staleProjects: IndexedProject[]
  somedayProjects: IndexedProject[]
  somedayTasks: IndexedTask[]
  completedLastWeek: IndexedTask[]
  lastReviewDate: string | null
}

const TOTAL_STEPS = 5

const DRAFT_KEY = 'task-vault:weekly-review-draft'

export function WeeklyReview(): React.JSX.Element {
  const [step, setStep] = useState(1)
  const [payload, setPayload] = useState<WeeklyReviewPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [done, setDone] = useState(false)

  useEffect(() => {
    // Restore draft step if present
    const draft = sessionStorage.getItem(DRAFT_KEY)
    if (draft) {
      const parsed = JSON.parse(draft) as { step?: number }
      if (parsed.step && parsed.step > 1) setStep(parsed.step)
    }
    load()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowRight') nextStep()
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowLeft') prevStep()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  async function load() {
    setIsLoading(true)
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'task-vault:projects:weekly-review',
        {}
      )
      setPayload(result as WeeklyReviewPayload)
    } finally {
      setIsLoading(false)
    }
  }

  function nextStep() {
    if (step < TOTAL_STEPS) {
      const next = step + 1
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: next }))
      if (step === 1) {
        // Refresh inbox before mounting Step 2 so captures from Get Clear appear immediately.
        // Step 2 uses useState(inboxItems) which only reads props at mount time.
        void window.electronAPI.extensionBridge
          .invoke('task-vault:projects:weekly-review', {})
          .then((result) => {
            const fresh = result as WeeklyReviewPayload
            setPayload((prev) => (prev ? { ...prev, inboxItems: fresh.inboxItems } : fresh))
          })
          .catch(() => {
            // Non-fatal — Step 2 shows items from the initial load
          })
          .finally(() => setStep(next))
      } else {
        setStep(next)
      }
    }
  }

  function prevStep() {
    if (step > 1) setStep((s) => s - 1)
  }

  function handleDone() {
    sessionStorage.removeItem(DRAFT_KEY)
    setDone(true)
  }

  if (isLoading)
    return <div className="weekly-review weekly-review--loading">Loading review data…</div>
  if (done)
    return (
      <div className="weekly-review weekly-review--done">
        <div className="weekly-review__complete">
          <span className="weekly-review__complete-icon">✦</span>
          <p className="weekly-review__complete-title">Review complete</p>
          <p className="weekly-review__complete-sub">
            Your mind is clear. You're ready for the week.
          </p>
        </div>
      </div>
    )
  if (!payload)
    return <div className="weekly-review weekly-review--error">Could not load review data.</div>

  return (
    <div className="weekly-review">
      <div className="weekly-review__header">
        <div className="weekly-review__header-left">
          <span className="weekly-review__step-num">{step}</span>
          <div>
            <h2>Weekly Review</h2>
            <span className="weekly-review__stepper">
              step {step} of {TOTAL_STEPS}
            </span>
          </div>
        </div>
        <div className="weekly-review__progress">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span
              key={i}
              className={`weekly-review__dot${i + 1 === step ? ' weekly-review__dot--active' : i + 1 < step ? ' weekly-review__dot--done' : ''}`}
            />
          ))}
        </div>
        <div className="weekly-review__nav">
          <button
            className="tv-btn tv-btn--secondary"
            onClick={prevStep}
            disabled={step === 1}
            aria-label="Previous step"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            className="tv-btn tv-btn--primary"
            onClick={nextStep}
            disabled={step === TOTAL_STEPS}
            aria-label="Next step"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="weekly-review__content">
        {step === 1 && <WeeklyReviewStep1GetClear onComplete={nextStep} />}
        {step === 2 && (
          <WeeklyReviewStep2Inbox inboxItems={payload.inboxItems} onComplete={nextStep} />
        )}
        {step === 3 && (
          <WeeklyReviewStep3Projects
            activeProjects={payload.activeProjects}
            onComplete={nextStep}
          />
        )}
        {step === 4 && (
          <WeeklyReviewStep5Someday
            somedayProjects={payload.somedayProjects}
            somedayTasks={payload.somedayTasks}
            onComplete={nextStep}
          />
        )}
        {step === 5 && <WeeklyReviewStep6Reflect onComplete={handleDone} />}
      </div>
    </div>
  )
}
