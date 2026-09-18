import React from 'react'
import hljs from 'highlight.js/lib/common'

// One hunk, read as a diff: added and removed lines tinted the way the git
// view tints them, the code highlighted, and each line numbered as it stands in
// the new file. It was one grey <pre> of raw `+`/`-` lines.

/** The languages highlight.js's common set covers, by file extension. */
const LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  md: 'markdown',
  html: 'xml',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  sql: 'sql',
}

export function languageOf(file: string): string | undefined {
  const name = file.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot === -1 ? undefined : LANGUAGE[name.slice(dot + 1).toLowerCase()]
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Highlighted HTML for one line. highlight.js escapes what it reads, so its
 * output is safe to set; anything it cannot read is escaped here instead.
 */
function highlighted(code: string, language: string | undefined): string {
  if (language === undefined || hljs.getLanguage(language) === undefined) return escape(code)
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value
  } catch {
    return escape(code)
  }
}

type Kind = 'add' | 'remove' | 'context' | 'meta'

function kindOf(line: string): Kind {
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'remove'
  // "\ No newline at end of file" belongs to the line before it.
  if (line.startsWith('\\')) return 'meta'
  return 'context'
}

export function HunkLines({
  file,
  newStart,
  lines,
}: {
  readonly file: string
  readonly newStart: number
  readonly lines: readonly string[]
}): JSX.Element {
  const language = languageOf(file)
  let next = newStart
  return (
    <pre className="fdry-diff">
      <code>
        {lines.map((line, index) => {
          const kind = kindOf(line)
          const number = kind === 'add' || kind === 'context' ? next++ : null
          const code = kind === 'meta' ? line : line.slice(1)
          return (
            <span key={index} className={`fdry-diff-line is-${kind}`}>
              <span className="fdry-diff-num">{number ?? ''}</span>
              <span className="fdry-diff-sign">{kind === 'meta' ? '' : line.charAt(0)}</span>
              <span
                className="fdry-diff-code"
                dangerouslySetInnerHTML={{
                  __html: kind === 'meta' ? escape(code) : highlighted(code, language),
                }}
              />
            </span>
          )
        })}
      </code>
    </pre>
  )
}
