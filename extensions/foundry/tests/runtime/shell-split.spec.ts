import { describe, it, expect } from 'vitest'
import { readShell, redirectTargets } from '../../src/runtime/shell-split.js'

// Both policies that gate an agent's tool calls used to read shell text with
// regular expressions, which cannot see quoting — and a quoted string is where
// an agent's most ordinary command puts its punctuation. Watched on a live run,
// a verifier enumerating consumers of a value was refused with "15 is not on
// the review's read-only list": a fragment of its own regex, reported as a
// binary. It tried three more spellings and gave up.

describe('readShell', () => {
  it('leaves punctuation inside double quotes alone', () => {
    const command = 'grep -rn -E "TTL|15 \\* 60|900000|process\\.env" .'
    expect(readShell(command).segments).toEqual([command])
  })

  it('leaves punctuation inside single quotes alone', () => {
    expect(readShell("grep 'a|b;c' .").segments).toEqual(["grep 'a|b;c' ."])
  })

  it('splits on the operators that really do join commands', () => {
    expect(readShell('pwd && git status').segments).toEqual(['pwd', 'git status'])
    expect(readShell('ls; cat x').segments).toEqual(['ls', 'cat x'])
    expect(readShell('find . | head -5').segments).toEqual(['find .', 'head -5'])
    expect(readShell('a\nb').segments).toEqual(['a', 'b'])
  })

  it('keeps a file-descriptor redirect with the command it belongs to', () => {
    // `2>&1` is one operator. Reading its `&` as a joiner split the most
    // ordinary command an agent writes into three, the middle one being "1".
    expect(readShell('npm test 2>&1 | tail -20').segments).toEqual(['npm test 2>&1', 'tail -20'])
  })

  it('reports a redirection, which writes whatever is to its left', () => {
    expect(readShell('echo hi > out.txt').redirects).toBe(true)
    expect(readShell('ls 2>/dev/null').redirects).toBe(true)
    expect(readShell('cat x').redirects).toBe(false)
  })

  it('does not call a quoted angle bracket a redirection', () => {
    expect(readShell('grep "a>b" .').redirects).toBe(false)
    expect(readShell("echo 'x < y'").redirects).toBe(false)
  })

  // A substitution's contents are right there in the text, so they are read
  // and returned as commands rather than refused as a shape. Refusing the
  // shape cost a live run: the builder's second command was
  // `cd "$(pwd)" && cat -n src/session.js`, which was called destruction and
  // sent to an operator who was not there. It sat for eighteen minutes and
  // the run died on its budget.
  it('reads what a substitution contains, as a command of its own', () => {
    expect(readShell('echo $(rm -rf x)').segments).toEqual(['echo $(rm -rf x)', 'rm -rf x'])
    expect(readShell('echo `date`').segments).toEqual(['echo `date`', 'date'])
  })

  it('reads one inside double quotes, which do expand', () => {
    expect(readShell('cd "$(pwd)"').segments).toEqual(['cd "$(pwd)"', 'pwd'])
  })

  it('reads a nested one all the way down', () => {
    expect(readShell('cat "$(dirname $(pwd))/x"').segments).toEqual([
      'cat "$(dirname $(pwd))/x"',
      'dirname $(pwd)',
      'pwd',
    ])
  })

  it('leaves one inside single quotes as text, because a shell expands nothing there', () => {
    expect(readShell("echo '$(rm -rf x)'").segments).toEqual(["echo '$(rm -rf x)'"])
    expect(readShell("grep '`x`' .").segments).toEqual(["grep '`x`' ."])
  })

  it('says so when it cannot read one to the end, rather than guessing', () => {
    expect(readShell('echo $(').unreadable).toBe(true)
    expect(readShell('echo `x').unreadable).toBe(true)
    expect(readShell('echo $(pwd)').unreadable).toBe(false)
  })

  it('reads an escaped quote without losing track of the quoting', () => {
    // The backslash has to be consumed here, or the quote state is wrong for
    // everything after it and the whole command is misread.
    expect(readShell('echo \\"a; b').segments).toEqual(['echo \\"a', 'b'])
  })

  it('has no empty segments, whatever the spacing', () => {
    expect(readShell('  ;  ls  ;  ').segments).toEqual(['ls'])
    expect(readShell('').segments).toEqual([])
  })
})

describe('redirectTargets', () => {
  it('names the file a command writes', () => {
    expect(redirectTargets('echo hi > out.txt')).toEqual(['out.txt'])
    expect(redirectTargets('npm test >> /tmp/log')).toEqual(['/tmp/log'])
    expect(redirectTargets('a &> both.txt')).toEqual(['both.txt'])
  })

  it('names a quoted one', () => {
    expect(redirectTargets('echo hi > "my notes.txt"')).toEqual(['my notes.txt'])
  })

  it('says nothing about a descriptor duplication, which writes no file', () => {
    expect(redirectTargets('npm test 2>&1')).toEqual([])
  })

  it('finds the file even when a descriptor duplication follows it', () => {
    expect(redirectTargets('npm test > /tmp/o.log 2>&1')).toEqual(['/tmp/o.log'])
  })

  it('says nothing about an angle bracket inside quotes', () => {
    expect(redirectTargets('grep "a>b" .')).toEqual([])
    expect(redirectTargets("echo 'a > b'")).toEqual([])
  })

  it('says nothing about a command that redirects nowhere', () => {
    expect(redirectTargets('npm test')).toEqual([])
  })
})

// Measured on WO-0910-1fb. A builder inventorying CSS custom properties wrote:
//
//   for t in tv-color-danger tv-status-open; do
//     echo "$t: total=$(grep -c "var(--$t" a.css)"
//   done
//
// `substitution` counted parentheses without tracking quotes, so the `(` in
// the quoted pattern `"var(--$t"` opened a level nothing closed. The scan ran
// off the end, the shape was reported unreadable, `isDestructive` called a
// read-only grep destruction, and the call was held for 276 seconds before
// handing back to a terminal nobody was sitting at.
describe('a parenthesis inside a quoted argument', () => {
  it('does not open a level of nesting the substitution has to close', () => {
    const reading = readShell('echo "total=$(grep -c "var(--x" a.css)"')
    expect(reading.unreadable).toBe(false)
    expect(reading.segments).toContain('grep -c "var(--x" a.css')
  })

  it('is read the same way in single quotes, which expand nothing', () => {
    expect(readShell("echo $(grep -c 'var(--x' a.css)").unreadable).toBe(false)
  })

  it('still reports a substitution that genuinely never closes', () => {
    expect(readShell('echo $(grep -c x a.css').unreadable).toBe(true)
    expect(readShell('echo `grep -c x a.css').unreadable).toBe(true)
  })

  it('reads the real loop from the run that found this', () => {
    const reading = readShell(
      'for t in tv-color-danger tv-status-open; do\n' +
        '  echo "$t: total=$(grep -c "var(--$t" a.css)"\n' +
        'done'
    )
    expect(reading.unreadable).toBe(false)
  })
})

// A heredoc body is data the shell hands to a command's stdin. It is not
// shell, and reading it as shell is how the builder's single most common
// operation — writing a test file — became a five-minute hold.
//
// Measured on WO-0910-1fb: `cat > tests/…/red-text-palette.spec.ts <<'TESTEOF'`
// whose body was a spec file with a JSDoc comment in it. The comment quoted
// two identifiers in backticks, `readShell` read the first as opening a
// command substitution, found no partner, reported the shape unreadable — and
// `isDestructive` reads unreadable as destruction. A `cat` into the unit's own
// worktree was sent to an operator.
//
// Quoting is exactly what this module exists to track. A heredoc is quoting.
describe('a heredoc body, which is data and not shell', () => {
  const spec = [
    "cat > tests/unit/a.spec.ts <<'TESTEOF'",
    '/**',
    ' * Text colour is decided in `styles.css` and in `EXTENSION_BASE_CSS`.',
    ' */',
    "import { describe } from 'vitest'",
    'TESTEOF',
  ].join('\n')

  it('is not read as an unterminated substitution', () => {
    expect(readShell(spec).unreadable).toBe(false)
  })

  it('does not offer its lines up as commands to judge', () => {
    expect(readShell(spec).segments).not.toContain("import { describe } from 'vitest'")
  })

  it('reads the command that follows the terminator', () => {
    const reading = readShell(`${spec}\nnpx vitest run tests/unit/a.spec.ts`)
    expect(reading.unreadable).toBe(false)
    expect(reading.segments).toContain('npx vitest run tests/unit/a.spec.ts')
  })

  it('still judges a destructive command after the body', () => {
    const reading = readShell(`${spec}\nrm -f tests/unit/a.spec.ts`)
    expect(reading.segments).toContain('rm -f tests/unit/a.spec.ts')
  })

  it('handles the tab-stripping and unquoted spellings too', () => {
    expect(readShell('cat > a <<-EOF\n\tone `two\nEOF\necho done').unreadable).toBe(false)
    expect(readShell('cat > a <<EOF\nplain `text\nEOF\necho done').unreadable).toBe(false)
    expect(readShell('cat > a <<"EOF"\nx `y\nEOF\necho done').unreadable).toBe(false)
  })

  it('leaves `<<<` alone, which is a here-string and not a heredoc', () => {
    const reading = readShell('grep x <<< "$(cat a.txt)"')
    expect(reading.unreadable).toBe(false)
    expect(reading.segments).toContain('cat a.txt')
  })

  it('reports a heredoc whose terminator never arrives', () => {
    expect(readShell("cat > a <<'EOF'\nunterminated body").unreadable).toBe(true)
  })
})
