import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Constitution II / ADR 094: an extension imports only the SDK, the design
// system and its own npm packages. A relative path may not climb out of the
// extension's directory; how many `../` that takes depends on how deep the
// importing file sits, so there is one block per depth under src/.
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

export default defineConfig([
  // Build output and other tools' trees. extensions/*/src/index.js is the
  // esbuild bundle of each extension (see .gitignore).
  globalIgnores([
    '**/dist/',
    '**/out/',
    '**/build/',
    '**/storybook-static/',
    'coverage/',
    '.worktrees/',
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
      '@typescript-eslint/no-explicit-any': 'warn',
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
    files: ['tests/e2e/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='waitForTimeout']",
          message:
            'E2E never sleeps (ADR 070). Wait on the condition you assert next: a locator assertion or expect.poll.',
        },
        {
          selector: "NewExpression[callee.name='Promise'] CallExpression[callee.name='setTimeout']",
          message:
            'E2E never sleeps (ADR 070). Wait on the condition you assert next: a locator assertion or expect.poll.',
        },
      ],
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
            'Stacking comes from the published layer scale. Use layerValue()/nestedLayerValue() from @terminator/extension-ui, or var(--tm-layer-*) in CSS — a raw number is how 14 unmanaged values ended up deciding order by whoever picked the biggest.',
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
    // Function size limits for the extensions brought within them: at most 30
    // lines (blank lines and comments aside), complexity 10 and three
    // parameters. Pass more than three values as one named object. Add an
    // extension here once all of its functions, tests included, meet them.
    files: ['extensions/{task-vault,notepad,remote-control,git-integration}/**/*.{ts,tsx}'],
    rules: {
      'max-lines-per-function': ['error', { max: 30, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 10],
      'max-params': ['error', 3],
    },
  },
  {
    // The same function size limits for the main process, the shared code, the
    // build and CI scripts, the e2e suite and its support, and the tests that
    // cover them. Add a directory here once all of its functions, tests
    // included, meet them.
    files: [
      'src/{main,shared}/**/*.{ts,tsx}',
      'scripts/**/*.{js,mjs,cjs,ts,mts}',
      'tests/unit/{agents,db,extensions,fs,git,github,integrations,ipc,main,notifications,schemas,sessions,shared,shell,storage,terminal}/**/*.{ts,tsx}',
      'tests/unit/{lint,scripts,config}/**/*.{js,ts,tsx}',
      'tests/unit/{logger,git-test-env}.spec.ts',
      'tests/integration/{ipc,terminal,scripts}/**/*.{js,ts,tsx}',
      'tests/integration/remote-bridge-allowlist.spec.ts',
      'tests/support/**/*.{ts,tsx}',
      'tests/e2e/**/*.{js,mjs,cjs,ts,tsx}',
    ],
    rules: {
      'max-lines-per-function': ['error', { max: 30, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 10],
      'max-params': ['error', 3],
    },
  },
])
