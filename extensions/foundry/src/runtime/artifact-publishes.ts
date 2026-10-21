import { existsSync, readFileSync } from 'fs'

/** One Artifact publish a session's transcript records. */
export interface PublishedArtifact {
  readonly path: string
  readonly url: string
}

interface Block {
  type?: unknown
  id?: unknown
  name?: unknown
  input?: unknown
  tool_use_id?: unknown
  content?: unknown
}

const PUBLISHED_LINE = /^Published (\S.*?) at (https?:\/\/\S+)/

function blocksOf(line: string): Block[] {
  try {
    const content = (JSON.parse(line) as { message?: { content?: unknown } }).message?.content
    return Array.isArray(content) ? (content as Block[]) : []
  } catch {
    return []
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part: { type?: unknown; text?: unknown }) =>
      part?.type === 'text' && typeof part.text === 'string' ? part.text : ''
    )
    .join('\n')
}

/** Every Artifact publish the transcript records, from its tool_use/tool_result pairs. */
export function publishedArtifacts(transcriptText: string): PublishedArtifact[] {
  const artifactCalls = new Set<string>()
  const published: PublishedArtifact[] = []
  for (const line of transcriptText.split('\n')) {
    for (const block of blocksOf(line)) {
      if (block.type === 'tool_use' && block.name === 'Artifact' && typeof block.id === 'string') {
        artifactCalls.add(block.id)
      } else if (
        block.type === 'tool_result' &&
        typeof block.tool_use_id === 'string' &&
        artifactCalls.has(block.tool_use_id)
      ) {
        const match = PUBLISHED_LINE.exec(textOf(block.content))
        if (match !== null) published.push({ path: match[1], url: match[2] })
      }
    }
  }
  return published
}

/** The publishes in a transcript file; a transcript that is not there published nothing. */
export function readPublishedArtifacts(transcriptPath: string): PublishedArtifact[] {
  if (!existsSync(transcriptPath)) return []
  return publishedArtifacts(readFileSync(transcriptPath, 'utf8'))
}
