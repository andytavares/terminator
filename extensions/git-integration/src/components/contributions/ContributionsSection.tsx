import React, { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, IconButton } from '@terminator/extension-ui'
import { githubAPI } from '../../api/github'
import {
  ContributionsReplySchema,
  type ContributionsReply,
} from '../../schemas/contributions.schema'
import { choose, errorMessageOf } from '../text'
import { periodRange, type PeriodSelection } from './period-presets'
import { ContributionsFilters } from './ContributionsFilters'
import { PeriodStats } from './PeriodStats'
import { Heatmap } from './Heatmap'
import { Highlights } from './Highlights'
import './contributions.css'

const NOT_AUTHENTICATED_HINT = 'Sign in to GitHub in Settings to see your contributions.'
const RATE_LIMITED_HINT = 'GitHub rate-limited the request. Try again shortly.'

interface ContributionsState {
  reply: ContributionsReply | null
  loading: boolean
  error: string | null
}

const INITIAL: ContributionsState = { reply: null, loading: true, error: null }

/** The error text the view shows for a failed or refused load. */
function errorText(thrown: unknown): string {
  const error = errorMessageOf(thrown)
  if (error === 'NOT_AUTHENTICATED') return NOT_AUTHENTICATED_HINT
  if (error === 'RATE_LIMITED') return RATE_LIMITED_HINT
  return error
}

async function requestContributions(
  selection: PeriodSelection,
  repo: string | null,
  refresh: boolean
): Promise<ContributionsReply> {
  const range =
    selection.kind === 'preset'
      ? periodRange(selection.preset, new Date())
      : { from: selection.from, to: selection.to }
  const args = { ...range, ...(repo ? { repo } : {}), ...(refresh ? { refresh } : {}) }
  const reply = await githubAPI.contributionsCalendar(args)
  if ('error' in reply) throw new Error(reply.error)
  return ContributionsReplySchema.parse(reply)
}

interface Contributions {
  state: ContributionsState
  period: PeriodSelection
  repo: string | null
  setPeriod: (selection: PeriodSelection) => void
  setRepo: (repo: string | null) => void
  refresh: () => void
}

/** The reply and its filters; a newer request's answer discards an older one in flight. */
function useContributions(): Contributions {
  const [state, setState] = useState<ContributionsState>(INITIAL)
  const [period, setPeriod] = useState<PeriodSelection>({ kind: 'preset', preset: 'year' })
  const [repo, setRepo] = useState<string | null>(null)
  const requestRef = useRef(0)
  const load = useCallback(
    async (selection: PeriodSelection, atRepo: string | null, fresh: boolean) => {
      const request = ++requestRef.current
      setState((was) => ({ ...was, loading: true, error: null }))
      try {
        const reply = await requestContributions(selection, atRepo, fresh)
        if (request === requestRef.current) setState({ reply, loading: false, error: null })
      } catch (thrown) {
        if (request === requestRef.current) {
          setState((was) => ({ ...was, loading: false, error: errorText(thrown) }))
        }
      }
    },
    []
  )
  useEffect(() => void load(period, repo, false), [load, period, repo])
  return { state, period, repo, setPeriod, setRepo, refresh: () => void load(period, repo, true) }
}

/** The Home Contributions section: period stats, the year heatmap and the highlights. */
export function ContributionsSection(): React.JSX.Element {
  const { state, period, repo, setPeriod, setRepo, refresh } = useContributions()
  return (
    <div
      className={`ct-section${choose(state.loading && state.reply !== null, ' ct-loading', '')}`}
    >
      <div className="ct-bar">
        <span className="ct-title">Contributions</span>
        <span className="ct-sp" />
        <ContributionsFilters
          period={period}
          repo={repo}
          repos={state.reply?.repos ?? []}
          onPeriod={setPeriod}
          onRepo={setRepo}
        />
        <IconButton
          icon={RefreshCw}
          label="Refresh contributions"
          size="sm"
          onClick={refresh}
          disabled={state.loading}
        />
      </div>
      <SectionBody state={state} onRetry={refresh} />
    </div>
  )
}

function SectionBody(props: { state: ContributionsState; onRetry: () => void }): React.JSX.Element {
  const { reply, loading, error } = props.state
  if (error) return <ErrorRow error={error} onRetry={props.onRetry} />
  return (
    <>
      <StatsBody reply={reply} />
      {loading && <div className="ct-note">Loading contributions…</div>}
    </>
  )
}

function StatsBody({ reply }: { reply: ContributionsReply | null }): React.JSX.Element {
  return (
    <>
      <PeriodStats period={reply ? reply.period : null} previous={reply ? reply.previous : null} />
      <Heatmap
        weeks={reply ? reply.calendar.weeks : null}
        total={reply ? reply.calendar.total : 0}
      />
      <Highlights calendar={reply ? reply.calendar : null} />
    </>
  )
}

function ErrorRow(props: { error: string; onRetry: () => void }): React.JSX.Element {
  return (
    <div className="ct-error" role="alert">
      <span>{props.error}</span>
      <Button size="sm" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  )
}
