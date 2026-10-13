import React, { useEffect, useState } from 'react'
import type { PullRequest } from '../schemas/git.schema'
import { notificationsAPI } from '../api/notifications'

/** The pull request GitFullView's `git:pr-created` window event last announced, notified once. */
function useCreatedPullRequest(): PullRequest | null {
  const [created, setCreated] = useState<PullRequest | null>(null)
  useEffect(() => {
    const adoptCreatedPr = (event: Event) => {
      const { pr } = (event as CustomEvent<{ pr: PullRequest }>).detail
      setCreated(pr)
      const title = `Opened #${pr.number} ${pr.title}`
      void notificationsAPI.notify({ type: 'success', title, key: 'prCreated', message: pr.url })
    }
    window.addEventListener('git:pr-created', adoptCreatedPr)
    return () => window.removeEventListener('git:pr-created', adoptCreatedPr)
  }, [])
  return created
}

/** The pull request Open PR just created: a notification, and a link under the commit box that
 *  opens it on GitHub. */
export function PrCreatedNotice(): JSX.Element | null {
  const created = useCreatedPullRequest()
  if (!created) return null
  return (
    <div className="git-view__pr-created" role="status">
      Opened{' '}
      <a
        href={created.url}
        onClick={(e) => {
          e.preventDefault()
          window.electronAPI.shell.openExternal(created.url).catch(() => {})
        }}
      >
        #{created.number} {created.title}
      </a>
    </div>
  )
}
