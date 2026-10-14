import React, { useState } from 'react'
import { Check } from 'lucide-react'
import type { IndexedProject } from '../vault/types'
import { setProjectStatusInReview } from '../utils/review-log'
import { Button } from '@terminator/extension-ui'

interface Props {
  activeProjects: IndexedProject[]
  onComplete: () => void
  reviewId: string | null
}

type UpdateStatus = (project: IndexedProject, status: string) => void

interface RowProps {
  project: IndexedProject
  onStatus: UpdateStatus
}

/** A stale project can go to someday or the archive; a live one is kept. */
function ProjectActions({ project, onStatus }: RowProps): React.JSX.Element {
  if (project.isStale) {
    return (
      <span className="wr-step__project-actions">
        <Button onClick={() => onStatus(project, 'someday')}>Someday</Button>
        <Button onClick={() => onStatus(project, 'archived')}>Archive</Button>
      </span>
    )
  }
  return (
    <span className="wr-step__project-actions">
      <Button variant="primary" onClick={() => onStatus(project, 'active')}>
        Keep <Check className="tm-icon" />
      </Button>
    </span>
  )
}

function ProjectRow({ project, onStatus }: RowProps): React.JSX.Element {
  return (
    <li className={`wr-step__item${project.isStale ? ' wr-step__item--stale' : ''}`}>
      <span className="wr-step__project-name">{project.name}</span>
      {project.isStale && <span className="wr-step__stale-badge">stale</span>}
      <ProjectActions project={project} onStatus={onStatus} />
    </li>
  )
}

export function WeeklyReviewStep3Projects(props: Props): React.JSX.Element {
  const { activeProjects, onComplete, reviewId } = props
  const [projects, setProjects] = useState(activeProjects)

  async function updateStatus(project: IndexedProject, status: string) {
    await setProjectStatusInReview({ reviewId, step: 3 }, project, status)
    setProjects((prev) => prev.filter((p) => p.filePath !== project.filePath))
  }

  return (
    <div className="wr-step wr-step-3">
      <h3>Step 3: Review Projects</h3>
      <p>Review each project. Move stale ones or add next actions.</p>
      {projects.length === 0 && <p className="wr-step__done">All projects reviewed!</p>}
      <ul className="wr-step__list">
        {projects.map((project) => (
          <ProjectRow key={project.id} project={project} onStatus={updateStatus} />
        ))}
      </ul>
      <Button variant="primary" onClick={onComplete}>
        Next: stale
      </Button>
    </div>
  )
}
