import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ResolvedSkill } from '../recipe/resolve.js'

// Mounting a node's skills for its agent.
//
// Claude Code loads `<dir>/.claude/skills/<name>/SKILL.md` for every directory
// mounted with `--add-dir`, so what this writes is not the skill itself —
// resolution already found that, on whichever of the three rungs owns it —
// but a directory shaped the way Claude Code expects to be handed one. It
// never writes into the repository: the mount lives under the order's own
// records, outside every checkout.

/**
 * Copy a resolved skill's files, recursively, into `<mountDir>/.claude/skills/<id>/`.
 *
 * A stale mount is replaced rather than merged: a skill a node no longer
 * declares must not still be readable under its mount from an earlier run,
 * and a file a skill removed must not survive being copied over it again.
 */
export function mountSkills(mountDir: string, skills: readonly ResolvedSkill[]): void {
  const claudeSkillsDir = path.join(mountDir, '.claude', 'skills')
  fs.rmSync(claudeSkillsDir, { recursive: true, force: true })
  fs.mkdirSync(claudeSkillsDir, { recursive: true })
  for (const skill of skills) {
    fs.cpSync(skill.dir, path.join(claudeSkillsDir, skill.id), { recursive: true })
  }
}
