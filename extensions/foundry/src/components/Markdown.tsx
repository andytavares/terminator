import React from 'react'

// A tracker's description, shown the way it was written.
//
// An issue's body is markdown, and it was rendered into a `<p>` — which
// collapses every newline, so "# Summary … # Context … # Acceptance Criteria
// - [ ] …" arrived as one unbroken line. The order's own words, made
// unreadable at the moment somebody most needs to read them.
//
// **Built as elements, never as HTML.** This text comes from a tracker, which
// means it comes from whoever wrote the ticket. `dangerouslySetInnerHTML`
// would put their markup inside the application; a React tree cannot, because
// nothing here interpolates a string into markup at all. That is also why
// there is no markdown dependency: `marked` was removed from this extension
// when the extension it replaced went, and bringing it back would mean
// sanitising its output rather than never producing any.
//
// Deliberately a subset — the shapes trackers actually emit. Anything it does
// not know is shown as the text it is, which is the honest failure for a
// renderer: never a blank space where a paragraph was.

/** Inline spans: code, bold, italic, links. Everything else is text. */
function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  // One pass, longest-first so `**` is not read as two `*`.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let match = pattern.exec(text)
  let n = 0
  while (match !== null) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const token = match[0]
    const key = `${keyPrefix}-i${n}`
    n += 1
    if (token.startsWith('`')) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](')
      const label = token.slice(1, split)
      const href = token.slice(split + 2, -1)
      // Only the two schemes a ticket legitimately links with. Anything else —
      // `javascript:`, a data URL — is shown as its own text rather than made
      // clickable, which is the whole reason this does not emit markup.
      out.push(
        /^https?:\/\//i.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ) : (
          <span key={key}>{token}</span>
        )
      )
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    last = match.index + token.length
    match = pattern.exec(text)
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

interface Block {
  readonly kind: 'h' | 'p' | 'ul' | 'ol' | 'code'
  readonly level?: number
  readonly lines: string[]
}

/** Group lines into blocks. Blank lines separate; a fence swallows to its pair. */
function blocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i += 1
      continue
    }
    if (line.trimStart().startsWith('```')) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        body.push(lines[i])
        i += 1
      }
      i += 1
      out.push({ kind: 'code', lines: body })
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim())
    if (heading !== null) {
      out.push({ kind: 'h', level: heading[1].length, lines: [heading[2]] })
      i += 1
      continue
    }
    const bullet = /^\s*([-*+])\s+/
    const numbered = /^\s*\d+[.)]\s+/
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = !bullet.test(line)
      const items: string[] = []
      while (i < lines.length && (bullet.test(lines[i]) || numbered.test(lines[i]))) {
        items.push(lines[i].replace(ordered ? numbered : bullet, ''))
        i += 1
      }
      out.push({ kind: ordered ? 'ol' : 'ul', lines: items })
      continue
    }
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,6}\s/.test(lines[i].trim()) &&
      !bullet.test(lines[i]) &&
      !numbered.test(lines[i]) &&
      !lines[i].trimStart().startsWith('```')
    ) {
      para.push(lines[i])
      i += 1
    }
    out.push({ kind: 'p', lines: para })
  }
  return out
}

/** A checkbox item, which is what an acceptance list in a ticket looks like. */
function item(text: string, key: string): React.ReactNode {
  const task = /^\[([ xX])\]\s*(.*)$/.exec(text.trim())
  if (task === null) return <li key={key}>{inline(text, key)}</li>
  return (
    <li key={key} className="fdry-md-task">
      <input type="checkbox" checked={task[1].toLowerCase() === 'x'} disabled readOnly />
      {inline(task[2], key)}
    </li>
  )
}

export interface MarkdownProps {
  readonly text: string
}

export function Markdown({ text }: MarkdownProps): JSX.Element | null {
  if (text.trim() === '') return null
  return (
    <div className="fdry-md">
      {blocks(text).map((block, index) => {
        const key = `b${index}`
        if (block.kind === 'code') {
          return (
            <pre key={key}>
              <code>{block.lines.join('\n')}</code>
            </pre>
          )
        }
        if (block.kind === 'h') {
          // One visual weight for every level: a ticket's `#` is its author's
          // habit, not a statement about this panel's hierarchy.
          return (
            <p key={key} className="fdry-md-h">
              {inline(block.lines[0], key)}
            </p>
          )
        }
        if (block.kind === 'ul' || block.kind === 'ol') {
          const children = block.lines.map((line, n) => item(line, `${key}-${n}`))
          return block.kind === 'ol' ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>
        }
        return <p key={key}>{inline(block.lines.join('\n'), key)}</p>
      })}
    </div>
  )
}
