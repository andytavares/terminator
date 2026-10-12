import type { ExtensionAPI } from '@terminator/extension-sdk'

import { disposables } from '../ipc/register.js'

/** Foundry's settings page: where records go, autonomy, budgets, write-backs. */
export function registerSettings(api: ExtensionAPI): void {
  disposables.push(
    api.settings.register({
      label: 'Foundry',
      description:
        'A software factory. Foundry writes nothing into the repositories it works on — its own records go wherever you point them below.',
      properties: {
        // Where the records go (FR-074). Empty means <workdir>/.foundry, which
        // leaves an untracked directory behind in every repository you run an
        // order in; Foundry says so once and never edits your .gitignore.
        // Setting one location avoids it, and is the only workable answer once
        // an order spans repositories.
        'terminator.foundry.dataDir': {
          type: 'folder',
          label: 'Where Foundry keeps its records',
          description:
            'Leave empty to write beside each repository, in an untracked .foundry directory. Set one folder and every order writes there instead — recommended, and required in practice for orders that span repositories.',
          default: '',
        },
        // Draft-first shipping (FR-053). Off puts a gate back before the push,
        // which is the old behaviour and is there for repositories where a
        // stray branch is expensive.
        'terminator.foundry.autoOpenDraftPr': {
          type: 'boolean',
          label: 'Open a draft pull request when work finishes',
          description:
            'On: the Line pushes and opens a draft without asking, and your decision becomes "mark it ready" on a real diff. Off: nothing is pushed until you say so.',
          default: true,
        },
        // Which gate rules are live (FR-049). Not a chattiness level: four
        // rules stay live at every setting, so lights-out still cannot merge.
        'terminator.foundry.autonomy': {
          type: 'enum',
          label: 'Autonomy',
          description:
            'Which rules are allowed to stop for you. Risk, budget and the merge decision are live at every setting — at lights-out they refuse rather than wait, because nobody is there to answer.',
          options: ['escorted', 'standard', 'lights-out'],
          default: 'standard',
        },
        'terminator.foundry.lighterRedTeam': {
          type: 'boolean',
          label: 'Lighter red team',
          description:
            'On: the red team runs on the balanced model instead of the deep one. Faster and cheaper, with a shallower attack. Orders graded P3 with one lane and no risk triggers skip the red team either way.',
          default: false,
        },
        'terminator.foundry.letAutoModeDecide': {
          type: 'boolean',
          label: 'Let auto mode decide',
          description:
            "On: a tool call Foundry's own rules have no opinion on is decided by Claude Code's auto mode, destructive actions included. Off: it waits for you. The escorted setting always asks you.",
          default: true,
        },
        'terminator.foundry.budgets.agents': {
          type: 'number',
          label: 'Agents running at once',
          description:
            '0 means no limit. Each new order starts with this, and you can change it on the order.',
          default: 3,
          min: 0,
        },
        'terminator.foundry.budgets.wallClockMinutes': {
          type: 'number',
          label: 'Minutes before an order pauses and asks',
          description:
            'Exceeding a budget pauses the work and raises a decision. It never continues silently, and it never dies silently. 0 means no limit.',
          default: 45,
          min: 0,
        },
        // Three booleans rather than a list: the settings surface has no array
        // type, and each write-back is independently worth turning off.
        'terminator.foundry.writeBack.summaryComment': {
          type: 'boolean',
          label: 'Comment the agreed work order on its source issue',
          default: true,
        },
        'terminator.foundry.writeBack.status': {
          type: 'boolean',
          label: 'Move the source issue as work starts, opens and merges',
          description:
            'Built for Linear. A tracker that cannot be asked to move an issue reports it as unsupported when the order is agreed, and nothing is faked.',
          default: true,
        },
        'terminator.foundry.writeBack.prLink': {
          type: 'boolean',
          label: 'Attach every pull request to the source issue',
          default: true,
        },
        // Operator-declared, never inferred. Per-repository lists live in
        // config.yaml under the data root; this is the workspace-wide list.
        // Named by the operator, never inferred: an MCP server's tools are
        // named by somebody else, and a name is not a contract about writing.
        'terminator.foundry.readOnlyTools': {
          type: 'string',
          label: 'Tools a review may also use, one per line',
          description:
            'The read-only policy refuses any tool it has not been taught about. List the ones you know only read — a documentation lookup, for instance. Foundry never infers this list.',
          default: '',
          workspaceScoped: true,
        },
        'terminator.foundry.criticalPaths': {
          type: 'string',
          label: 'Critical paths, one glob per line',
          description:
            'Touching one of these raises a decision before anything is pushed. Foundry never infers this list.',
          default: '',
          workspaceScoped: true,
        },
        // Written by the extension, not shown: it is how "once" is remembered.
        'terminator.foundry.untrackedNoticeSeen': {
          type: 'boolean',
          label: 'Untracked records notice has been shown',
          default: false,
        },
        'terminator.foundry.stallShadowMode': {
          type: 'boolean',
          label: 'Record stalls without surfacing them',
          description:
            'On by default. A stall detector that cries wolf gets turned off, and then the real stalls go unreported too — judge a week of recorded firings before turning this off.',
          default: true,
        },
        // Per-operator, not per-order: which view draws the order list and the
        // Line (FR — Factory view). Only the Forge surface changes; Inbox,
        // Ledger and Settings are unaffected either way.
        'terminator.foundry.view': {
          type: 'enum',
          label: 'Foundry view',
          description: 'How the Forge surface draws orders and runs.',
          options: ['list', 'factory'],
          default: 'list',
        },
      },
    })
  )
}
