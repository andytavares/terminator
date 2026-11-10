// The repo's own oxlint rules (ADR 153). `restricted-syntax` is ESLint's `no-restricted-syntax`,
// which oxlint does not have: each option names a group of selectors below, and a later
// override in .oxlintrc.json replaces the groups of an earlier one, as ESLint's options did.
// https://oxc.rs/docs/guide/usage/linter/js-plugins.html

const HEX_COLOR_STYLE = [
  {
    selector: "JSXAttribute[name.name='style'] Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
    message:
      "Don't hardcode hex colors in inline `style` — use a theme token, e.g. color: 'var(--text-secondary)'. Hardcoded hex breaks the light theme (see ErrorBoundary regression). Terminal/xterm palettes and workspace color data belong in named constants, not style props.",
  },
]

const CLOCK_MESSAGE =
  'A pure layer never reads the clock: `now` is a parameter (ADR-027, Constitution XI).'
const PURE_LAYER_CLOCK = [
  "CallExpression[callee.object.name='Date'][callee.property.name='now']",
  "NewExpression[callee.name='Date'][arguments.length=0]",
].map((selector) => ({ selector, message: CLOCK_MESSAGE }))

const SLEEP_MESSAGE =
  'Tests never sleep or wait a tick (ADR 123). Wait on the condition you assert next: a locator assertion, expect.poll, eventually() from packages/test-support/src/eventually.ts, fake timers, or the promise the code under test returns.'

const TIMEOUT_MESSAGE =
  'No per-test or per-wait time limit (ADR 123). One bound exists only to catch a hang: vitest.config.ts and playwright.config.ts set it far above any real duration. Wait on a signal instead.'

// Waits that hope the work is done after a tick or a delay. A tick is not a signal.
const TICK_WAITS = ['setTimeout', 'setImmediate', 'queueMicrotask'].flatMap((name) => [
  `NewExpression[callee.name='Promise'] CallExpression[callee.name='${name}']`,
  `NewExpression[callee.name='Promise'] > Identifier[name='${name}']`,
])

// Calls whose options may carry a time limit: Vitest's hooks and tests, waits and Playwright's
// locator actions and assertions.
const TIMED_CALLS =
  '/^(it|test|describe|beforeAll|beforeEach|afterAll|afterEach|expect|waitFor|poll|toPass|toBeVisible|toBeHidden|toHaveText|toContainText|toHaveCount|toHaveValue|toHaveAttribute|toBeEnabled|toBeDisabled|toBeChecked|toHaveURL|toHaveTitle|toBeFocused|toHaveClass|toBeAttached|toBeEditable|toBeEmpty|toHaveScreenshot|waitForEvent|waitForSelector|waitForFunction|waitForURL|waitForLoadState|waitForRequest|waitForResponse|firstWindow|click|dblclick|fill|press|pressSequentially|type|check|uncheck|hover|focus|textContent|innerText|innerHTML|inputValue|getAttribute|selectOption|setInputFiles|dispatchEvent|scrollIntoViewIfNeeded|screenshot|evaluate|launch)$/'

/** Every way a spec can set its own time limit. */
const TIMEOUT_OVERRIDES = [
  `CallExpression[callee.name=${TIMED_CALLS}] > ObjectExpression > Property[key.name='timeout']`,
  `CallExpression[callee.property.name=${TIMED_CALLS}] > ObjectExpression > Property[key.name='timeout']`,
  'CallExpression[callee.name=/^(it|test|beforeAll|beforeEach|afterAll|afterEach)$/] > Literal[raw=/^[0-9_]+$/]',
  'CallExpression[callee.object.name=/^(it|test|describe)$/] > Literal[raw=/^[0-9_]+$/]',
  // A limit passed by name: the argument after a test's function, or after a hook's.
  'CallExpression[callee.name=/^(it|test)$/][arguments.length=3] > Identifier.arguments:last-child',
  'CallExpression[callee.name=/^(beforeAll|beforeEach|afterAll|afterEach)$/][arguments.length=2] > Identifier.arguments:last-child',
  'CallExpression[callee.name=/^(it|test)$/][arguments.length=3] > MemberExpression.arguments:last-child',
  "CallExpression[callee.object.name='test'][callee.property.name=/^(setTimeout|slow)$/]",
  "CallExpression[callee.object.name='vi'][callee.property.name='setConfig']",
  "CallExpression[callee.object.name='vi'][callee.property.name='waitFor']",
]

// No test sleeps (ADR 070, ADR 120, ADR 123): a fixed delay is a race the test hopes to win.
const SPEC_SIGNALS = [
  {
    selector: "JSXAttribute[name.name='style'] Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
    message: "Don't hardcode hex colors in inline `style` — use a theme token.",
  },
  ...[
    "CallExpression[callee.property.name='waitForTimeout']",
    'CallExpression[callee.name=/^(sleep|delay)$/]',
    ...TICK_WAITS,
    "CallExpression[callee.object.name='process'][callee.property.name='nextTick']",
    "AwaitExpression > CallExpression[callee.object.name='Promise'][callee.property.name='resolve'][arguments.length=0]",
  ].map((selector) => ({ selector, message: SLEEP_MESSAGE })),
  ...TIMEOUT_OVERRIDES.map((selector) => ({ selector, message: TIMEOUT_MESSAGE })),
  // Any timer a spec starts, not only one inside a promise: a delay in a callback is a guess.
  { selector: "CallExpression[callee.name='setTimeout']", message: SLEEP_MESSAGE },
  {
    selector:
      "CallExpression[callee.object.name='Object'][callee.property.name='defineProperty'] > Identifier.arguments:first-child[name=/^(window|globalThis|navigator|document)$/]",
    message:
      'Stub a global with vi.stubGlobal, which vitest.config.ts undoes after each test (T-CLEAN-SLATE).',
  },
  {
    selector: 'CallExpression[callee.property.name=/^(skipIf|runIf)$/]',
    message:
      'A test runs everywhere or fails; a skip that depends on the machine passes on a check nobody ran (T-SAME-ENV).',
  },
]

const BRANCH_NOT_PROJECT = [
  {
    selector: 'JSXText[value=/[Pp]roject/]',
    message:
      'The product calls this a branch, not a project. The stored entity keeps the name `Project` (ADR 032) but no user-facing string may say it.',
  },
  {
    selector: "Property[key.name='label'] > Literal[value=/[Pp]roject/]",
    message:
      'Menu and command labels say branch, not project (ADR 032). Qualify by repo too — every repo has a `main`.',
  },
  {
    selector:
      'JSXAttribute[name.name=/^(placeholder|title|aria-label)$/] > Literal[value=/[Pp]roject/]',
    message: 'Placeholders, tooltips and accessible names say branch, not project (ADR 032).',
  },
]

// One word per action, on every screen (ADR 157): Settle, Restore, Mark done, Archive, Link ticket.
const RETIRED_WORDS =
  '/\\b(?:Done today|Undo done|Restore to open|Unarchive|Complete|Link issue|Change linked issue)\\b/'
const RETIRED_WORDS_MESSAGE =
  'Each action has one word on every screen (ADR 157): Settle takes work off the list until it moves, Restore brings it back, Mark done finishes a task, Archive puts one away, Link ticket links a ticket. Dismiss stays only for notifications, toasts, alerts and findings that go for good.'

const WORK_VOCABULARY = [
  `JSXText[value=${RETIRED_WORDS}]`,
  `Property[key.name='label'] > Literal[value=${RETIRED_WORDS}]`,
  `JSXAttribute[name.name=/^(placeholder|title|aria-label|label)$/] > Literal[value=${RETIRED_WORDS}]`,
  `JSXExpressionContainer > ConditionalExpression > Literal[value=${RETIRED_WORDS}]`,
].map((selector) => ({ selector, message: RETIRED_WORDS_MESSAGE }))

const VOCABULARY = '/\\b(?:vault|[Aa]rtifacts?|[Ss]talls?|ngrok)\\b/'
const VOCABULARY_MESSAGE =
  'Extension UI says what the reader sees, not how it is stored or which vendor is behind it (docs/EXTENSION-STYLE.md): notes are saved, not "saved to vault"; a phase writes files, it does not produce "Artifacts"; a run is stuck, not a "Stall"; the address is public, the vendor is ngrok\'s business. Identifiers, IPC channels and class names keep whatever name they have — this rule only reads text, labels, placeholders, tooltips and accessible names.'

const EXTENSION_UI = [
  {
    selector:
      "JSXAttribute[name.name='style'] Property[key.name='zIndex'] > Literal[value=/^[0-9]+$/]",
    message:
      'Stacking comes from the published layer scale. Use layerValue() from @terminator/extension-ui, or var(--tm-layer-*) in CSS — a raw number is how 14 unmanaged values ended up deciding order by whoever picked the biggest.',
  },
  ...[
    `JSXElement[openingElement.name.name!='code'] > JSXText[value=${VOCABULARY}]`,
    `Property[key.name='label'] > Literal[value=${VOCABULARY}]`,
    `JSXAttribute[name.name=/^(placeholder|title|aria-label)$/] > Literal[value=${VOCABULARY}]`,
    `JSXElement > JSXExpressionContainer > ConditionalExpression > Literal[value=${VOCABULARY}]`,
  ].map((selector) => ({ selector, message: VOCABULARY_MESSAGE })),
  {
    selector:
      "JSXOpeningElement[name.name=/^[A-Z]/][name.name!='QRCodeSVG'] > JSXAttribute[name.name='size'] > JSXExpressionContainer > Literal",
    message:
      'Constitution XII: size icons in CSS, not with a size prop. Use the published scale — className="tm-icon-sm" (12px), "tm-icon" (14px) or "tm-icon-lg" (16px) — or a rule on the parent. 139 props across seven ad-hoc values in a 6px band is one decision made seven times.',
  },
]

// One path per test: a branch in its body is two tests or an it.each (T-READABLE). Vitest's
// no-conditional-in-test, which oxlint's port widens to `??` and `||`.
const TEST_BODY =
  ':matches(CallExpression[callee.name=/^(it|test)$/], CallExpression[callee.object.name=/^(it|test)$/], CallExpression[callee.callee.object.name=/^(it|test)$/]) > :function'
const ONE_PATH_PER_TEST = ['IfStatement', 'SwitchStatement'].map((statement) => ({
  selector: `${TEST_BODY} > BlockStatement > ${statement}`,
  message: 'Avoid having conditionals in tests: a branch is two tests or an it.each (T-READABLE).',
}))

const GROUPS = {
  'one-path-per-test': ONE_PATH_PER_TEST,
  'hex-color-style': HEX_COLOR_STYLE,
  'pure-layer-clock': PURE_LAYER_CLOCK,
  'spec-signals': SPEC_SIGNALS,
  'branch-not-project': BRANCH_NOT_PROJECT,
  'work-vocabulary': WORK_VOCABULARY,
  'extension-ui': EXTENSION_UI,
}

const restrictedSyntax = {
  meta: {
    type: 'problem',
    schema: { type: 'array', items: { enum: Object.keys(GROUPS) } },
  },
  create(context) {
    const visitors = {}
    for (const { selector, message } of context.options.flatMap((group) => GROUPS[group])) {
      const previous = visitors[selector]
      visitors[selector] = (node) => {
        previous?.(node)
        context.report({ node, message })
      }
    }
    return visitors
  },
}

export default {
  meta: { name: 'terminator' },
  rules: { 'restricted-syntax': restrictedSyntax },
}
