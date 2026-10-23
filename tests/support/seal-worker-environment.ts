// Imported first by tests/setup.ts: a worker's environment is the sealed one before any other
// module of the setup file, or of the spec, reads it (ADR 123).
import { inject } from 'vitest'
import { sealEnvironment } from './seal-environment'

sealEnvironment(inject('sealedEnvironment'), process.env)
