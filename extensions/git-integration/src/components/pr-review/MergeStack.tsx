import React, { useEffect, useState } from 'react'
import { GitMerge, Undo2 } from 'lucide-react'
import { Button, Popover } from '@terminator/extension-ui'
import { recordUsage } from '@terminator/extension-sdk/renderer'
import { plural } from '@terminator/extension-sdk'
import { githubAPI, type StackPlan } from '../../api/github'
import type { PrReviewDetail } from '../../schemas/pr-review.schema'
import { choose, errorMessageOf } from '../text'

/** The pull requests under this one that Merge stack merges first; null until known or when none. */
export function useStackPlan(repoRoot: string, pr: PrReviewDetail): StackPlan | null {
  const [plan, setPlan] = useState<StackPlan | null>(null)
  useEffect(() => {
    if (pr.state === 'merged' || pr.state === 'closed') return
    githubAPI
      .mergeStackPlan(repoRoot, pr.number)
      .then((reply) => setPlan('stack' in reply && reply.stack.length > 1 ? reply : null))
      .catch(() => setPlan(null))
  }, [repoRoot, pr.number, pr.state])
  return plan
}

interface StackRunProps {
  repoRoot: string
  pr: PrReviewDetail
  onRefresh?: () => Promise<void>
}

/** Runs the stack merge, and says in words how it ended. */
export function useStackMerge({ repoRoot, pr, onRefresh }: StackRunProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setMessage(null)
    recordUsage('merge-stack')
    try {
      const result = await githubAPI.mergeStack(repoRoot, pr.number)
      setMessage(describeResult(result))
      await onRefresh?.()
    } catch (e) {
      setMessage(errorMessageOf(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, message, run }
}

type StackReply = Awaited<ReturnType<typeof githubAPI.mergeStack>>

function describeResult(result: StackReply): string {
  if ('error' in result) return `Could not merge: ${result.error}`
  const done = `Merged ${result.merged.length} ${plural(result.merged.length, 'pull request')}.`
  if (!result.failed) return done
  return `${done} Stopped at #${result.failed.number}: ${result.failed.reason}`
}

export type StackMerge = ReturnType<typeof useStackMerge>

function StepText({ step, into }: { step: StackPlan['stack'][number]; into: string }) {
  if (step.baseRefName === into) return <>Squash-merge into {into}</>
  return (
    <>
      Retarget from {step.baseRefName} to {into}, wait for GitHub to recheck, then squash-merge
    </>
  )
}

function StepList({ plan }: { plan: StackPlan }) {
  return (
    <ol className="pr-merge-stack-steps">
      {plan.stack.map((step) => (
        <li key={step.number}>
          <strong>
            #{step.number} {step.title}
          </strong>
          <span>
            <StepText step={step} into={plan.into} />
          </span>
        </li>
      ))}
    </ol>
  )
}

function ConfirmPopover(props: { plan: StackPlan; merge: StackMerge; onClose: () => void }) {
  const { plan, merge, onClose } = props
  const count = plan.stack.length
  const confirm = () => {
    onClose()
    merge.run()
  }
  return (
    <Popover label="Merge stack" className="pr-merge-stack-pop" align="end" onDismiss={onClose}>
      <h2 className="pr-merge-stack-title">
        Merge {count} pull requests into {plan.into}
      </h2>
      <StepList plan={plan} />
      <p>Stops at the first pull request that cannot merge and says why.</p>
      <div className="pr-merge-stack-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={confirm}>
          Merge {count} pull requests
        </Button>
      </div>
    </Popover>
  )
}

/** "Merge stack · N", before Start review, on a pull request stacked on another open one. */
export function MergeStackButton({ plan, merge }: { plan: StackPlan; merge: StackMerge }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="pr-merge-stack">
      <Button onClick={() => setOpen(true)} disabled={merge.busy}>
        <GitMerge aria-hidden className="tm-icon" />
        {choose(merge.busy, 'Merging…', `Merge stack · ${plan.stack.length}`)}
      </Button>
      {open && <ConfirmPopover plan={plan} merge={merge} onClose={() => setOpen(false)} />}
    </span>
  )
}

/** Opens GitHub's revert of this merged pull request, then shows it. */
export function useRevert(repoRoot: string, pr: PrReviewDetail) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setError(null)
    recordUsage('revert-pr')
    try {
      const result = await githubAPI.revert(repoRoot, pr.number)
      if ('error' in result) setError(`Could not open the revert: ${result.error}`)
      else window.electronAPI.shell.openExternal(result.url).catch(() => {})
    } catch (e) {
      setError(errorMessageOf(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

export function RevertButton({ revert }: { revert: ReturnType<typeof useRevert> }) {
  return (
    <Button variant="primary" onClick={revert.run} disabled={revert.busy}>
      <Undo2 aria-hidden className="tm-icon" />
      {choose(revert.busy, 'Opening revert…', 'Open revert PR')}
    </Button>
  )
}
