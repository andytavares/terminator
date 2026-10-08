import { surfacedQuestions } from '../forge/interview.js'
import { intakeRefusal } from '../forge/intake-outcome.js'
import { runDocumentReady, runFailure } from '../line/run-outcome.js'
import { compileOrder } from './compile.js'
import type { StandingSources } from './standing.js'
import type { OrderStore } from './store.js'

// The standing inputs an order and its ledger can answer on their own.
//
// One builder, because the Forge's list, the Inbox and the tab badge each
// need them, and three assemblies are how two surfaces came to describe the
// same order differently. Runtime facts — graphs, gates, live sessions — are
// the host's and are spread in beside these.
export function orderStandingSources(store: OrderStore): StandingSources {
  return {
    openQuestionsFor: (order) =>
      order.status === 'draft' ? surfacedQuestions(order.openQuestions).length : 0,
    failuresFor: (order) => compileOrder(order).failures.length,
    blockerFor: (order) => compileOrder(order).failures[0]?.detail ?? null,
    intakeRefusedFor: async (orderId) => intakeRefusal(await store.entries(orderId)),
    runFailureFor: async (orderId) => runFailure(await store.entries(orderId)),
    documentReadyFor: async (orderId) => runDocumentReady(await store.entries(orderId)),
  }
}
