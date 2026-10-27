/**
 * What every Foundry channel takes and answers, read from the handlers themselves.
 * Types only: the renderer imports this, and no backend code may reach its bundle.
 */
import type { z } from 'zod'

import type { CompilePayload, ForgeChannels } from './forge-channels.js'
import type { InboxChannels } from './inbox-channels.js'
import type { LedgerChannels } from './ledger-channels.js'
import type { ProfileChannels } from './profile-channels.js'
import type { RunChannels } from './run-channels.js'
import type { SensorChannels } from './sensor-channels.js'
import type { listInbox, readAttention } from './inbox-registration.js'
import type { listMyIssues, offerTicket, removeOrder } from './forge-registration.js'
import type { resetRun, stopRun } from './line-registration.js'
import type { currentAskModel, setAskModel } from './model-registration.js'
import type {
  AskModelSetPayload,
  IssuesMinePayload,
  OrderIdPayload,
  SessionPayload,
  TicketCreatePayload,
  ViewPayload,
} from './payloads.js'
import type {
  dismissFeedEntry,
  feedList,
  goToRunTerminal,
  handBackPermission,
  interruptRun,
  muteFeed,
  permissionsList,
  redirectRun,
  resolvePermission,
  stallsList,
  stopSessionOnRequest,
  transcriptTail,
  unmuteFeed,
} from './supervision-registration.js'
import type { consumePendingNewOrder, setView, viewSetting } from './ui-registration.js'
import type { fileTicket } from '../forge/ticket-offer.js'

type Fn = (...args: never[]) => unknown

/** A handler that takes the payload as its first argument. */
type Handler<F extends Fn> = { payload: Parameters<F>[0]; answer: Awaited<ReturnType<F>> }

/** A handler the host calls with nothing. */
type Reads<F extends Fn> = { payload: undefined; answer: Awaited<ReturnType<F>> }

/** A handler whose payload is the channel's schema and whose answer is `F`'s. */
type Answers<S extends z.ZodType, F extends Fn> = {
  payload: z.input<S>
  answer: Awaited<ReturnType<F>>
}

export type FoundryApi = {
  'foundry:run.start': Handler<RunChannels['start']>
  'foundry:run.resume': Handler<RunChannels['resume']>
  'foundry:run.observe': Handler<RunChannels['observe']>
  'foundry:run.recipes': Handler<RunChannels['recipes']>
  'foundry:session.attach': Handler<RunChannels['attach']>
  'foundry:run.activity': Handler<RunChannels['activity']>
  'foundry:run.timeline': Handler<RunChannels['timeline']>
  'foundry:run.stop': Answers<typeof OrderIdPayload, typeof stopRun>
  'foundry:run.reset': Answers<typeof OrderIdPayload, typeof resetRun>
  'foundry:order.create': Handler<ForgeChannels['create']>
  'foundry:order.turn': Handler<ForgeChannels['turn']>
  'foundry:order.compile': Answers<typeof CompilePayload, ForgeChannels['compile']>
  'foundry:order.list': Reads<ForgeChannels['list']>
  'foundry:order.states': Handler<ForgeChannels['states']>
  'foundry:order.mapState': Handler<ForgeChannels['mapState']>
  'foundry:order.converge': Handler<ForgeChannels['converge']>
  'foundry:order.writeBack': Handler<ForgeChannels['setWriteBack']>
  'foundry:order.budgets': Handler<ForgeChannels['setBudgets']>
  'foundry:order.cancel': Handler<ForgeChannels['cancel']>
  'foundry:order.recipe': Handler<ForgeChannels['recipe']>
  'foundry:order.hold': Handler<ForgeChannels['hold']>
  'foundry:order.delete': Answers<typeof OrderIdPayload, typeof removeOrder>
  'foundry:forge.environment': Handler<ForgeChannels['environment']>
  // The channel's `onError` answers `{ error }` when the tracker read throws.
  'foundry:issues.mine': {
    payload: z.input<typeof IssuesMinePayload>
    answer: Awaited<ReturnType<typeof listMyIssues>> | { error: string }
  }
  'foundry:ticket.offer': Reads<typeof offerTicket>
  'foundry:ticket.create': Answers<typeof TicketCreatePayload, typeof fileTicket>
  'foundry:inbox.list': Reads<typeof listInbox>
  'foundry:inbox.decide': Handler<InboxChannels['decide']>
  'foundry:attention': Reads<typeof readAttention>
  'foundry:ledger.query': Handler<LedgerChannels['query']>
  'foundry:factory.metrics': Handler<LedgerChannels['factoryMetrics']>
  'foundry:rules.propose': Handler<LedgerChannels['proposeRules']>
  'foundry:rules.decide': Handler<LedgerChannels['decideProposal']>
  'foundry:rules.inForce': Reads<LedgerChannels['rulesInForce']>
  'foundry:rules.remove': Handler<LedgerChannels['removeAcceptedRule']>
  'foundry:signals.list': Reads<SensorChannels['list']>
  'foundry:signals.dismiss': Handler<SensorChannels['dismiss']>
  'foundry:signals.promote': Handler<SensorChannels['promote']>
  'foundry:sensors.list': Reads<SensorChannels['sensorsList']>
  'foundry:sensors.set': Handler<SensorChannels['sensorsSet']>
  'foundry:sensors.run-now': Handler<SensorChannels['sensorsRunNow']>
  'foundry:profile-read': Handler<ProfileChannels['read']>
  'foundry:profile-save': Handler<ProfileChannels['save']>
  'foundry:profile-prove': Handler<ProfileChannels['prove']>
  'foundry:profiles-list': Reads<ProfileChannels['list']>
  'foundry:profile-forget': Handler<ProfileChannels['forget']>
  'foundry:log-tail': Handler<ProfileChannels['logTail']>
  'foundry:permissions-list': Reads<typeof permissionsList>
  'foundry:stalls-list': Reads<typeof stallsList>
  'foundry:feed-list': Reads<typeof feedList>
  'foundry:feed-dismiss': Handler<typeof dismissFeedEntry>
  'foundry:feed-mute': Handler<typeof muteFeed>
  'foundry:feed-unmute': Handler<typeof unmuteFeed>
  'foundry:permission-resolve': Handler<typeof resolvePermission>
  'foundry:permission-hand-back': Handler<typeof handBackPermission>
  'foundry:run-terminal': Answers<typeof SessionPayload, typeof goToRunTerminal>
  'foundry:run-transcript': Handler<typeof transcriptTail>
  'foundry:run-interrupt': Handler<typeof interruptRun>
  'foundry:run-redirect': Handler<typeof redirectRun>
  'foundry:run-stop': Handler<typeof stopSessionOnRequest>
  'foundry:ui.view': { payload: undefined; answer: { view: ReturnType<typeof viewSetting> } }
  'foundry:ui.set-view': Answers<typeof ViewPayload, typeof setView>
  'foundry:ui.consume-pending-new-order': Reads<typeof consumePendingNewOrder>
  'foundry:ask-model': Reads<typeof currentAskModel>
  // A rejected payload answers `{ error }` (see `registerModelChannels`).
  'foundry:ask-model-set': {
    payload: z.input<typeof AskModelSetPayload>
    answer: Awaited<ReturnType<typeof setAskModel>> | { error: string }
  }
}
