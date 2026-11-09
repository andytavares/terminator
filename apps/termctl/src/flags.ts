import { UsageError } from './exit-codes.js'

export interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  anyOf?: JsonSchema[]
  description?: string
}

export type ToolArguments = Record<string, unknown>

/** `workspaceId` → `workspace-id`. */
export function flagName(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

/** The types a schema allows: its own `type`, or those of its `anyOf` variants. */
export function schemaTypes(schema: JsonSchema): string[] {
  if (Array.isArray(schema.type)) return schema.type
  if (schema.type) return [schema.type]
  return (schema.anyOf ?? []).flatMap(schemaTypes)
}

/** The tool's arguments from its flags, as its input schema describes them. */
export function parseToolArguments(schema: JsonSchema, args: string[]): ToolArguments {
  const properties = schema.properties ?? {}
  const byFlag = new Map(Object.keys(properties).map((key) => [flagName(key), key]))
  const result: ToolArguments = {}
  for (let index = 0; index < args.length; index++) {
    const [flag, inline] = splitFlag(args[index])
    const key = byFlag.get(flag)
    if (key === undefined) throw new UsageError(unknownArgument(args[index]))
    const property = properties[key]
    if (schemaTypes(property).includes('boolean')) {
      result[key] = inline !== 'false'
      continue
    }
    const text = inline ?? args[++index]
    if (text === undefined) throw new UsageError(`Flag --${flag} needs a value`)
    result[key] = addedValue(result[key], property, parseValue(flag, property, text))
  }
  return withRequired(result, schema)
}

function splitFlag(arg: string): [string, string | null] {
  if (!arg.startsWith('--')) return ['', null]
  const equals = arg.indexOf('=')
  return equals === -1 ? [arg.slice(2), null] : [arg.slice(2, equals), arg.slice(equals + 1)]
}

function unknownArgument(arg: string): string {
  if (!arg.startsWith('--')) return `Unexpected argument ${arg}`
  return `Unknown flag ${arg.split('=')[0]}`
}

/** The flag's value, added to the values before it when the flag is a list. */
function addedValue(previous: unknown, property: JsonSchema, value: unknown): unknown {
  if (!schemaTypes(property).includes('array')) return value
  return [...((previous as unknown[] | undefined) ?? []), value]
}

function parseValue(flag: string, property: JsonSchema, text: string): unknown {
  const types = schemaTypes(property)
  const itemTypes = types.includes('array') ? schemaTypes(property.items ?? {}) : types
  return parseTyped(flag, itemTypes, text)
}

function parseTyped(flag: string, itemTypes: string[], text: string): unknown {
  if (itemTypes.includes('null') && text === 'null') return null
  if (itemTypes.includes('string')) return text
  if (itemTypes.includes('number') || itemTypes.includes('integer')) return parseNumber(flag, text)
  if (itemTypes.includes('object') || itemTypes.includes('array')) return parseJson(flag, text)
  if (itemTypes.length === 0) return parseJsonOrText(text)
  return text
}

function parseNumber(flag: string, text: string): number {
  const value = Number(text)
  if (text.trim() === '' || Number.isNaN(value)) {
    throw new UsageError(`Flag --${flag} needs a number, not ${text}`)
  }
  return value
}

function parseJson(flag: string, text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new UsageError(`Flag --${flag} needs JSON, not ${text}`)
  }
}

function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** A required switch that is absent is false; any other required flag must be given. */
function withRequired(result: ToolArguments, schema: JsonSchema): ToolArguments {
  for (const key of schema.required ?? []) {
    if (key in result) continue
    if (!schemaTypes(schema.properties?.[key] ?? {}).includes('boolean')) {
      throw new UsageError(`Missing required flag --${flagName(key)}`)
    }
    result[key] = false
  }
  return result
}
