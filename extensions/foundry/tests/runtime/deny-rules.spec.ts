import { describe, it, expect } from 'vitest'
import { denyRules } from '../../src/runtime/deny-rules.js'

const everyTool = () => true

describe('the deny rules a run is started with', () => {
  it('keeps the line its own pushes and pull requests, in every mode', () => {
    const rules = denyRules({ skillsMount: null, mayUseTool: everyTool })
    expect(rules).toEqual(expect.arrayContaining(['Bash(git push)', 'Bash(git push *)']))
    expect(rules).toEqual(expect.arrayContaining(['Bash(gh pr create *)', 'Bash(gh pr merge *)']))
    expect(rules).not.toContain('Bash(gh pr view *)')
  })

  it('keeps the skills mount read-only, by its absolute path', () => {
    const rules = denyRules({ skillsMount: '/data/orders/WO-1/skills', mayUseTool: everyTool })
    expect(rules).toContain('Edit(//data/orders/WO-1/skills/**)')
  })

  it('removes the tools a role does not use, by name', () => {
    const rules = denyRules({ skillsMount: null, mayUseTool: (tool) => tool !== 'WebFetch' })
    expect(rules).toContain('WebFetch')
    expect(rules).not.toContain('Bash')
  })
})
