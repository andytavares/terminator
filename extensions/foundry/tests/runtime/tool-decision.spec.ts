import { describe, it, expect } from 'vitest'
import { decideTool } from '../../src/runtime/tool-decision.js'
import type { ToolRequest } from '../../src/runtime/tool-decision.js'

// Claude Code's settings (runtime/role-settings.ts) decide almost every call. What reaches
// `decideTool` is an ask: an Artifact publish, or a call the settings left open.

const outputsDir = '/orders/WO-1/outputs'

function request(over: Partial<ToolRequest> = {}): ToolRequest {
  return {
    tool: 'Bash',
    input: { command: 'rm -rf build' },
    autonomy: 'standard',
    outputsDir: null,
    readOnly: false,
    ...over,
  }
}

const publishing = (over: Partial<ToolRequest> = {}) =>
  decideTool(
    request({
      tool: 'Artifact',
      outputsDir,
      input: { file_path: `${outputsDir}/doc.html` },
      ...over,
    })
  )

describe('a call a read-only role asks for', () => {
  it('is refused at escorted, with the tools the role can use', () => {
    const decision = decideTool(
      request({ autonomy: 'escorted', readOnly: true, input: { command: 'npm install' } })
    )
    expect(decision?.allow).toBe(false)
    expect(decision?.reason).toContain('This role only reads')
  })

  it('still goes to the operator at escorted when the role is not read-only', () => {
    expect(decideTool(request({ autonomy: 'escorted', readOnly: false }))).toBeNull()
  })

  it('still lets the order own document through', () => {
    expect(publishing({ readOnly: true })?.allow).toBe(true)
  })
})

describe('a call the settings left open', () => {
  it.each(['escorted', 'standard'] as const)('goes to the operator at %s', (autonomy) => {
    expect(decideTool(request({ autonomy }))).toBeNull()
  })

  it('is refused at lights-out, with a reason the agent can act on', () => {
    const decision = decideTool(request({ autonomy: 'lights-out' }))
    expect(decision?.allow).toBe(false)
    expect(decision?.reason).toContain('nobody is here to be asked')
  })

  it('is refused without reading the command: a quoted subshell is no different', () => {
    const input = { command: 'bash -c "rm -rf src"' }
    expect(decideTool(request({ autonomy: 'lights-out', input }))?.allow).toBe(false)
  })
})

describe('publishing the order’s own document', () => {
  it.each(['escorted', 'standard', 'lights-out'] as const)('is allowed at %s', (autonomy) => {
    expect(publishing({ autonomy })).toEqual({
      allow: true,
      reason: "publishing the order's own document",
    })
  })

  it.each(['doc.htm', 'doc.md'])('allows %s', (name) => {
    expect(publishing({ input: { file_path: `${outputsDir}/${name}` } })?.allow).toBe(true)
  })

  it.each([
    ['a file from the checkout', { file_path: '/work/checkout/.env' }],
    ['a file that is not a page', { file_path: `${outputsDir}/notes.json` }],
    ['a file outside the outputs', { file_path: '/etc/passwd' }],
    ['a page with further files attached', { file_path: `${outputsDir}/doc.html`, files: {} }],
  ])('refuses %s', (_name, input) => {
    expect(publishing({ input, autonomy: 'lights-out' })?.allow).toBe(false)
  })

  it('refuses a role with no outputs directory', () => {
    expect(publishing({ outputsDir: null })?.allow).toBe(false)
  })

  it('does not treat listing artifacts as a publish', () => {
    expect(publishing({ input: { action: 'list' } })).toBeNull()
  })
})
