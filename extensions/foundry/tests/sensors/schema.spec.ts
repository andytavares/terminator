import { describe, it, expect } from 'vitest'
import { parseSensor, everyMs, SENSOR_SCHEMA_VERSION } from '../../src/sensors/schema.js'

// Sensors are YAML, resolved on the same three rungs as a recipe, role or
// rule — see src/recipe/parse.ts for why hand-authored config is YAML rather
// than JSON. A sensor stays inert until an operator enables it in Settings;
// parsing it here proves nothing about whether it runs.

const SENSOR = `
schemaVersion: ${SENSOR_SCHEMA_VERSION}
id: ci-main-red
description: Workflow runs failing on the base branch
every: 30m
severity: high
source:
  kind: github-runs
  branch: null
  limit: 20
`

describe('parseSensor', () => {
  it('parses a well-formed sensor', () => {
    const r = parseSensor(SENSOR, 'ci-main-red.yaml')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.id).toBe('ci-main-red')
      expect(r.value.severity).toBe('high')
      expect(r.value.every).toBe('30m')
      expect(r.value.source).toEqual({ kind: 'github-runs', branch: null, limit: 20 })
    }
  })

  it('requires the id to match the filename', () => {
    const r = parseSensor(SENSOR, 'other-name.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/other-name/)
  })

  it('refuses an interval shorter than 5 minutes', () => {
    const r = parseSensor(SENSOR.replace('every: 30m', 'every: 1m'), 'ci-main-red.yaml')
    expect(r.ok).toBe(false)
  })

  it('refuses an unknown source kind', () => {
    const r = parseSensor(SENSOR.replace('kind: github-runs', 'kind: made-up'), 'ci-main-red.yaml')
    expect(r.ok).toBe(false)
  })

  it('refuses an unknown severity', () => {
    const r = parseSensor(SENSOR.replace('severity: high', 'severity: extreme'), 'ci-main-red.yaml')
    expect(r.ok).toBe(false)
  })

  it('reports malformed YAML by path instead of throwing', () => {
    const r = parseSensor('id: [unclosed\n', 'broken.yaml')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('broken.yaml')
  })

  it('refuses a schema version newer than it knows', () => {
    const r = parseSensor(
      SENSOR.replace(`schemaVersion: ${SENSOR_SCHEMA_VERSION}`, 'schemaVersion: 99'),
      'ci-main-red.yaml'
    )
    expect(r.ok).toBe(false)
  })

  it('parses the tracker source kind, with a null query meaning "your assigned issues"', () => {
    const tracker = `
schemaVersion: ${SENSOR_SCHEMA_VERSION}
id: tracker-query
description: Your assigned open issues
every: 60m
severity: medium
source:
  kind: tracker
  query: null
  limit: 25
`
    const r = parseSensor(tracker, 'tracker-query.yaml')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.source).toEqual({ kind: 'tracker', query: null, limit: 25 })
  })
})

describe('everyMs', () => {
  it('converts minutes', () => {
    expect(everyMs('30m')).toBe(30 * 60 * 1000)
  })

  it('converts hours', () => {
    expect(everyMs('2h')).toBe(2 * 60 * 60 * 1000)
  })
})
