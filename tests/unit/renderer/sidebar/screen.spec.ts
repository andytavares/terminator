import { describe, it, expect } from 'vitest'
import { latestLineOf } from '../../../../src/renderer/sidebar/screen'

describe('latestLineOf', () => {
  it('is the last row with anything on it, trimmed', () => {
    expect(latestLineOf(['$ ls', '  a.txt  b.txt  ', '', '   '])).toBe('a.txt  b.txt')
  })

  it('reads above the cursor, so a shell prompt is not the summary', () => {
    expect(latestLineOf(['$ pnpm test', '14 passed, 2 failed', 'me@host ~/api $ ', ''], 2)).toBe(
      '14 passed, 2 failed'
    )
  })

  it('falls back to the last row when nothing is above the cursor', () => {
    expect(latestLineOf(['me@host ~ $ ', '', ''], 0)).toBe('me@host ~ $')
  })

  it("skips Claude Code's input box borders, which are box-drawing rules, not output", () => {
    const rule = '─'.repeat(80)
    const rows = [
      '⏺ Updated the ledger to read the real screen.',
      '',
      rule,
      '> ',
      rule,
      '  ? for shortcuts',
    ]
    expect(latestLineOf(rows, 3)).toBe('⏺ Updated the ledger to read the real screen.')
  })

  it('skips a rounded input box border too', () => {
    const rows = ['⏺ Done.', '╭' + '─'.repeat(40) + '╮', '│ > │', '╰' + '─'.repeat(40) + '╯']
    expect(latestLineOf(rows, 2)).toBe('⏺ Done.')
  })
})

describe("latestLineOf — Claude Code's status line", () => {
  const rule = '─'.repeat(80)
  const statusLine = '● full $47.32 last $0.62 1h 9m 38% reuse 6 duplicate? ✓ 20 tests'

  it('ignores a status line under the input box when the cursor sits below it', () => {
    const rows = ['⏺ All 20 tests pass.', '', rule, '> ', rule, `  ${statusLine}`, '']
    expect(latestLineOf(rows, 6)).toBe('⏺ All 20 tests pass.')
  })

  it('ignores a status line under a rounded input box with a multi-line draft', () => {
    const rows = [
      '⏺ Done.',
      '╭' + '─'.repeat(40) + '╮',
      '│ > first line │',
      '│   second line │',
      '╰' + '─'.repeat(40) + '╯',
      `  ${statusLine}`,
    ]
    expect(latestLineOf(rows)).toBe('⏺ Done.')
  })

  it('reads output above the input box even when the output drew a table', () => {
    const rows = ['┌──┬──┐', '│a │b │', '└──┴──┘', '⏺ Table above.', rule, '> ', rule, statusLine]
    expect(latestLineOf(rows)).toBe('⏺ Table above.')
  })
})

describe('latestLineOf — is empty for a blank screen', () => {
  it('is empty for a blank screen', () => {
    expect(latestLineOf(['', '  '])).toBe('')
    expect(latestLineOf([])).toBe('')
  })
})
