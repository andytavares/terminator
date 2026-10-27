import { describe, it, expect } from 'vitest'
import { roleSettings, type RoleFacts } from '../../src/runtime/role-settings.js'
import { isDocumentationRelative } from '../../src/verify/documentation-path.js'

const freeWriter: RoleFacts = {
  readOnly: false,
  docsOnly: false,
  restrictedWrites: false,
  autonomy: 'standard',
  letModeDecide: true,
  outputPath: null,
  outputsDir: null,
  skillsMount: null,
  mayUseTool: () => true,
  probedCommands: [],
  readOnlyTools: [],
}
const readOnly: RoleFacts = { ...freeWriter, readOnly: true }
const docsOnly: RoleFacts = { ...freeWriter, docsOnly: true, restrictedWrites: true }
const restricted: RoleFacts = {
  ...freeWriter,
  restrictedWrites: true,
  outputPath: '/data/out.json',
}

/** A gitignore-style glob as a regular expression: `**` crosses folders, `*` does not. */
function globToRegExp(glob: string): RegExp {
  const source = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '@@DIRS@@')
    .replace(/\*\*/g, '@@ANY@@')
    .replace(/\*/g, '[^/]*')
    .replace(/@@DIRS@@/g, '(?:.*/)?')
    .replace(/@@ANY@@/g, '.*')
  return new RegExp(`^${source}$`)
}

/** Whether any rule such as `Edit(docs/**)` covers `tool` on `target`. */
function ruleCovers(rules: readonly string[], tool: string, target: string): boolean {
  return rules.some((rule) => {
    const match = /^(\w+)\((.*)\)$/.exec(rule)
    return match !== null && match[1] === tool && globToRegExp(match[2]).test(target)
  })
}

const allowOf = (facts: RoleFacts) => roleSettings(facts).settings.permissions.allow
const denyOf = (facts: RoleFacts) => roleSettings(facts).settings.permissions.deny
const askOf = (facts: RoleFacts) => roleSettings(facts).settings.permissions.ask

describe('the permission mode of a role', () => {
  it.each(['escorted', 'standard', 'lights-out'] as const)(
    'is dontAsk for read-only, documentation-only and restricted roles at %s',
    (autonomy) => {
      for (const facts of [readOnly, docsOnly, restricted]) {
        expect(roleSettings({ ...facts, autonomy }).permissionMode).toBe('dontAsk')
      }
    }
  )

  it.each([
    ['escorted', true, 'default'],
    ['standard', true, 'auto'],
    ['lights-out', true, 'auto'],
    ['standard', false, 'acceptEdits'],
    ['lights-out', false, 'acceptEdits'],
    ['escorted', false, 'default'],
  ] as const)(
    'is %s with letModeDecide %s for a free writer: %s',
    (autonomy, letModeDecide, mode) => {
      expect(roleSettings({ ...freeWriter, autonomy, letModeDecide }).permissionMode).toBe(mode)
    }
  )

  it('lets a role that hands back a document ask, so Foundry can check its publish', () => {
    const author = { ...restricted, outputsDir: '/data/orders/WO-1/outputs' }
    expect(roleSettings(author).permissionMode).toBe('default')
  })
})

describe('what every role is refused or asked about', () => {
  it.each([freeWriter, readOnly, docsOnly, restricted])('denies a push through -C', (facts) => {
    expect(denyOf(facts)).toEqual(
      expect.arrayContaining(['Bash(git push *)', 'Bash(git -C * push*)', 'Bash(gh pr create *)'])
    )
  })

  it.each([freeWriter, readOnly, docsOnly, restricted])(
    'asks about destructive commands',
    (facts) => {
      expect(askOf(facts)).toEqual([
        'Bash(rm -rf *)',
        'Bash(sudo *)',
        'Bash(git reset --hard*)',
        'Bash(git checkout -- *)',
        'Bash(git restore *)',
        'Bash(git clean *)',
        'Bash(git stash drop*)',
        'Artifact',
      ])
    }
  )

  it('removes the tools the role file leaves out', () => {
    expect(denyOf({ ...readOnly, mayUseTool: (tool) => tool !== 'WebFetch' })).toContain('WebFetch')
  })
})

describe('a role whose file lacks the edit tool class but has an output file', () => {
  const scout = {
    ...readOnly,
    outputPath: '/data/out.json',
    mayUseTool: (t: string) => t !== 'Write',
  }

  it('keeps Write so it can hand back its output, and may write nothing else', () => {
    expect(denyOf(scout)).not.toContain('Write')
    expect(ruleCovers(allowOf(scout), 'Write', 'src/index.ts')).toBe(false)
  })

  it('still loses Write when it has nowhere to write', () => {
    expect(denyOf({ ...scout, outputPath: null })).toContain('Write')
  })
})

describe('a read-only role’s reads', () => {
  it('may run only the listed git and gh verbs through Bash', () => {
    const bash = allowOf(readOnly).filter((rule) => rule.startsWith('Bash('))
    expect(bash).toEqual([
      'Bash(git log*)',
      'Bash(git show*)',
      'Bash(git diff*)',
      'Bash(git status*)',
      'Bash(git blame*)',
      'Bash(gh pr view*)',
      'Bash(gh pr diff*)',
      'Bash(gh pr checks*)',
      'Bash(gh issue view*)',
    ])
    expect(allowOf(readOnly)).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob']))
  })
})

describe('a read-only role’s other rules', () => {
  it('may write exactly its output file', () => {
    const rules = allowOf({ ...readOnly, outputPath: '/data/orders/WO-1/out.json' })
    expect(rules).toEqual(
      expect.arrayContaining([
        'Write(//data/orders/WO-1/out.json)',
        'Edit(//data/orders/WO-1/out.json)',
      ])
    )
    expect(ruleCovers(rules, 'Edit', 'src/index.ts')).toBe(false)
  })

  it('runs the proven commands only when its role file declares run_tests', () => {
    const probed = { ...readOnly, probedCommands: ['make verify'] }
    const withoutTests = { ...probed, mayUseTool: (tool: string) => tool !== 'run_tests' }
    expect(allowOf(withoutTests)).not.toContain('Bash(make verify)')
    const verifier = probed
    expect(allowOf(verifier)).toEqual(
      expect.arrayContaining(['Bash(make verify)', 'Bash(make verify *)'])
    )
  })
})

describe('a read-only role’s tools and sandbox', () => {
  it('reads the web only when the role file lists web tools', () => {
    expect(allowOf(readOnly)).toEqual(expect.arrayContaining(['WebFetch', 'WebSearch']))
    expect(allowOf({ ...readOnly, mayUseTool: () => false })).not.toContain('WebFetch')
  })

  it('takes the operator’s read-only tools as they are', () => {
    expect(allowOf({ ...readOnly, readOnlyTools: ['mcp__docs__search'] })).toContain(
      'mcp__docs__search'
    )
  })

  it('runs in a sandbox that reaches GitHub only', () => {
    expect(roleSettings(readOnly).settings.sandbox).toEqual({
      enabled: true,
      network: { allowedDomains: ['github.com', 'api.github.com', '*.githubusercontent.com'] },
    })
  })
})

describe('a documentation-only role', () => {
  const allow = allowOf({ ...docsOnly, outputPath: '/data/out.json', outputsDir: '/data/outputs' })

  it('may not edit source', () => {
    expect(ruleCovers(allow, 'Edit', 'src/index.ts')).toBe(false)
    expect(ruleCovers(allow, 'Write', 'package.json')).toBe(false)
  })

  it.each([
    'README.md',
    'docs/guide/setup.txt',
    'specs/054/plan.md',
    'src/deep/notes.md',
    'packages/ui/README',
    'CHANGELOG',
    'src/index.ts',
    'docs',
    'package.json',
    'srcdocs/a.ts',
  ])('has write globs that agree with isDocumentationRelative on %s', (relative) => {
    for (const tool of ['Edit', 'Write']) {
      expect(ruleCovers(allow, tool, relative)).toBe(isDocumentationRelative(relative))
    }
  })

  it('may write its output file and its outputs directory', () => {
    expect(allow).toEqual(
      expect.arrayContaining(['Write(//data/out.json)', 'Edit(//data/outputs/**)'])
    )
  })
})

describe('a restricted-write role', () => {
  it('writes only its output file and outputs directory', () => {
    const rules = allowOf({ ...restricted, outputsDir: '/data/outputs' })
    expect(rules).toEqual(
      expect.arrayContaining(['Write(//data/out.json)', 'Write(//data/outputs/**)'])
    )
    expect(ruleCovers(rules, 'Edit', 'README.md')).toBe(false)
  })
})

describe('a free writer', () => {
  it('runs the proven commands and is not sandboxed', () => {
    const facts = { ...freeWriter, probedCommands: ['make verify'] }
    expect(allowOf(facts)).toEqual(
      expect.arrayContaining(['Bash(make verify)', 'Bash(make verify *)'])
    )
    expect(roleSettings(facts).settings.sandbox).toBeUndefined()
  })
})
