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

  it('reports a command built inside another', () => {
    expect(readShell('echo $(rm -rf x)').substitutes).toBe(true)
    expect(readShell('echo `date`').substitutes).toBe(true)
    // Double quotes expand, so this one counts.
    expect(readShell('echo "today is $(date)"').substitutes).toBe(true)
  })

  it('does not, inside single quotes, where a shell expands nothing', () => {
    expect(readShell("echo '$(rm -rf x)'").substitutes).toBe(false)
    expect(readShell("grep '`x`' .").substitutes).toBe(false)
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
