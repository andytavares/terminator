// Reading a shell command well enough to judge it, and no further.
//
// Both policies that gate an agent's tool calls need the same three answers:
// where one command ends and the next begins, whether anything is redirected,
// and whether a command is being built inside another. Both used to get them
// from regular expressions over the raw text, which cannot see quoting — and a
// quoted string is where an agent's most ordinary command puts its punctuation.
//
// Watched on a live run, a verifier enumerating consumers of a value:
//
//   grep -rn -E "TTL|15 \* 60|900000|process\.env|isExpired" .
//
// The `|` characters inside the pattern were read as pipes, the command was
// split into four, and the review was refused with "15 is not on the review's
// read-only list" — a fragment of a regex reported as a binary. It tried three
// more spellings and gave up.
//
// This is not a shell parser and must not grow into one. It tracks quoting and
// escaping, which is exactly what is needed to stop reading punctuation that
// belongs to an argument as punctuation that belongs to the shell.

export interface ShellReading {
  /** Each command, with the operators that joined them removed. */
  readonly segments: readonly string[]
  /** A redirection outside quotes: this writes a file, whatever is to its left. */
  readonly redirects: boolean
  /**
   * A substitution this could not read to the end — an unbalanced `$(` or a
   * backtick with no partner.
   *
   * A substitution it *can* read is not reported here at all: its contents are
   * returned as segments like any other command, because they are right there
   * in the text. `$(pwd)` is `pwd`, and `$(rm -rf /)` is `rm -rf /`, and the
   * caller's own rules decide each on its merits.
   *
   * Refusing the whole shape instead is what a live run cost: a builder's
   * second command was `cd "$(pwd)" && cat -n src/session.js`, which was
   * called destruction and sent to an operator who was not there. It sat for
   * eighteen minutes and the run died on its budget.
   */
  readonly unreadable: boolean
}

/** The operators that end one command and begin another. */
const JOINER = new Set([';', '|', '&', '\n', '\r'])

export function readShell(command: string): ShellReading {
  const segments: string[] = []
  const nested: string[] = []
  let current = ''
  let redirects = false
  let unreadable = false
  let quote: "'" | '"' | null = null

  /**
   * The text inside a substitution that opens at `from`, and where it ends.
   *
   * Nesting counts, so `$(dirname $(pwd))` is read whole rather than stopping
   * at the first `)`. An unbalanced one returns null and is reported as
   * unreadable rather than guessed at.
   */
  const substitution = (from: number): { inner: string; end: number } | null => {
    const backtick = command[from] === '`'
    if (backtick) {
      for (let j = from + 1; j < command.length; j += 1) {
        if (command[j] === '\\') {
          j += 1
          continue
        }
        if (command[j] === '`') return { inner: command.slice(from + 1, j), end: j }
      }
      return null
    }
    // Past the `$(` itself, so the opening parenthesis is not counted as one
    // more level of nesting than there is.
    let depth = 0
    for (let j = from + 2; j < command.length; j += 1) {
      if (command[j] === '\\') {
        j += 1
        continue
      }
      if (command[j] === '(') depth += 1
      else if (command[j] === ')') {
        if (depth === 0) return { inner: command.slice(from + 2, j), end: j }
        depth -= 1
      }
    }
    return null
  }

  /** Read what a substitution contains, and judge it like anything else. */
  const readInside = (at: number): number | null => {
    const found = substitution(at)
    if (found === null) {
      unreadable = true
      return null
    }
    const inside = readShell(found.inner)
    nested.push(...inside.segments)
    if (inside.redirects) redirects = true
    if (inside.unreadable) unreadable = true
    return found.end
  }

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]

    // A backslash outside single quotes escapes whatever follows, including a
    // quote — so it has to be consumed here or the quote state goes wrong for
    // the rest of the command.
    if (char === '\\' && quote !== "'") {
      current += char + (command[i + 1] ?? '')
      i += 1
      continue
    }

    if (quote !== null) {
      // Double quotes expand, so a substitution inside them is a real command.
      // Single quotes expand nothing, so what is in them is only ever text.
      if (quote === '"' && (char === '`' || (char === '$' && command[i + 1] === '('))) {
        const end = readInside(i)
        if (end !== null) {
          current += command.slice(i, end + 1)
          i = end
          continue
        }
      }
      if (char === quote) quote = null
      current += char
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }

    if (char === '`' || (char === '$' && command[i + 1] === '(')) {
      const end = readInside(i)
      if (end !== null) {
        current += command.slice(i, end + 1)
        i = end
        continue
      }
      current += char
      continue
    }

    // A file descriptor immediately before a redirect (`2>`) belongs to it, and
    // `&>` is one operator rather than a joiner followed by a redirect.
    if (char === '>' || char === '<') {
      redirects = true
      current += char
      // `2>&1` duplicates a file descriptor. The `&` belongs to the operator,
      // and reading it as a joiner split the most ordinary command an agent
      // writes into three.
      if (command[i + 1] === '&') {
        current += '&'
        i += 1
      }
      continue
    }
    if (char === '&' && command[i + 1] === '>') {
      redirects = true
      current += char
      continue
    }

    if (JOINER.has(char)) {
      segments.push(current)
      current = ''
      continue
    }

    current += char
  }

  segments.push(current)
  return {
    // The commands inside substitutions stand alongside the ones that contain
    // them: each is a command the shell will really run.
    segments: [...segments, ...nested]
      .map((segment) => segment.trim())
      .filter((segment) => segment !== ''),
    redirects,
    unreadable,
  }
}

/**
 * Where a command redirects to, as written.
 *
 * Only outside quotes, and only the target — the words in front of it are the
 * command, which is judged separately.
 */
export function redirectTargets(command: string): string[] {
  const targets: string[] = []
  let quote: "'" | '"' | null = null

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]
    if (char === '\\' && quote !== "'") {
      i += 1
      continue
    }
    if (quote !== null) {
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char !== '>' && char !== '<') continue

    // Past the operator, then one word — quoted or not.
    let j = i + 1
    while (command[j] === '>') j += 1
    // `2>&1` names a file descriptor, not a file. Nothing is written that a
    // path check has anything to say about.
    if (command[j] === '&') {
      i = j
      continue
    }
    while (j < command.length && /\s/.test(command[j])) j += 1
    if (j >= command.length) break

    let word = ''
    const opened = command[j] === "'" || command[j] === '"' ? command[j] : null
    if (opened !== null) {
      j += 1
      while (j < command.length && command[j] !== opened) {
        word += command[j]
        j += 1
      }
    } else {
      while (j < command.length && !/[\s;|&<>]/.test(command[j])) {
        word += command[j]
        j += 1
      }
    }
    if (word !== '') targets.push(word)
    i = j
  }

  return targets
}
