import * as fs from 'node:fs'
import * as path from 'node:path'
import type { WorkOrder } from '../order/schema.js'
import type { Requirement } from './parse.js'
import { CHECK_NAMES } from '../verify/toolchain-probe.js'
import type { CheckName } from '../verify/toolchain-probe.js'

// What a recipe needs of a repository before it can be offered.
//
// An unmet requirement means the recipe is **not offered**, with the reason
// available — never silently rewritten into something else. That silent
// rewrite is what the retired plain-prose fallback table did: a pipeline that
// quietly becomes a different pipeline is one you cannot reason about, and
// deleting it was half the point of this feature.

export interface RequirementCheck {
  readonly met: boolean
  /** Why not, in words the operator can act on. Empty when met. */
  readonly reason: string
}

function isCheckName(value: string): value is CheckName {
  return (CHECK_NAMES as readonly string[]).includes(value)
}

function checkOne(requirement: Requirement, order: WorkOrder): RequirementCheck {
  switch (requirement.kind) {
    case 'path_exists': {
      // Checked against every repository the order names: a recipe that needs
      // a directory needs it where the work will happen.
      const missing = order.context.repos.filter(
        (repo) => !fs.existsSync(path.join(repo.path, requirement.value))
      )
      return missing.length === 0
        ? { met: true, reason: '' }
        : {
            met: false,
            reason: `${missing.map((r) => r.name).join(', ')} has no ${requirement.value}`,
          }
    }

    case 'toolchain': {
      if (!isCheckName(requirement.value)) {
        return { met: false, reason: `unknown toolchain check "${requirement.value}"` }
      }
      const found = order.context.toolchain[requirement.value]
      return found !== null
        ? { met: true, reason: '' }
        : {
            met: false,
            reason: `this repository has no ${requirement.value} command`,
          }
    }

    case 'repos': {
      const comparison = /^(>=|<=|>|<|==)?\s*(\d+)$/.exec(requirement.value.trim())
      if (comparison === null) return { met: false, reason: `unreadable repos requirement` }
      const want = Number(comparison[2])
      const have = order.context.repos.length
      const operator = comparison[1] ?? '=='
      const met =
        operator === '>='
          ? have >= want
          : operator === '<='
            ? have <= want
            : operator === '>'
              ? have > want
              : operator === '<'
                ? have < want
                : have === want
      return met
        ? { met: true, reason: '' }
        : { met: false, reason: `needs ${operator} ${want} repositories, this order has ${have}` }
    }

    default:
      // An unknown requirement kind is unmet, not ignored. Treating it as met
      // would let a recipe from a newer build silently run here with a
      // condition this one cannot evaluate.
      return { met: false, reason: `unknown requirement "${requirement.kind}"` }
  }
}

export interface RecipeAvailability {
  readonly available: boolean
  readonly unmet: readonly string[]
}

/** Whether a recipe may be offered for this order, and why not when it may not. */
export function checkRequirements(
  requirements: readonly Requirement[],
  order: WorkOrder
): RecipeAvailability {
  const unmet = requirements
    .map((requirement) => checkOne(requirement, order))
    .filter((result) => !result.met)
    .map((result) => result.reason)
  return { available: unmet.length === 0, unmet }
}
