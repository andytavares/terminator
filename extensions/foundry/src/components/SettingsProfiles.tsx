import React, { useState } from 'react'
import { Button } from '@terminator/extension-ui'
import { invoke } from '@terminator/extension-sdk/renderer'
import { checkRows, hasCommand, type ProfileFacts } from '../forge/checks-view.js'
import { useFoundryQuery } from '../renderer/foundry-query.js'

// The repositories Foundry holds commands for. They are kept in Foundry's own
// records, never in the repository; an order's Checks step changes them.

interface ProfileSummary {
  readonly repository: string
  readonly commands: number
  readonly proofCommit: string | null
  readonly provedAt: string | null
}

const repositoryName = (repository: string): string =>
  repository.split('/').filter(Boolean).pop() ?? repository

function provenWords({ proofCommit, provedAt }: ProfileSummary): string {
  if (proofCommit === null) return 'never proven'
  const day =
    provedAt === null
      ? ''
      : new Date(provedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `proven at ${proofCommit.slice(0, 7)}${day === '' ? '' : ` on ${day}`}`
}

const NO_PROFILES: readonly ProfileSummary[] = []

function useProfiles() {
  const { data, refetch } = useFoundryQuery(
    { key: ['profiles'], kinds: ['profile'] },
    async () => (await invoke('foundry:profiles-list')) as { profiles?: ProfileSummary[] }
  )
  const forget = async (repoPath: string): Promise<void> => {
    await invoke('foundry:profile-forget', { repoPath })
    await refetch()
  }
  return { profiles: data?.profiles ?? NO_PROFILES, loaded: data !== undefined, forget }
}

function CommandList({ repoPath }: { readonly repoPath: string }) {
  const { data: profile } = useFoundryQuery(
    { key: ['profile', repoPath], kinds: ['profile'] },
    async () => (await invoke('foundry:profile-read', { repoPath })) as ProfileFacts
  )
  if (profile === undefined) return <p className="fdry-note">Reading…</p>
  const rows = checkRows(profile, 'main', false).filter(hasCommand)
  return (
    <ul className="fdry-profile-commands">
      {rows.map((row) => (
        <li key={row.key}>
          <b>{row.label}</b> <code>{row.command}</code> <small>{row.source}</small>
        </li>
      ))}
    </ul>
  )
}

interface ItemProps {
  readonly summary: ProfileSummary
  readonly forget: (repoPath: string) => Promise<void>
}

function ProfileItem({ summary, forget }: ItemProps) {
  const [open, setOpen] = useState(false)
  const commands = `${summary.commands} command${summary.commands === 1 ? '' : 's'}`
  return (
    <div role="group" aria-label={repositoryName(summary.repository)} className="fdry-setrow">
      <div>
        <b>{repositoryName(summary.repository)}</b>
        <small>{`${summary.repository} · ${commands} · ${provenWords(summary)}`}</small>
        {open ? <CommandList repoPath={summary.repository} /> : null}
      </div>
      <div className="fdry-chk-moves">
        <Button size="sm" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void forget(summary.repository)}>
          Forget
        </Button>
      </div>
    </div>
  )
}

/** The settings section listing every repository profile, with Show and Forget. */
export function RepositoryChecks(): JSX.Element {
  const { profiles, loaded, forget } = useProfiles()
  return (
    <>
      <h2 className="fdry-panel-h" style={{ marginTop: 20 }}>
        Repository checks
      </h2>
      <p className="fdry-note">
        The commands Foundry runs in each repository. They are kept in Foundry’s records, never in
        the repository. Change them from an order’s Checks step.
      </p>
      {loaded && profiles.length === 0 ? (
        <p className="fdry-note">No repository has checks yet.</p>
      ) : null}
      <div className="fdry-profiles">
        {profiles.map((summary) => (
          <ProfileItem key={summary.repository} summary={summary} forget={forget} />
        ))}
      </div>
    </>
  )
}
