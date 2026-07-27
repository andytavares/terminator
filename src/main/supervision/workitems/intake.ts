// Intake (FR-068, FR-069). Three sources become one shape, and none of them
// start an agent — auto-start on intake is what produces the unreviewable
// backlog this whole feature exists to prevent.

export type IntakeSource = 'linear' | 'github' | 'local'

export interface IntakeStub {
  readonly id: string
  readonly source: IntakeSource
  readonly sourceUrl: string | null
  readonly title: string
  readonly createdAt: number
  /** Always `intake`. Promotion is a separate, explicit act (FR-069). */
  readonly phase: 'intake'
}

export type IntakeResult = { ok: true; stub: IntakeStub } | { ok: false; reason: string }

const LINEAR = /^https?:\/\/(?:www\.)?linear\.app\/[^/]+\/issue\/([A-Z0-9]+-\d+)/i
const GITHUB_ISSUE = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/i

export function intakeFromUrl(url: string, at: number): IntakeResult {
  const trimmed = url.trim()

  const linear = trimmed.match(LINEAR)
  if (linear !== null) {
    return {
      ok: true,
      stub: {
        id: linear[1].toUpperCase(),
        source: 'linear',
        sourceUrl: trimmed,
        // The real title arrives when a producer publishes a contract; until
        // then the identifier is the honest placeholder.
        title: linear[1].toUpperCase(),
        createdAt: at,
        phase: 'intake',
      },
    }
  }

  const github = trimmed.match(GITHUB_ISSUE)
  if (github !== null) {
    const [, owner, repo, number] = github
    return {
      ok: true,
      stub: {
        id: `${owner}/${repo}#${number}`,
        source: 'github',
        sourceUrl: trimmed,
        title: `${repo}#${number}`,
        createdAt: at,
        phase: 'intake',
      },
    }
  }

  return { ok: false, reason: 'not a recognised Linear or GitHub issue URL' }
}

export function intakeFromDocument(filePath: string, contents: string, at: number): IntakeResult {
  const fileName = filePath.split('/').pop() ?? filePath
  if (!/\.(md|markdown|txt)$/i.test(fileName)) {
    return { ok: false, reason: 'only markdown or text documents can be brought in' }
  }

  // First markdown heading, else the first non-blank line, else the file name.
  const heading = contents.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const firstLine = contents
    .split('\n')
    .find((line) => line.trim() !== '')
    ?.trim()
  const title = heading ?? firstLine ?? fileName

  return {
    ok: true,
    stub: {
      id: fileName.replace(/\.[^.]+$/, ''),
      source: 'local',
      sourceUrl: filePath,
      title: title.slice(0, 200),
      createdAt: at,
      phase: 'intake',
    },
  }
}
