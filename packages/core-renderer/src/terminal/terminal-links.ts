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
type LinkTarget = { url: string } | { path: string }

/** A link on a row: its first column, its length and what it opens. */
interface TerminalLink {
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

/** ⌘ on macOS, where Ctrl-click is a secondary click; Ctrl elsewhere. */
function modifierHeld(event: MouseEvent | KeyboardEvent): boolean {
  return navigator.platform.startsWith('Mac') ? event.metaKey : event.ctrlKey
}

function openTarget(target: LinkTarget): void {
  if ('url' in target) window.electronAPI.shell.openExternal(target.url).catch(() => {})
  else window.electronAPI.shell.openPath(target.path).catch(() => {})
}

/** What the pointer is over and whether ⌘ (Ctrl off macOS) is held. xterm underlines a hovered
 * link on its own; the link's decorations stay off until the modifier is down. */
class HoverState {
  held = false
  private hovered: ILink | null = null

  hover(link: ILink): void {
    this.hovered = link
  }

  unhover(): void {
    this.hovered = null
  }

  setHeld(held: boolean): void {
    this.held = held
    if (!this.hovered?.decorations) return
    this.hovered.decorations.underline = held
    this.hovered.decorations.pointerCursor = held
  }
}

function linkProvider(terminal: Terminal, kind: LinkKind, state: HoverState): ILinkProvider {
  return {
    // xterm counts buffer lines from 1.
    provideLinks: (bufferLineNumber, callback) => {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1)
      const found = line ? linksOfKind(line.translateToString(true), kind) : []
      const links: ILink[] = found.map((link) => {
        const provided: ILink = {
          range: {
            start: { x: link.index + 1, y: bufferLineNumber },
            end: { x: link.index + link.length, y: bufferLineNumber },
          },
          text: link.text,
          decorations: { underline: state.held, pointerCursor: state.held },
          activate: (event) => modifierHeld(event) && openTarget(link.target),
          hover: () => state.hover(provided),
          leave: () => state.unhover(),
        }
        return provided
      })
      callback(links.length ? links : undefined)
    },
  }
}

/** Registers a provider for each kind of link: URL, www., bare domain, path, quoted path, and
 * hears the modifier on `host`, the terminal's element, which moves with it to a breakout window.
 * Returns what removes the providers and the listeners. */
export function registerLinkProviders(terminal: Terminal, host: HTMLElement): () => void {
  const state = new HoverState()
  const providers = LINK_KINDS.map((kind) =>
    terminal.registerLinkProvider(linkProvider(terminal, kind, state))
  )
  const trackModifier = (event: KeyboardEvent | MouseEvent): void =>
    state.setHeld(modifierHeld(event))
  const events = ['keydown', 'keyup', 'mousemove'] as const
  for (const type of events) host.addEventListener(type, trackModifier)
  return () => {
    for (const type of events) host.removeEventListener(type, trackModifier)
    for (const provider of providers) provider.dispose()
  }
}
