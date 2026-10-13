import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'

// A link never ends in the punctuation that ends its sentence: the
// lookbehind makes the match give back a trailing `.` `,` `;` `:` `!` `?`.
const URL_PATTERN = /https?:\/\/(?:[^\s()>\]'"\\]|\([^\s()>\]'"\\]*\))+(?<![.,;:!?])/g
// www. prefix URLs without a protocol (opened with https:// prepended)
const BARE_URL_PATTERN =
  /\bwww\.[a-zA-Z0-9][a-zA-Z0-9\-.]*\.[a-zA-Z]{2,}(?:\/[^\s()>\]'"\\]*)?(?<![.,;:!?])/g
// Bare domain URLs like google.com or sub.example.io — TLD allowlist avoids false positives
// on source file extensions (.js, .ts, .tsx, .py, etc.)
const NAKED_URL_PATTERN =
  /\b(?!www\.)(?:[a-zA-Z0-9][a-zA-Z0-9-]*\.)+(?:com|net|org|io|dev|app|ai|sh|co|uk|me|tv|info|edu|gov|mil|eu|us|de|fr|jp|cn|au|in|nl|br|ru|it|es|ca|mx|ar|nz|za|sg|hk|kr|se|no|dk|fi|pl|at|ch|pt|gr|tr|be|xyz|tech|cloud|id|cc|biz|pro|media|live|link|site|run|codes|page|studio|zone|digital|pub)(?:\/[^\s()>\]'"\\]*)?(?<![.,;:!?])/g
const PATH_PATTERN = /(?<!\S)((?:~\/|\/(?!\/))[^\s:)>\]'"\\]+(?::\d+(?::\d+)?)?(?<![.,;!?]))/g
// Matches paths inside " or ' to support spaces: File "/Users/Jane Doe/foo.py", line 5
const QUOTED_PATH_PATTERN = /(?:"((?:~\/|\/(?!\/))[^"]+)"|'((?:~\/|\/(?!\/))[^']+)')/g

/** What ⌘-click (Ctrl-click off macOS) on a link opens. */
export type LinkTarget = { url: string } | { path: string }

/** A link on a row: its first column, its length and what it opens. */
export interface TerminalLink {
  index: number
  length: number
  text: string
  target: LinkTarget
}

interface LinkKind {
  pattern: RegExp
  target(text: string): LinkTarget
}

const withoutPosition = (path: string): string => path.replace(/:\d+(?::\d+)?$/, '')

/** In the order a click tries them: a full URL wins over the domain inside it. */
const LINK_KINDS: LinkKind[] = [
  { pattern: URL_PATTERN, target: (text) => ({ url: text }) },
  { pattern: BARE_URL_PATTERN, target: (text) => ({ url: `https://${text}` }) },
  { pattern: NAKED_URL_PATTERN, target: (text) => ({ url: `https://${text}` }) },
  { pattern: PATH_PATTERN, target: (text) => ({ path: withoutPosition(text) }) },
  { pattern: QUOTED_PATH_PATTERN, target: (text) => ({ path: withoutPosition(text) }) },
]

/** Every link of one kind on a row. A quoted path's link is the path inside its quotes. */
function linksOfKind(text: string, kind: LinkKind): TerminalLink[] {
  return [...text.matchAll(kind.pattern)].map((match) => {
    const linkText = match[1] ?? match[2] ?? match[0]
    const index = match.index + match[0].indexOf(linkText)
    return { index, length: linkText.length, text: linkText, target: kind.target(linkText) }
  })
}

/** The link under column `col` of a row, or null when the column is plain text. */
export function linkAt(text: string, col: number): TerminalLink | null {
  for (const kind of LINK_KINDS) {
    const hit = linksOfKind(text, kind).find(
      (link) => col >= link.index && col < link.index + link.length
    )
    if (hit) return hit
  }
  return null
}

/**
 * Declares one kind of link to xterm, for accessibility tooling only. The
 * underline and the click are the terminal's own, gated on ⌘ (Ctrl off macOS).
 */
function linkProvider(terminal: Terminal, kind: LinkKind): ILinkProvider {
  return {
    provideLinks: (bufferLineIndex, callback) => {
      const line = terminal.buffer.active.getLine(bufferLineIndex)
      const found = line ? linksOfKind(line.translateToString(true), kind) : []
      const links: ILink[] = found.map((link) => ({
        range: {
          start: { x: link.index + 1, y: bufferLineIndex + 1 },
          end: { x: link.index + link.length, y: bufferLineIndex + 1 },
        },
        text: link.text,
        activate: () => {},
      }))
      callback(links.length ? links : undefined)
    },
  }
}

/** Registers a provider for each kind of link: URL, www., bare domain, path, quoted path. */
export function registerLinkProviders(terminal: Terminal): void {
  for (const kind of LINK_KINDS) terminal.registerLinkProvider(linkProvider(terminal, kind))
}
