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
//
// A heredoc body is tracked for that same reason and no other: it is quoting.
// The body is data on its way to a command's stdin, and reading it as shell is
// what made the builder's most common operation — writing a test file — a
// five-minute hold. Watched on a live run: `cat > red-text-palette.spec.ts
// <<'TESTEOF'` whose body was a spec file with a JSDoc comment quoting
// identifiers in backticks. A hundred and six of them, an odd one somewhere,
// no partner, reported unreadable — and `isDestructive` reads unreadable as
// destruction. A `cat` into the unit's own worktree was sent to an operator.

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

type Quote = "'" | '"'

/** A heredoc waiting for the line it is attached to, so its body can be skipped. */
interface PendingHeredoc {
  readonly delimiter: string
  /** `<<-` strips leading tabs from the body, terminator included. */
  readonly stripTabs: boolean
}

/** A word read out of the command, and the index just past where it stopped. */
interface ReadWord {
  readonly word: string
  readonly end: number
}

/**
 * Read the `<<` operator and the word that ends its body.
 *
 * Returns where the operator's text ends, so the caller can keep it in the
 * segment — the words around it are still the command, and only the body is
 * data. `<<<` is a here-string, whose word is an ordinary argument, so it is
 * not one of these and is left to the loop.
 */
function readHeredocOperator(
  command: string,
  at: number
): { heredoc: PendingHeredoc; end: number } | null {
  if (command[at] !== '<' || command[at + 1] !== '<' || command[at + 2] === '<') return null
  let i = at + 2
  const stripTabs = command[i] === '-'
  if (stripTabs) i += 1
  i = pastBlanks(command, i)

  const read = isQuote(command[i]) ? quotedDelimiter(command, i) : bareDelimiter(command, i)
  if (read === null || read.word === '') return null
  return { heredoc: { delimiter: read.word, stripTabs }, end: read.end }
}

/** Past any spaces and tabs from `at`. */
function pastBlanks(command: string, at: number): number {
  let i = at
  while (i < command.length && (command[i] === ' ' || command[i] === '\t')) i += 1
  return i
}

function isQuote(char: string | undefined): boolean {
  return char === "'" || char === '"'
}

/** A delimiter in quotes, as in `<<'EOF'`, read past its closing quote. */
function quotedDelimiter(command: string, at: number): ReadWord | null {
  const quote = command[at]
  let i = at + 1
  let word = ''
  while (i < command.length && command[i] !== quote) {
    word += command[i]
    i += 1
  }
  // An opening quote with no partner is not a delimiter this can trust.
  if (i >= command.length) return null
  return { word, end: i + 1 }
}

/** A delimiter without quotes, as in `<<EOF`, read up to the shell's next punctuation. */
function bareDelimiter(command: string, at: number): ReadWord {
  let i = at
  let word = ''
  while (i < command.length && !/[\s;|&<>()]/.test(command[i])) {
    // A backslash escapes the next character of the word, as in `<<E\ OF`.
    if (command[i] === '\\' && i + 1 < command.length) {
      word += command[i + 1]
      i += 2
      continue
    }
    word += command[i]
    i += 1
  }
  return { word, end: i }
}

/**
 * Skip the bodies of every heredoc attached to the line that just ended.
 *
 * Bash allows more than one on a line — `cat <<A <<B` — and reads their bodies
 * in the order the operators appeared. Returns where the last terminator's
 * line ends, or null when one never arrives, which is genuinely unreadable.
 */
function skipHeredocBodies(
  command: string,
  from: number,
  pending: readonly PendingHeredoc[]
): number | null {
  let i: number | null = from
  for (const heredoc of pending) {
    i = skipHeredocBody(command, i, heredoc)
    if (i === null) return null
  }
  return i
}

/** Past one heredoc's body and its terminator's line, or null when the terminator never comes. */
function skipHeredocBody(
  command: string,
  from: number,
  { delimiter, stripTabs }: PendingHeredoc
): number | null {
  let i = from
  for (;;) {
    if (i >= command.length) return null
    let lineEnd = command.indexOf('\n', i)
    if (lineEnd === -1) lineEnd = command.length
    const raw = command.slice(i, lineEnd).replace(/\r$/, '')
    const line = stripTabs ? raw.replace(/^\t+/, '') : raw
    i = lineEnd < command.length ? lineEnd + 1 : command.length
    // Bash wants the terminator alone on its line; trailing blanks are the
    // one thing an agent adds by accident, and refusing over one is a hold.
    if (line.trimEnd() === delimiter) return i
  }
}

/** Where one character leaves the quoting, as both scanners here read it. */
interface Quoting {
  readonly quote: Quote | null
  /** Characters to skip past this one: the one a backslash escapes. */
  readonly skip: number
  /** Outside quotes and unescaped: this character is the shell's punctuation. */
  readonly bare: boolean
}

/**
 * The quoting after the character at `at`.
 *
 * A backslash outside single quotes escapes whatever follows, including a
 * quote; inside quotes only the matching quote means anything.
 */
function quotingAt(command: string, at: number, quote: Quote | null): Quoting {
  const char = command[at]
  if (char === '\\' && quote !== "'") return { quote, skip: 1, bare: false }
  if (quote !== null) return { quote: char === quote ? null : quote, skip: 0, bare: false }
  if (char === "'" || char === '"') return { quote: char, skip: 0, bare: false }
  return { quote: null, skip: 0, bare: true }
}

/** Whether a command substitution, `` ` `` or `$(`, opens at `at`. */
function opensSubstitution(command: string, at: number): boolean {
  return command[at] === '`' || (command[at] === '$' && command[at + 1] === '(')
}

/**
 * The text inside a substitution that opens at `from`, and where it ends.
 *
 * Nesting counts, so `$(dirname $(pwd))` is read whole rather than stopping
 * at the first `)`. An unbalanced one returns null and is reported as
 * unreadable rather than guessed at.
 */
function substitution(command: string, from: number): { inner: string; end: number } | null {
  return command[from] === '`'
    ? backtickSubstitution(command, from)
    : parenSubstitution(command, from)
}

function backtickSubstitution(
  command: string,
  from: number
): { inner: string; end: number } | null {
  for (let j = from + 1; j < command.length; j += 1) {
    if (command[j] === '\\') {
      j += 1
      continue
    }
    if (command[j] === '`') return { inner: command.slice(from + 1, j), end: j }
  }
  return null
}

function parenSubstitution(command: string, from: number): { inner: string; end: number } | null {
  // Past the `$(` itself, so the opening parenthesis is not counted as one
  // more level of nesting than there is.
  //
  // Quoting counts here for the same reason it counts in the main loop: a
  // parenthesis inside an argument belongs to the argument. Counting them
  // raw meant `$(grep -c "var(--x" a.css)` opened a level that nothing
  // closed, so the scan ran off the end and the whole shape was reported
  // unreadable — which `isDestructive` reads as destruction. Measured on a
  // live run: a read-only `grep` inventory was held for 276 seconds.
  let depth = 0
  let quote: Quote | null = null
  for (let j = from + 2; j < command.length; j += 1) {
    const read = quotingAt(command, j, quote)
    quote = read.quote
    j += read.skip
    if (!read.bare) continue
    if (command[j] === '(') depth += 1
    else if (command[j] === ')') {
      if (depth === 0) return { inner: command.slice(from + 2, j), end: j }
      depth -= 1
    }
  }
  return null
}

export function readShell(command: string): ShellReading {
  return new ShellReader(command).read()
}

/**
 * One pass over a command, a character at a time.
 *
 * Each character is offered to the readers in `step` in turn, and the first
 * that takes it decides what it was; one none of them takes is part of the
 * current command's text.
 */
class ShellReader {
  private readonly segments: string[] = []
  private readonly nested: string[] = []
  private current = ''
  private redirects = false
  private unreadable = false
  private quote: Quote | null = null
  // Heredocs read on this line, whose bodies begin after it ends.
  private pending: PendingHeredoc[] = []
  private i = 0
  /** A heredoc body never ended: nothing after it can be read. */
  private stopped = false

  private readonly command: string

  constructor(command: string) {
    this.command = command
  }

  read(): ShellReading {
    for (this.i = 0; this.i < this.command.length && !this.stopped; this.i += 1) {
      this.step(this.command[this.i])
    }
    this.segments.push(this.current)
    return {
      // The commands inside substitutions stand alongside the ones that contain
      // them: each is a command the shell will really run.
      segments: [...this.segments, ...this.nested]
        .map((segment) => segment.trim())
        .filter((segment) => segment !== ''),
      redirects: this.redirects,
      unreadable: this.unreadable,
    }
  }

  private step(char: string): void {
    if (this.escape(char)) return
    if (this.quote !== null) {
      this.inQuote(char)
      return
    }
    if (
      this.openQuote(char) ||
      this.substitute(char) ||
      this.heredoc(char) ||
      this.redirect(char) ||
      this.join(char)
    ) {
      return
    }
    this.current += char
  }

  /**
   * A backslash outside single quotes escapes whatever follows, including a
   * quote — so it has to be consumed here or the quote state goes wrong for
   * the rest of the command.
   */
  private escape(char: string): boolean {
    if (char !== '\\' || this.quote === "'") return false
    this.current += char + (this.command[this.i + 1] ?? '')
    this.i += 1
    return true
  }

  private inQuote(char: string): void {
    // Double quotes expand, so a substitution inside them is a real command.
    // Single quotes expand nothing, so what is in them is only ever text.
    if (this.quote === '"' && opensSubstitution(this.command, this.i) && this.takeSubstitution()) {
      return
    }
    if (char === this.quote) this.quote = null
    this.current += char
  }

  private openQuote(char: string): boolean {
    if (char !== "'" && char !== '"') return false
    this.quote = char
    this.current += char
    return true
  }

  private substitute(char: string): boolean {
    if (!opensSubstitution(this.command, this.i)) return false
    if (!this.takeSubstitution()) this.current += char
    return true
  }

  /** The substitution opening here, kept whole in the segment; false when it never closes. */
  private takeSubstitution(): boolean {
    const end = this.readInside(this.i)
    if (end === null) return false
    this.current += this.command.slice(this.i, end + 1)
    this.i = end
    return true
  }

  /** Read what a substitution contains, and judge it like anything else. */
  private readInside(at: number): number | null {
    const found = substitution(this.command, at)
    if (found === null) {
      this.unreadable = true
      return null
    }
    const inside = readShell(found.inner)
    this.nested.push(...inside.segments)
    if (inside.redirects) this.redirects = true
    if (inside.unreadable) this.unreadable = true
    return found.end
  }

  /**
   * `<<WORD` names the end of a body rather than a file. The operator and
   * its delimiter stay in the segment — the words around them are still the
   * command — and the body is skipped when this line ends.
   *
   * `command[i - 1]` as well as `command[i + 2]`: the loop walks `<<<` one
   * character at a time, so its middle `<` also has a `<` after it and a
   * non-`<` after that. Without this, `grep x <<< "$(…)"` read its
   * here-string as a heredoc delimiter and lost the substitution inside it.
   */
  private heredoc(char: string): boolean {
    const { command, i } = this
    if (
      char !== '<' ||
      command[i + 1] !== '<' ||
      command[i + 2] === '<' ||
      command[i - 1] === '<'
    ) {
      return false
    }
    const read = readHeredocOperator(command, i)
    if (read === null) return false
    this.redirects = true
    this.pending.push(read.heredoc)
    this.current += command.slice(i, read.end)
    this.i = read.end - 1
    return true
  }

  /**
   * A file descriptor immediately before a redirect (`2>`) belongs to it, and
   * `&>` is one operator rather than a joiner followed by a redirect.
   */
  private redirect(char: string): boolean {
    if (char === '>' || char === '<') {
      this.redirects = true
      this.current += char
      // `2>&1` duplicates a file descriptor. The `&` belongs to the operator,
      // and reading it as a joiner split the most ordinary command an agent
      // writes into three.
      if (this.command[this.i + 1] === '&') {
        this.current += '&'
        this.i += 1
      }
      return true
    }
    if (char !== '&' || this.command[this.i + 1] !== '>') return false
    this.redirects = true
    this.current += char
    return true
  }

  private join(char: string): boolean {
    if (!JOINER.has(char)) return false
    this.segments.push(this.current)
    this.current = ''
    // The line is over, so the bodies attached to it begin here. Skipping
    // them is the whole point: they are data, and every character in them
    // would otherwise be read as shell punctuation.
    if (this.pending.length > 0 && (char === '\n' || char === '\r')) this.skipBodies(char)
    return true
  }

  private skipBodies(lineEnd: string): void {
    const { command, i } = this
    const after = skipHeredocBodies(
      command,
      lineEnd === '\r' && command[i + 1] === '\n' ? i + 2 : i + 1,
      this.pending
    )
    this.pending = []
    if (after === null) {
      // A body whose terminator never arrives. Nothing after it can be
      // read, and guessing is what this module exists not to do.
      this.unreadable = true
      this.stopped = true
      return
    }
    this.i = after - 1
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
  let quote: Quote | null = null

  for (let i = 0; i < command.length; i += 1) {
    const read = quotingAt(command, i, quote)
    quote = read.quote
    i += read.skip
    if (!read.bare || (command[i] !== '>' && command[i] !== '<')) continue
    const target = redirectTargetAt(command, i)
    if (target === null) break
    if (target.word !== '') targets.push(target.word)
    i = target.end
  }

  return targets
}

/**
 * The word the redirect operator at `at` writes to, and where reading carries
 * on; an empty word for a file descriptor, and null when the command ends
 * before any word.
 */
function redirectTargetAt(command: string, at: number): ReadWord | null {
  // Past the operator, then one word — quoted or not.
  let j = at + 1
  while (command[j] === '>') j += 1
  // `2>&1` names a file descriptor, not a file. Nothing is written that a
  // path check has anything to say about.
  if (command[j] === '&') return { word: '', end: j }
  while (j < command.length && /\s/.test(command[j])) j += 1
  if (j >= command.length) return null
  return command[j] === "'" || command[j] === '"'
    ? quotedTarget(command, j)
    : bareTarget(command, j)
}

/** A quoted target, up to its closing quote (or the end, when there is none). */
function quotedTarget(command: string, at: number): ReadWord {
  const opened = command[at]
  let j = at + 1
  let word = ''
  while (j < command.length && command[j] !== opened) {
    word += command[j]
    j += 1
  }
  return { word, end: j }
}

/** An unquoted target, up to the shell's next punctuation. */
function bareTarget(command: string, at: number): ReadWord {
  let j = at
  let word = ''
  while (j < command.length && !/[\s;|&<>]/.test(command[j])) {
    word += command[j]
    j += 1
  }
  return { word, end: j }
}
