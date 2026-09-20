import type { QuickAction, QuickActionGroup } from './types'

export const CORE_GROUPS: QuickActionGroup[] = [
  { id: 'terminal', mnemonic: 't', label: 'Terminal' },
  { id: 'sessions', mnemonic: 's', label: 'Sessions' },
  { id: 'workspace', mnemonic: 'w', label: 'Workspace' },
  { id: 'custom', mnemonic: 'x', label: 'Custom' },
]

export const CORE_TOP_MNEMONICS = new Set(['h', 'o', 'a', 'b', ',', '/'])

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
    let assigned: string | null = null

    if (wanted !== undefined && !wantedTaken) {
      assigned = wanted
    } else {
      assigned = firstFreeLabelLetter(req.label, used) ?? firstFreeLetter(used)
    }

    if (wanted !== undefined && wantedTaken) {
      if (assigned) {
        const takenBy = groups.find((g) => g.mnemonic === wanted)
        warnings.push(
          `"${req.extensionId}" wanted mnemonic "${wanted}" but it was taken${
            takenBy ? ` by "${takenBy.owner}"` : ''
          }; assigned "${assigned}" instead.`
        )
      } else {
        warnings.push(
          `"${req.extensionId}" wanted mnemonic "${wanted}" but no group letter was free.`
        )
      }
    }

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

export function findMnemonicConflicts(
  actions: QuickAction[],
  groups: QuickActionGroup[]
): string[] {
  const conflicts: string[] = []
  const groupLetters = new Set(groups.map((g) => g.mnemonic))

  const byGroup = new Map<string, Map<string, string[]>>()
  for (const action of actions) {
    if (!action.mnemonic) continue

    if (action.group === 'top' && groupLetters.has(action.mnemonic)) {
      conflicts.push(
        `Top-level action "${action.id}" uses mnemonic "${action.mnemonic}", which is also a group letter.`
      )
    }

    const byMnemonic = byGroup.get(action.group) ?? new Map<string, string[]>()
    const ids = byMnemonic.get(action.mnemonic) ?? []
    ids.push(action.id)
    byMnemonic.set(action.mnemonic, ids)
    byGroup.set(action.group, byMnemonic)
  }

  for (const [group, byMnemonic] of byGroup) {
    for (const [mnemonic, ids] of byMnemonic) {
      if (ids.length > 1) {
        conflicts.push(
          `Group "${group}" has duplicate mnemonic "${mnemonic}" on: ${ids.join(', ')}.`
        )
      }
    }
  }

  return conflicts
}
