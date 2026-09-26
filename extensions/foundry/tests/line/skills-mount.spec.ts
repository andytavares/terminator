import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { mountSkills } from '../../src/line/skills-mount.js'
import type { ResolvedSkill } from '../../src/recipe/resolve.js'

let root: string
let mountDir: string
let repo: string

function skill(id: string, rung: ResolvedSkill['rung'], dir: string): ResolvedSkill {
  return { id, rung, dir }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-mount-'))
  mountDir = path.join(root, 'mount')
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-mount-repo-'))
})

afterEach(() => {
  for (const dir of [root, repo]) fs.rmSync(dir, { recursive: true, force: true })
})

function writeSkillFiles(dir: string, body = 'name: ci-fix\n---\nFix it.\n'): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body)
  fs.mkdirSync(path.join(dir, 'references'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'references', 'notes.md'), 'sibling file')
}

describe('mountSkills', () => {
  it('copies SKILL.md and sibling files into <mountDir>/.claude/skills/<id>/', () => {
    const source = path.join(root, 'source', 'ci-fix')
    writeSkillFiles(source)

    mountSkills(mountDir, [skill('ci-fix', 'built-in', source)])

    const mounted = path.join(mountDir, '.claude', 'skills', 'ci-fix')
    expect(fs.readFileSync(path.join(mounted, 'SKILL.md'), 'utf8')).toContain('name: ci-fix')
    expect(fs.readFileSync(path.join(mounted, 'references', 'notes.md'), 'utf8')).toBe(
      'sibling file'
    )
  })

  it('replaces a stale mount rather than merging into it', () => {
    const mounted = path.join(mountDir, '.claude', 'skills')
    fs.mkdirSync(path.join(mounted, 'old-skill'), { recursive: true })
    fs.writeFileSync(path.join(mounted, 'old-skill', 'SKILL.md'), 'stale')

    const source = path.join(root, 'source', 'ci-fix')
    writeSkillFiles(source)
    mountSkills(mountDir, [skill('ci-fix', 'built-in', source)])

    expect(fs.existsSync(path.join(mounted, 'old-skill'))).toBe(false)
    expect(fs.existsSync(path.join(mounted, 'ci-fix', 'SKILL.md'))).toBe(true)
  })

  it('overwrites an existing copy of the same skill with the current contents', () => {
    const source = path.join(root, 'source', 'ci-fix')
    writeSkillFiles(source, 'name: ci-fix\n---\nfirst version\n')
    mountSkills(mountDir, [skill('ci-fix', 'built-in', source)])

    writeSkillFiles(source, 'name: ci-fix\n---\nsecond version\n')
    mountSkills(mountDir, [skill('ci-fix', 'built-in', source)])

    const text = fs.readFileSync(
      path.join(mountDir, '.claude', 'skills', 'ci-fix', 'SKILL.md'),
      'utf8'
    )
    expect(text).toContain('second version')
  })

  it('writes nothing into the repository', () => {
    const source = path.join(root, 'source', 'ci-fix')
    writeSkillFiles(source)

    mountSkills(mountDir, [skill('ci-fix', 'built-in', source)])

    expect(fs.readdirSync(repo)).toEqual([])
  })

  it('mounts nothing when there are no skills', () => {
    mountSkills(mountDir, [])
    expect(fs.existsSync(path.join(mountDir, '.claude', 'skills'))).toBe(true)
    expect(fs.readdirSync(path.join(mountDir, '.claude', 'skills'))).toEqual([])
  })
})
