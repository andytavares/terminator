import type { QuickActionGroup } from './types'

export const CORE_GROUPS: QuickActionGroup[] = [
  { id: 'terminal', mnemonic: 't', label: 'Terminal' },
  { id: 'sessions', mnemonic: 's', label: 'Sessions' },
  { id: 'workspace', mnemonic: 'w', label: 'Workspace' },
  { id: 'custom', mnemonic: 'x', label: 'Custom' },
]

const CORE_TOP_MNEMONICS = new Set(['h', 'o', 'a', 'b', ',', '/'])

const RESERVED_LETTERS = new Set([
  ...CORE_GROUPS.map((g) => g.mnemonic),
  ...Array.from(CORE_TOP_MNEMONICS).filter((m) => /^[a-z]$/.test(m)),
])

interface ExtensionGroupRequest {
  extensionId: string
  mnemonic?: string
  label: string
}

function firstFreeLabelLetter(label: string, used: Set<string>): string | null {
  for (const ch of label.toLowerCase()) {
    if (/[a-z]/.test(ch) && !used.has(ch)) return ch
  }
  return null
}

function firstFreeLetter(used: Set<string>): string | null {
  for (let code = 97; code <= 122; code++) {
    const letter = String.fromCharCode(code)
    if (!used.has(letter)) return letter
  }
  return null
}

/** Why a group did not get the letter it asked for, and what it got instead. */
function takenWarning(
  req: ExtensionGroupRequest,
  assigned: string | null,
  groups: QuickActionGroup[]
): string {
  const wanted = `"${req.extensionId}" wanted mnemonic "${req.mnemonic}"`
  if (!assigned) return `${wanted} but no group letter was free.`
  const takenBy = groups.find((g) => g.mnemonic === req.mnemonic)
  const by = takenBy ? ` by "${takenBy.owner}"` : ''
  return `${wanted} but it was taken${by}; assigned "${assigned}" instead.`
}

export function allocateExtensionGroups(requests: ExtensionGroupRequest[]): {
  groups: QuickActionGroup[]
  warnings: string[]
} {
  const used = new Set(RESERVED_LETTERS)
  const groups: QuickActionGroup[] = []
  const warnings: string[] = []

  for (const req of requests) {
    const wanted = req.mnemonic
    const wantedTaken = wanted !== undefined && used.has(wanted)
    const assigned =
      wanted !== undefined && !wantedTaken
        ? wanted
        : (firstFreeLabelLetter(req.label, used) ?? firstFreeLetter(used))
    if (wantedTaken) warnings.push(takenWarning(req, assigned, groups))
    if (!assigned) continue

    used.add(assigned)
    groups.push({
      id: `ext:${req.extensionId}`,
      mnemonic: assigned,
      label: req.label,
      owner: req.extensionId,
    })
  }

  return { groups, warnings }
}
