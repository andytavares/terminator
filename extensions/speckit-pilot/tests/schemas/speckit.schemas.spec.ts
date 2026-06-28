import { describe, it, expect } from 'vitest'
import {
  PilotStateSchema,
  InitializePayloadSchema,
  FeatureListPayloadSchema,
  FeatureCreatePayloadSchema,
  SessionListPayloadSchema,
  PhaseApprovePayloadSchema,
  PhaseRejectPayloadSchema,
  PhaseRevokePayloadSchema,
  ArtifactReadPayloadSchema,
  ArtifactSavePayloadSchema,
  HistoryLoadPayloadSchema,
  ImplementFileDecisionPayloadSchema,
  ImplementStopPayloadSchema,
  CheckpointCreatePayloadSchema,
} from '../../src/schemas/speckit.schemas.js'
import { DEFAULT_SETTINGS, PHASE_ORDER } from '../../src/types/speckit.types.js'

function makeMinimalPilotState() {
  return {
    version: 2 as const,
    featureDir: 'specs/test-feature',
    ticket: null,
    run: null,
    queuePosition: null,
    worktreePath: null,
    branchName: null,
    prUrl: null,
    phases: Object.fromEntries(
      PHASE_ORDER.map((id, idx) => [
        id,
        {
          id,
          status: idx === 0 ? 'ready' : 'locked',
          approvedHash: null,
          approvedAt: null,
          approvedBy: null,
          lastRunId: null,
          lastRunAt: null,
          artifactPaths: [],
          feedback: null,
          batchIndex: null,
        },
      ])
    ),
    settings: DEFAULT_SETTINGS,
  }
}

describe('PilotStateSchema', () => {
  it('accepts a valid minimal PilotState', () => {
    const result = PilotStateSchema.safeParse(makeMinimalPilotState())
    expect(result.success).toBe(true)
  })

  it('rejects version !== 2', () => {
    const state = { ...makeMinimalPilotState(), version: 1 }
    expect(PilotStateSchema.safeParse(state).success).toBe(false)
  })

  it('rejects invalid phase status', () => {
    const state = makeMinimalPilotState()
    ;(state.phases as Record<string, unknown>)['constitution'] = {
      ...state.phases['constitution'],
      status: 'invalid_status',
    }
    expect(PilotStateSchema.safeParse(state).success).toBe(false)
  })

  it('rejects missing featureDir', () => {
    const { featureDir: _, ...rest } = makeMinimalPilotState()
    expect(PilotStateSchema.safeParse(rest).success).toBe(false)
  })
})

describe('InitializePayloadSchema', () => {
  it('accepts valid featureDir', () => {
    expect(InitializePayloadSchema.safeParse({ featureDir: 'specs/001-test' }).success).toBe(true)
  })

  it('rejects empty featureDir', () => {
    expect(InitializePayloadSchema.safeParse({ featureDir: '' }).success).toBe(false)
  })

  it('rejects missing featureDir', () => {
    expect(InitializePayloadSchema.safeParse({}).success).toBe(false)
  })
})

describe('FeatureListPayloadSchema', () => {
  it('accepts empty object', () => {
    expect(FeatureListPayloadSchema.safeParse({}).success).toBe(true)
  })

  it('accepts object with extra fields', () => {
    expect(FeatureListPayloadSchema.safeParse({ extra: 'field' }).success).toBe(true)
  })
})

describe('FeatureCreatePayloadSchema', () => {
  it('accepts valid payload', () => {
    expect(
      FeatureCreatePayloadSchema.safeParse({ name: 'my-feature', createBranch: true }).success
    ).toBe(true)
  })

  it('accepts optional initialPrompt', () => {
    expect(
      FeatureCreatePayloadSchema.safeParse({
        name: 'test',
        createBranch: false,
        initialPrompt: 'Build something',
      }).success
    ).toBe(true)
  })

  it('rejects empty name', () => {
    expect(FeatureCreatePayloadSchema.safeParse({ name: '', createBranch: false }).success).toBe(
      false
    )
  })
})

describe('SessionListPayloadSchema', () => {
  it('accepts empty object', () => {
    expect(SessionListPayloadSchema.safeParse({}).success).toBe(true)
  })
})

describe('PhaseApprovePayloadSchema', () => {
  it('accepts valid payload', () => {
    expect(
      PhaseApprovePayloadSchema.safeParse({
        featureDir: 'specs/001',
        phase: 'constitution',
        autoUnlockNext: true,
      }).success
    ).toBe(true)
  })

  it('accepts optional note', () => {
    expect(
      PhaseApprovePayloadSchema.safeParse({
        featureDir: 'specs/001',
        phase: 'specify',
        note: 'LGTM',
        autoUnlockNext: false,
      }).success
    ).toBe(true)
  })

  it('rejects invalid phase', () => {
    expect(
      PhaseApprovePayloadSchema.safeParse({
        featureDir: 'specs/001',
        phase: 'invalid',
        autoUnlockNext: false,
      }).success
    ).toBe(false)
  })
})

describe('PhaseRejectPayloadSchema', () => {
  it('accepts valid payload', () => {
    expect(
      PhaseRejectPayloadSchema.safeParse({
        featureDir: 'specs/001',
        phase: 'plan',
        reason: 'Too vague',
        modifyPrompt: true,
      }).success
    ).toBe(true)
  })

  it('rejects empty reason', () => {
    expect(
      PhaseRejectPayloadSchema.safeParse({
        featureDir: 'specs/001',
        phase: 'plan',
        reason: '',
        modifyPrompt: false,
      }).success
    ).toBe(false)
  })
})

describe('PhaseRevokePayloadSchema', () => {
  it('accepts valid payload without note', () => {
    expect(
      PhaseRevokePayloadSchema.safeParse({ featureDir: 'specs/001', phase: 'tasks' }).success
    ).toBe(true)
  })
})

describe('ArtifactReadPayloadSchema', () => {
  it('accepts valid payload', () => {
    expect(
      ArtifactReadPayloadSchema.safeParse({
        artifactPath: '/repo/specs/001/spec.md',
        phase: 'specify',
        featureDir: 'specs/001',
      }).success
    ).toBe(true)
  })
})

describe('ArtifactSavePayloadSchema', () => {
  it('accepts valid payload', () => {
    expect(
      ArtifactSavePayloadSchema.safeParse({
        artifactPath: '/repo/specs/001/spec.md',
        content: '# Spec\n',
        phase: 'specify',
        featureDir: 'specs/001',
        approveInSameStep: false,
      }).success
    ).toBe(true)
  })
})

describe('HistoryLoadPayloadSchema', () => {
  it('accepts valid payload', () => {
    expect(HistoryLoadPayloadSchema.safeParse({ featureDir: 'specs/001' }).success).toBe(true)
  })
})

describe('ImplementFileDecisionPayloadSchema', () => {
  it('accepts approve decision', () => {
    expect(
      ImplementFileDecisionPayloadSchema.safeParse({
        featureDir: 'specs/001',
        filePath: 'src/index.ts',
        decision: 'approve',
      }).success
    ).toBe(true)
  })

  it('accepts skip decision', () => {
    expect(
      ImplementFileDecisionPayloadSchema.safeParse({
        featureDir: 'specs/001',
        filePath: 'src/index.ts',
        decision: 'skip',
      }).success
    ).toBe(true)
  })

  it('rejects invalid decision', () => {
    expect(
      ImplementFileDecisionPayloadSchema.safeParse({
        featureDir: 'specs/001',
        filePath: 'src/index.ts',
        decision: 'deny',
      }).success
    ).toBe(false)
  })
})

describe('ImplementStopPayloadSchema', () => {
  it('accepts valid payload', () => {
    expect(ImplementStopPayloadSchema.safeParse({ featureDir: 'specs/001' }).success).toBe(true)
  })
})

describe('CheckpointCreatePayloadSchema', () => {
  it('accepts valid payload', () => {
    expect(
      CheckpointCreatePayloadSchema.safeParse({
        featureDir: 'specs/001',
        repoRoot: '/Users/me/repo',
      }).success
    ).toBe(true)
  })

  it('rejects empty repoRoot', () => {
    expect(
      CheckpointCreatePayloadSchema.safeParse({ featureDir: 'specs/001', repoRoot: '' }).success
    ).toBe(false)
  })
})
