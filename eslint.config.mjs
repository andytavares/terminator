import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import playwright from 'eslint-plugin-playwright'
import vitest from '@vitest/eslint-plugin'
import testingLibrary from 'eslint-plugin-testing-library'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Constitution II / ADR 094: a relative import may not climb out of the extension.
// How many `../` that takes depends on the importing file's depth, so there is one
// block per depth under src/.
const EXTENSION_SRC_MAX_DEPTH = 6

function extensionImportBoundary() {
  const workspacePackage = {
    regex: '^@terminator/(?!extension-sdk(/|$)|extension-ui(/|$))',
    message:
      'An extension imports only @terminator/extension-sdk and @terminator/extension-ui among workspace packages; another extension is reached through its activate() exports (ADR 094).',
  }
  return Array.from({ length: EXTENSION_SRC_MAX_DEPTH }, (_, index) => {
    const depth = index + 1
    return {
      files: [`extensions/*/src/${'*/'.repeat(depth - 1)}*.{ts,tsx}`],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              workspacePackage,
              {
                regex: `^(\\.\\./){${depth + 1},}`,
                message:
                  'This path leaves the extension. Import core types and helpers from @terminator/extension-sdk, components from @terminator/extension-ui (Constitution II).',
              },
            ],
          },
        ],
      },
    }
  })
}

const SLEEP_MESSAGE =
  'Tests never sleep or wait a tick (ADR 123). Wait on the condition you assert next: a locator assertion, expect.poll, eventually() from tests/support/eventually.ts, fake timers, or the promise the code under test returns.'

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

// Spec and e2e files, with type information: a promise that is not awaited is work that
// outlives its test.
const TEST_FILES = ['**/*.spec.ts', '**/*.spec.tsx', 'tests/**/*.ts', 'tests/**/*.tsx']
const TEST_PROJECTS = [
  './tsconfig.test.json',
  './tsconfig.main.json',
  './tsconfig.shared.json',
  './packages/extension-ui/tsconfig.test.json',
  './packages/extension-sdk/tsconfig.json',
  './extensions/*/tsconfig.test.json',
]

export default defineConfig([
  // Build output and other tools' trees. extensions/*/src/index.js is the
  // esbuild bundle of each extension (see .gitignore).
  globalIgnores([
    '**/dist/',
    '**/out/',
    '**/build/',
    '**/storybook-static/',
    '**/coverage/',
    '.worktrees/',
    '.venv/',
    '.claude/',
    '**/*.min.js',
    'extensions/*/src/index.js',
  ]),
  {
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.node },
    },
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style'] Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message:
            "Don't hardcode hex colors in inline `style` — use a theme token, e.g. color: 'var(--text-secondary)'. Hardcoded hex breaks the light theme (see ErrorBoundary regression). Terminal/xterm palettes and workspace color data belong in named constants, not style props.",
        },
      ],
    },
  },
  {
    // ADR 096: core invoke channels register through the schema table, where a
    // zod schema is required. Only the table and the extension API call
    // handleChannel.
    files: ['src/main/**/*.ts'],
    ignores: ['src/main/ipc/invoke-table.ts', 'src/main/extensions/api.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: './channel-registrar.js',
              importNames: ['handleChannel'],
              message: 'Register invoke channels with registerInvokeTable (ADR 096).',
            },
            {
              name: '../ipc/channel-registrar.js',
              importNames: ['handleChannel'],
              message: 'Register invoke channels with registerInvokeTable (ADR 096).',
            },
            {
              name: './ipc/channel-registrar.js',
              importNames: ['handleChannel'],
              message: 'Register invoke channels with registerInvokeTable (ADR 096).',
            },
          ],
        },
      ],
    },
  },
  ...extensionImportBoundary(),
  {
    // No test sleeps (ADR 070, ADR 120): a fixed delay is a race the test hopes to win. Every
    // spec and every e2e file waits on the condition it asserts next.
    files: [
      '**/*.spec.ts',
      '**/*.spec.tsx',
      'tests/**/*.{ts,tsx}',
      'extensions/*/tests/**/*.{ts,tsx}',
      'packages/*/tests/**/*.{ts,tsx}',
    ],
    // The places a wait's bound is set (ADR 123), and the leak guard, which reads Node's own
    // schedule: a closed handle's destroy hook is emitted on the check phase after its close
    // callback, so a fixed count of loop turns is exact there, not a race.
    ignores: [
      'tests/support/eventually.ts',
      'tests/support/hang-bound.ts',
      'tests/support/leak-guard.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style'] Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message: "Don't hardcode hex colors in inline `style` — use a theme token.",
        },
        {
          selector: "CallExpression[callee.property.name='waitForTimeout']",
          message: SLEEP_MESSAGE,
        },
        {
          selector: 'CallExpression[callee.name=/^(sleep|delay)$/]',
          message: SLEEP_MESSAGE,
        },
        ...TICK_WAITS.map((selector) => ({ selector, message: SLEEP_MESSAGE })),
        {
          selector: "CallExpression[callee.object.name='process'][callee.property.name='nextTick']",
          message: SLEEP_MESSAGE,
        },
        {
          selector:
            "AwaitExpression > CallExpression[callee.object.name='Promise'][callee.property.name='resolve'][arguments.length=0]",
          message: SLEEP_MESSAGE,
        },
        ...TIMEOUT_OVERRIDES.map((selector) => ({ selector, message: TIMEOUT_MESSAGE })),
      ],
    },
  },
  {
    files: TEST_FILES,
    languageOptions: {
      parserOptions: { project: TEST_PROJECTS, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx'],
    ignores: ['tests/e2e/**'],
    plugins: { vitest },
    rules: {
      'vitest/valid-expect': 'error',
      'vitest/valid-expect-in-promise': 'error',
      'vitest/require-awaited-expect-poll': 'error',
      'vitest/no-focused-tests': 'error',
      'vitest/no-done-callback': 'error',
    },
  },
  {
    files: ['**/*.spec.tsx'],
    plugins: { 'testing-library': testingLibrary },
    rules: {
      'testing-library/await-async-utils': 'error',
      'testing-library/await-async-events': 'error',
      'testing-library/no-wait-for-side-effects': 'error',
    },
  },
  {
    files: ['tests/e2e/**/*.ts'],
    plugins: { playwright },
    rules: {
      'playwright/prefer-web-first-assertions': 'error',
      'playwright/missing-playwright-await': 'error',
      'playwright/no-wait-for-selector': 'error',
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-networkidle': 'error',
      'playwright/no-force-option': 'error',
      'playwright/no-element-handle': 'error',
      'playwright/no-useless-await': 'error',
    },
  },
  {
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/renderer/components/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
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
      ],
    },
  },
  {
    files: ['extensions/*/src/**/*.tsx', 'packages/extension-ui/src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXAttribute[name.name='style'] Property[key.name='zIndex'] > Literal[value=/^[0-9]+$/]",
          message:
            'Stacking comes from the published layer scale. Use layerValue() from @terminator/extension-ui, or var(--tm-layer-*) in CSS — a raw number is how 14 unmanaged values ended up deciding order by whoever picked the biggest.',
        },
        {
          selector:
            "JSXElement[openingElement.name.name!='code'] > JSXText[value=/\\b(?:vault|[Aa]rtifacts?|[Ss]talls?|ngrok)\\b/]",
          message:
            'Extension UI says what the reader sees, not how it is stored or which vendor is behind it (docs/EXTENSION-STYLE.md): notes are saved, not "saved to vault"; a phase writes files, it does not produce "Artifacts"; a run is stuck, not a "Stall"; the address is public, the vendor is ngrok\'s business. Identifiers, IPC channels and class names keep whatever name they have — this rule only reads text, labels, placeholders, tooltips and accessible names.',
        },
        {
          selector:
            "Property[key.name='label'] > Literal[value=/\\b(?:vault|[Aa]rtifacts?|[Ss]talls?|ngrok)\\b/]",
          message:
            'Extension UI says what the reader sees, not how it is stored or which vendor is behind it (docs/EXTENSION-STYLE.md): notes are saved, not "saved to vault"; a phase writes files, it does not produce "Artifacts"; a run is stuck, not a "Stall"; the address is public, the vendor is ngrok\'s business. Identifiers, IPC channels and class names keep whatever name they have — this rule only reads text, labels, placeholders, tooltips and accessible names.',
        },
        {
          selector:
            'JSXAttribute[name.name=/^(placeholder|title|aria-label)$/] > Literal[value=/\\b(?:vault|[Aa]rtifacts?|[Ss]talls?|ngrok)\\b/]',
          message:
            'Extension UI says what the reader sees, not how it is stored or which vendor is behind it (docs/EXTENSION-STYLE.md): notes are saved, not "saved to vault"; a phase writes files, it does not produce "Artifacts"; a run is stuck, not a "Stall"; the address is public, the vendor is ngrok\'s business. Identifiers, IPC channels and class names keep whatever name they have — this rule only reads text, labels, placeholders, tooltips and accessible names.',
        },
        {
          selector:
            'JSXElement > JSXExpressionContainer > ConditionalExpression > Literal[value=/\\b(?:vault|[Aa]rtifacts?|[Ss]talls?|ngrok)\\b/]',
          message:
            'Extension UI says what the reader sees, not how it is stored or which vendor is behind it (docs/EXTENSION-STYLE.md): notes are saved, not "saved to vault"; a phase writes files, it does not produce "Artifacts"; a run is stuck, not a "Stall"; the address is public, the vendor is ngrok\'s business. Identifiers, IPC channels and class names keep whatever name they have — this rule only reads text, labels, placeholders, tooltips and accessible names.',
        },
        {
          selector:
            "JSXOpeningElement[name.name=/^[A-Z]/][name.name!='QRCodeSVG'] > JSXAttribute[name.name='size'] > JSXExpressionContainer > Literal",
          message:
            'Constitution XII: size icons in CSS, not with a size prop. Use the published scale — className="tm-icon-sm" (12px), "tm-icon" (14px) or "tm-icon-lg" (16px) — or a rule on the parent. 139 props across seven ad-hoc values in a 6px band is one decision made seven times.',
        },
      ],
    },
  },
  {
    // Function size limits for every file; how to split code that outgrows them:
    // docs/CONTRIBUTING.md, "Lint and format".
    files: ['**/*.{js,mjs,cjs,ts,mts,tsx}'],
    rules: {
      'max-lines-per-function': ['error', { max: 30, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 10],
      'max-params': ['error', 3],
    },
  },
])
